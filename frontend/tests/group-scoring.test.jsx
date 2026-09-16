// 그룹별 점수 기준(가중치)과 후보 카드 점수.
//
// 세 군데를 나눠 본다.
//   - NaejipsaApp : 로그인하면 체크리스트를 한 번에 받아 후보마다 점수를 계산하는가
//   - InterestCard: 점수가 있는 후보에만 뱃지를 붙이는가
//   - GroupBar    : 점수 기준 편집이 올바른 값으로 저장을 부르는가
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import GroupBar from "@/components/Dashboard/GroupBar";
import InterestCard from "@/components/Dashboard/InterestCard";
import NaejipsaApp from "@/components/NaejipsaApp";
import { CATEGORY_WEIGHTS } from "@/lib/checklist";
import { getDashboardItems, getInspections, getMyProfile } from "@/lib/api";

const auth = vi.hoisted(() => ({ callback: null, session: null }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: { auth: {
  getSession: async () => ({ data: { session: auth.session } }),
  onAuthStateChange: (callback) => { auth.callback = callback; return { data: { subscription: { unsubscribe: () => {} } } }; },
  signOut: async () => { auth.session = null; auth.callback("SIGNED_OUT", null); },
} } }));
vi.mock("@/lib/api", () => ({
  getMyProfile: vi.fn(), updateMyProfile: vi.fn(), getDashboardItems: vi.fn(),
  createDashboardItem: vi.fn(), updateDashboardItemDetails: vi.fn(), deleteDashboardItem: vi.fn(),
  reorderDashboardItems: vi.fn(), getGroups: vi.fn(), getGroup: vi.fn(), createGroup: vi.fn(),
  renameGroup: vi.fn(), deleteGroup: vi.fn(), addGroupItems: vi.fn(), removeGroupItem: vi.fn(),
  createDashboardShare: vi.fn(), getDashboardShare: vi.fn(), createGroupShareLink: vi.fn(),
  revokeGroupShareLinks: vi.fn(), getSharedGroup: vi.fn(),
  getInspection: vi.fn(), saveInspection: vi.fn(), getInspections: vi.fn(),
  updateGroupScoring: vi.fn(),
}));
// 후보마다 계산된 점수만 드러낸다(차트·드래그는 이 테스트와 무관하다).
vi.mock("@/components/Workspace", () => ({ default: ({ items }) => <ul>
  {items.map((item) => <li key={item.id}>{`${item.name} 점수 ${item.score ?? "없음"}`}</li>)}
</ul> }));
vi.mock("@/components/Modal/InterestModal", () => ({ default: () => null }));
vi.mock("@/components/Modal/AuthModal", () => ({ default: () => null }));
vi.mock("@/components/EditListingDialog", () => ({ default: () => null }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("실제 네트워크 호출 금지"); }));
  auth.session = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("후보 카드 점수 계산 (NaejipsaApp)", () => {
  async function login(userId = "user-a") {
    await act(async () => {
      auth.session = { user: { id: userId } };
      auth.callback("SIGNED_IN", auth.session);
    });
  }

  beforeEach(() => {
    getMyProfile.mockResolvedValue({ service_purposes: ["jeonse"] });
    getDashboardItems.mockResolvedValue({ items: [
      { id: 11, size_id: 200, complex_name: "단지1", representative_area: 84.95, list_price: null, checked: true },
      { id: 12, size_id: 200, complex_name: "단지2", representative_area: 84.95, list_price: null, checked: true },
    ] });
  });

  it("로그인하면 체크리스트를 한 번에 받아 후보마다 점수를 매긴다", async () => {
    getInspections.mockResolvedValue({ count: 1, items: [
      // 교통 묶음만 채운다: (3+1)/2 = 2 -> 1~5 자로 3점.
      { id: 1, property_id: 11, transport: 3, commute_road: 1, overall_rating: 3, memo: "",
        created_at: "2026-09-16T05:00:00Z", updated_at: "2026-09-16T05:00:00Z" },
    ] });
    render(<NaejipsaApp />);
    await login();

    // 후보마다 한 번씩 부르지 않고 한 번에 받아온다.
    await waitFor(() => expect(getInspections).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("단지1 점수 3")).toBeTruthy();
    // 체크리스트를 쓰지 않은 후보는 점수가 없다.
    expect(screen.getByText("단지2 점수 없음")).toBeTruthy();
  });

  it("체크리스트를 못 불러와도 목록은 그대로 보여준다", async () => {
    getInspections.mockRejectedValue(new Error("네트워크 오류"));
    render(<NaejipsaApp />);
    await login();

    expect(await screen.findByText("단지1 점수 없음")).toBeTruthy();
  });
});

describe("점수 뱃지 (InterestCard)", () => {
  const item = { id: "item-1", name: "단지1", sizeLabel: "84㎡", checked: true, regulations: [] };
  const noop = () => {};

  it("점수가 있으면 뱃지로 보여주고, 없으면 붙이지 않는다", () => {
    const { rerender } = render(
      <InterestCard item={{ ...item, score: 4.2 }} onToggle={noop} onEdit={noop}
        onRemove={noop} onDragHandleMouseDown={noop} />,
    );
    expect(screen.getByTitle("임장 체크리스트 점수 (5점 만점)").textContent).toBe("4.2");

    rerender(
      <InterestCard item={item} onToggle={noop} onEdit={noop}
        onRemove={noop} onDragHandleMouseDown={noop} />,
    );
    expect(screen.queryByTitle("임장 체크리스트 점수 (5점 만점)")).toBeNull();
  });
});

describe("그룹 점수 기준 편집 (GroupBar)", () => {
  const GROUP = { id: 7, name: "전세 후보", item_count: 2, share_link_count: 0, scoring_weights: null };

  function renderBar(overrides = {}) {
    const onUpdateScoring = vi.fn().mockResolvedValue(true);
    render(<GroupBar menu={{
      open: true, groups: [GROUP], activeGroup: null, selectedCount: 0,
      profile: { service_purposes: ["jeonse"] }, onUpdateScoring,
      onSelect: () => {}, onCreate: () => {}, onAddTo: () => {},
      onRename: () => {}, onDelete: () => {}, onStopShare: () => {},
      ...overrides,
    }} />);
    return onUpdateScoring;
  }

  it("기준을 정하지 않은 그룹은 프로필 기본값(전세)으로 시작한다", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: '"전세 후보" 그룹 점수 기준' }));
    expect(screen.getByLabelText("교통").value).toBe(String(CATEGORY_WEIGHTS.jeonse.transport_group));
    expect(screen.getByLabelText("내부 상태").value)
      .toBe(String(CATEGORY_WEIGHTS.jeonse.interior_condition_group));
  });

  it("고친 값을 5개 카테고리 모두 담아 저장한다", async () => {
    const onUpdateScoring = renderBar();
    fireEvent.click(screen.getByRole("button", { name: '"전세 후보" 그룹 점수 기준' }));
    fireEvent.change(screen.getByLabelText("교통"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(onUpdateScoring).toHaveBeenCalled());
    const [groupId, weights] = onUpdateScoring.mock.calls[0];
    expect(groupId).toBe(7);
    expect(weights).toEqual({
      transport_group: 50,
      education_life_group: CATEGORY_WEIGHTS.jeonse.education_life_group,
      complex_group: CATEGORY_WEIGHTS.jeonse.complex_group,
      interior_condition_group: CATEGORY_WEIGHTS.jeonse.interior_condition_group,
      facility_group: CATEGORY_WEIGHTS.jeonse.facility_group,
    });
  });

  it("전부 0이면 저장할 수 없다(서버도 422로 막는다)", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: '"전세 후보" 그룹 점수 기준' }));
    for (const label of ["교통", "교육·생활", "단지", "내부 상태", "설비"]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: "0" } });
    }
    expect(screen.getByRole("button", { name: "저장" }).disabled).toBe(true);
  });

  it("기본값으로 되돌리면 null을 보내 그룹 기준을 지운다", async () => {
    const onUpdateScoring = renderBar({
      groups: [{ ...GROUP, scoring_weights: { ...CATEGORY_WEIGHTS.buy } }],
    });
    fireEvent.click(screen.getByRole("button", { name: '"전세 후보" 그룹 점수 기준' }));
    // 정해둔 값이 있으면 그 값으로 시작한다.
    expect(screen.getByLabelText("단지").value).toBe(String(CATEGORY_WEIGHTS.buy.complex_group));

    fireEvent.click(screen.getByRole("button", { name: "기본값으로" }));
    await waitFor(() => expect(onUpdateScoring).toHaveBeenCalledWith(7, null));
  });
});
