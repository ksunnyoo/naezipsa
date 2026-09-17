// 같은 단지·평형을 담을 때 "이미 담은 집인가요?"를 언제 묻고 언제 안 묻는가.
//
// 동·호수를 필수로 받지 않는 대신, **카드에서 구분이 안 될 때만** 묻는다.
// 판정은 카드에 쓰는 것과 같은 unitText로 하므로 "화면에서 구분되는가"와
// "물어보는가"가 어긋나지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import NaejipsaApp from "@/components/NaejipsaApp";
import { createDashboardItem, getDashboardItems, getInspections, getMyProfile } from "@/lib/api";

const auth = vi.hoisted(() => ({ callback: null, session: null }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: { auth: {
  getSession: async () => ({ data: { session: auth.session } }),
  onAuthStateChange: (callback) => { auth.callback = callback; return { data: { subscription: { unsubscribe: () => {} } } }; },
  signOut: async () => {},
} } }));
vi.mock("@/lib/api", () => ({
  getMyProfile: vi.fn(), updateMyProfile: vi.fn(), getDashboardItems: vi.fn(),
  createDashboardItem: vi.fn(), updateDashboardItemDetails: vi.fn(), deleteDashboardItem: vi.fn(),
  reorderDashboardItems: vi.fn(), getGroups: vi.fn(), getGroup: vi.fn(), createGroup: vi.fn(),
  renameGroup: vi.fn(), deleteGroup: vi.fn(), addGroupItems: vi.fn(), removeGroupItem: vi.fn(),
  createDashboardShare: vi.fn(), getDashboardShare: vi.fn(), createGroupShareLink: vi.fn(),
  revokeGroupShareLinks: vi.fn(), getSharedGroup: vi.fn(), getInspection: vi.fn(),
  saveInspection: vi.fn(), getInspections: vi.fn(), deleteInspection: vi.fn(),
  updateGroupScoring: vi.fn(),
}));

// 담기 버튼 두 개만 노출한다 - 하나는 구분 정보 없이, 하나는 층을 넣어서.
const SAME = { name: "래미안", sizeLabel: "84.95㎡", sizeId: 200, price: "", floor: "", dong: "", ho: "" };
const WITH_FLOOR = { ...SAME, floor: "12" };
vi.mock("@/components/Modal/InterestModal", () => ({ default: ({ open, onSubmit }) => (open ? (
  <div>
    <button onClick={() => onSubmit(SAME)}>구분없이 담기</button>
    <button onClick={() => onSubmit(WITH_FLOOR)}>12층으로 담기</button>
  </div>
) : null) }));
vi.mock("@/components/Workspace", () => ({ default: ({ items, onAdd }) => (
  <div>
    <button onClick={onAdd}>매물 추가</button>
    <p>{`후보 ${items.length}개`}</p>
  </div>
) }));
vi.mock("@/components/Modal/AuthModal", () => ({ default: () => null }));
vi.mock("@/components/EditListingDialog", () => ({ default: ({ open, item }) => (
  open ? <p>{`수정 중: ${item?.id}`}</p> : null
) }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("실제 네트워크 호출 금지"); }));
  auth.session = null;
  getMyProfile.mockResolvedValue({ service_purposes: ["buy"] });
  getInspections.mockResolvedValue({ count: 0, items: [] });
  // 이미 담아둔 후보 하나: 같은 평형, 구분 정보 없음 -> 카드에 "위치 미입력"
  getDashboardItems.mockResolvedValue({ items: [
    { id: 11, size_id: 200, complex_name: "래미안", representative_area: 84.95, checked: true },
  ] });
  createDashboardItem.mockResolvedValue({ id: 12 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function login() {
  await act(async () => {
    auth.session = { user: { id: "user-a" } };
    auth.callback("SIGNED_IN", auth.session);
  });
}

describe("같은 단지·평형을 또 담을 때", () => {
  it("카드에서 구분이 안 되면 먼저 묻는다", async () => {
    render(<NaejipsaApp />);
    await login();
    await screen.findByText("후보 1개");

    fireEvent.click(screen.getByRole("button", { name: "매물 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "구분없이 담기" }));

    expect(await screen.findByRole("dialog", { name: "이미 담은 집인지 확인" })).toBeTruthy();
    // 묻는 동안에는 아직 담지 않는다.
    expect(createDashboardItem).not.toHaveBeenCalled();
    expect(screen.getByText("후보 1개")).toBeTruthy();
  });

  it("층이 달라 카드에서 구분되면 묻지 않고 그냥 담는다", async () => {
    render(<NaejipsaApp />);
    await login();
    await screen.findByText("후보 1개");

    fireEvent.click(screen.getByRole("button", { name: "매물 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "12층으로 담기" }));

    await waitFor(() => expect(createDashboardItem).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "이미 담은 집인지 확인" })).toBeNull();
    expect(await screen.findByText("후보 2개")).toBeTruthy();
  });

  it('"이미 담은 집이에요"를 고르면 담지 않고 기존 후보를 연다', async () => {
    render(<NaejipsaApp />);
    await login();
    await screen.findByText("후보 1개");
    fireEvent.click(screen.getByRole("button", { name: "매물 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "구분없이 담기" }));
    await screen.findByRole("dialog", { name: "이미 담은 집인지 확인" });

    fireEvent.click(screen.getByRole("button", { name: "이미 담은 집이에요" }));

    expect(await screen.findByText("수정 중: item-1")).toBeTruthy();
    expect(createDashboardItem).not.toHaveBeenCalled();
    expect(screen.getByText("후보 1개")).toBeTruthy();
  });

  it('"다른 집이에요"를 고르면 담고 나서 바로 수정 창을 연다', async () => {
    render(<NaejipsaApp />);
    await login();
    await screen.findByText("후보 1개");
    fireEvent.click(screen.getByRole("button", { name: "매물 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "구분없이 담기" }));
    await screen.findByRole("dialog", { name: "이미 담은 집인지 확인" });

    fireEvent.click(screen.getByRole("button", { name: "다른 집이에요" }));

    // 담고(2개), 구분 정보를 넣도록 새 후보의 수정 창을 연다.
    expect(await screen.findByText("후보 2개")).toBeTruthy();
    expect(createDashboardItem).toHaveBeenCalled();
    expect(await screen.findByText("수정 중: item-2")).toBeTruthy();
  });
});
