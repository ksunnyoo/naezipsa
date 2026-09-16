// 임장 체크리스트 저장 연결: 종합 평점 자동 계산·직접 선택(EditListingDialog)과,
// 팝업을 열 때 불러오고 저장할 때 보내는 배선(NaejipsaApp).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import EditListingDialog from "@/components/EditListingDialog";
import NaejipsaApp from "@/components/NaejipsaApp";
import { getDashboardItems, getInspection, getMyProfile, saveInspection, updateDashboardItemDetails } from "@/lib/api";

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
  getInspection: vi.fn(), saveInspection: vi.fn(),
}));
// 수정 버튼만 노출한다(실제 Workspace는 차트까지 그려서 이 테스트와 무관하다).
vi.mock("@/components/Workspace", () => ({ default: ({ items, onEdit }) => <ul>
  {items.map((item) => <li key={item.id}>
    <button onClick={() => onEdit(item.id)}>{`${item.name} 수정`}</button>
  </li>)}
</ul> }));
vi.mock("@/components/Modal/InterestModal", () => ({ default: () => null }));
vi.mock("@/components/Modal/AuthModal", () => ({ default: () => null }));

const ITEM = { id: "item-1", backendId: 11, name: "단지1", sizeLabel: "84㎡" };

// 저장된 임장 기록 한 건(서버 응답 모양).
function record(overrides = {}) {
  return {
    id: 5, property_id: 11, created_at: "2026-09-16T05:00:00Z", updated_at: "2026-09-16T05:00:00Z",
    transport: 3, commute_road: 3, overall_rating: 5, memo: "이전 메모", ...overrides,
  };
}

async function openChecklist(buttonName) {
  fireEvent.click(await screen.findByRole("button", { name: buttonName }));
  fireEvent.click(await screen.findByRole("button", { name: "체크리스트 작성" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("실제 네트워크 호출 금지"); }));
  auth.session = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("종합 평점 (EditListingDialog)", () => {
  // 실제 앱에서 팝업은 닫힌 채로 떠 있다가 열린다(열리는 순간 값이 채워진다).
  // 테스트도 같은 순서를 따른다.
  function renderDialog(props = {}) {
    const onSave = vi.fn();
    const dialog = (open) => (
      <EditListingDialog open={open} item={ITEM} onSave={onSave} onCancel={() => {}} {...props} />
    );
    const view = render(dialog(false));
    view.rerender(dialog(true));
    return onSave;
  }

  it("항목을 고르면 종합 평점이 자동으로 계산돼 보인다", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "체크리스트 작성" }));
    expect(screen.getByText("항목을 체크하면 종합 평점이 자동으로 계산돼요.")).toBeTruthy();

    // 첫 항목(대중교통 편리)을 "좋음"으로. 고르지 않은 묶음은 계산에서 빠지므로 5점.
    fireEvent.click(screen.getAllByLabelText("좋음")[0]);
    expect(screen.getByText("자동 계산 5점")).toBeTruthy();
  });

  it("직접 고른 평점이 자동 계산을 이기고, 다시 누르면 자동으로 돌아간다", async () => {
    const onSave = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "체크리스트 작성" }));
    fireEvent.click(screen.getAllByLabelText("좋음")[0]);

    fireEvent.click(screen.getByLabelText("2")); // 자동 5점이지만 2점으로 고쳐 고른다
    expect(screen.getByLabelText("2").checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][3]).toBe(2);

    fireEvent.click(screen.getByLabelText("2")); // 같은 값을 다시 누르면 자동 계산으로
    expect(screen.getByLabelText("5").checked).toBe(true);
  });

  it("저장하면 체크리스트와 평점을 함께 올려보낸다", async () => {
    const onSave = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "체크리스트 작성" }));
    fireEvent.click(screen.getAllByLabelText("좋음")[0]);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [id, , checklist, rating] = onSave.mock.calls[0];
    expect(id).toBe("item-1");
    expect(checklist.transport).toBe(3);
    expect(checklist.school).toBeNull(); // 고르지 않은 항목은 미확인
    expect(rating).toBe(5);
  });

  it("저장해둔 값으로 화면을 채운다", () => {
    renderDialog({ initialChecklist: { transport: 1 }, initialRating: 4 });
    fireEvent.click(screen.getByRole("button", { name: "체크리스트 작성" }));
    expect(screen.getAllByLabelText("나쁨")[0].checked).toBe(true);
    // 자동 계산은 1점인데 저장된 평점은 4점 - 직접 고른 값으로 보고 지킨다.
    expect(screen.getByLabelText("4").checked).toBe(true);
  });
});

describe("서버 저장 배선 (NaejipsaApp)", () => {
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
    ] });
    updateDashboardItemDetails.mockResolvedValue({});
  });

  it("팝업을 열 때 저장해둔 체크리스트를 불러와 보여준다", async () => {
    getInspection.mockResolvedValue(record());
    render(<NaejipsaApp />);
    await login();

    await openChecklist("단지1 수정");
    expect(getInspection).toHaveBeenCalledWith(11); // 화면용 id가 아니라 서버 id로
    expect(screen.getAllByLabelText("좋음")[0].checked).toBe(true);
    expect(screen.getByLabelText("5").checked).toBe(true);
  });

  it("저장하면 서버 id로 보내고, 쓰지 않은 메모는 그대로 유지한다", async () => {
    getInspection.mockResolvedValue(record());
    saveInspection.mockResolvedValue(record({ overall_rating: 3 }));
    render(<NaejipsaApp />);
    await login();

    await openChecklist("단지1 수정");
    fireEvent.click(screen.getByLabelText("3")); // 평점을 3점으로 고쳐 고른다
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(saveInspection).toHaveBeenCalled());
    const [propertyId, payload] = saveInspection.mock.calls[0];
    expect(propertyId).toBe(11);
    expect(payload.transport).toBe(3);
    expect(payload.overall_rating).toBe(3);
    expect(payload.memo).toBe("이전 메모"); // 모바일에서 쓴 메모를 지우지 않는다
    expect(payload).not.toHaveProperty("id"); // 정의되지 않은 키는 422가 된다
    expect(payload).not.toHaveProperty("property_id");
  });

  it("기록이 없으면 빈 체크리스트로 시작한다", async () => {
    getInspection.mockResolvedValue(null); // 서버 404 -> null
    render(<NaejipsaApp />);
    await login();

    await openChecklist("단지1 수정");
    expect(screen.getAllByLabelText("좋음")[0].checked).toBe(false);
    expect(screen.getByText("항목을 체크하면 종합 평점이 자동으로 계산돼요.")).toBeTruthy();
  });
});
