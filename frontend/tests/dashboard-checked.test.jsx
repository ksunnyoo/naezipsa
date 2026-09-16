import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import NaejipsaApp from "@/components/NaejipsaApp";
import { fromBackendItem } from "@/lib/dashboardItems";
import { getDashboardItems, getMyProfile, updateDashboardItemDetails } from "@/lib/api";

const auth = vi.hoisted(() => ({ callback: null, session: null }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: { auth: {
  getSession: async () => ({ data: { session: auth.session } }),
  onAuthStateChange: (callback) => { auth.callback = callback; return { data: { subscription: { unsubscribe: () => {} } } }; },
  signOut: async () => { auth.session = null; auth.callback("SIGNED_OUT", null); },
} } }));
vi.mock("@/lib/api", () => ({
  getMyProfile: vi.fn(), updateMyProfile: vi.fn(), getDashboardItems: vi.fn(),
  createDashboardItem: vi.fn(), updateDashboardItemDetails: vi.fn(), deleteDashboardItem: vi.fn(),
}));
vi.mock("@/components/Workspace", () => ({ default: ({ items, onToggle }) => <ul>
  {items.map((item) => <li key={item.id}>
    <button onClick={() => onToggle(item.id)}>{`${item.name} ${item.checked ? "켜짐" : "꺼짐"}`}</button>
  </li>)}
</ul> }));
vi.mock("@/components/Modal/InterestModal", () => ({ default: () => null }));
vi.mock("@/components/EditListingDialog", () => ({ default: () => null }));
vi.mock("@/components/Modal/AuthModal", () => ({ default: () => null }));

// 서버에 저장된 체크 상태를 사용자별로 흉내 낸다.
const saved = new Map();
function backendItem(id, checked) {
  return { id, size_id: 200, complex_name: `단지${id}`, representative_area: 84.95, list_price: null, checked };
}

async function login(userId) {
  await act(async () => {
    auth.session = { user: { id: userId } };
    auth.callback("SIGNED_IN", auth.session);
  });
}
async function logout() {
  await act(async () => {
    auth.session = null;
    auth.callback("SIGNED_OUT", null);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("실제 네트워크 호출 금지"); }));
  auth.session = null;
  saved.clear();
  saved.set("a", new Map([[1, true]]));
  saved.set("b", new Map([[2, true]]));
  getMyProfile.mockResolvedValue({ service_purposes: [] });
  getDashboardItems.mockImplementation(async () => {
    const mine = saved.get(auth.session.user.id);
    return { items: [...mine].map(([id, checked]) => backendItem(id, checked)) };
  });
  updateDashboardItemDetails.mockImplementation(async (id, payload) => {
    saved.get(auth.session.user.id).set(id, payload.checked);
    return {};
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("서버 응답 → 화면 변환", () => {
  it("저장된 체크 상태로 복원하고, 값이 없는 예전 응답은 체크된 상태로 둔다", () => {
    expect(fromBackendItem(backendItem(1, false), "item-1").checked).toBe(false);
    expect(fromBackendItem(backendItem(1, true), "item-1").checked).toBe(true);
    const { checked: _omit, ...legacy } = backendItem(1, false);
    expect(fromBackendItem(legacy, "item-1").checked).toBe(true);
  });
});

describe("체크 토글 저장", () => {
  it("끄기 → 로그아웃 → 다시 로그인해도 꺼진 상태로 복원된다", async () => {
    render(<NaejipsaApp />);
    await login("a");
    fireEvent.click(await screen.findByRole("button", { name: "단지1 켜짐" }));
    await screen.findByRole("button", { name: "단지1 꺼짐" });

    await logout();
    await login("a");

    expect(await screen.findByRole("button", { name: "단지1 꺼짐" })).toBeTruthy();
  });

  it("PATCH에는 checked만 담아 다른 매물 정보를 덮어쓰지 않는다", async () => {
    render(<NaejipsaApp />);
    await login("a");
    fireEvent.click(await screen.findByRole("button", { name: "단지1 켜짐" }));

    await waitFor(() => expect(updateDashboardItemDetails).toHaveBeenCalledTimes(1));
    const [backendId, payload] = updateDashboardItemDetails.mock.calls[0];
    expect(backendId).toBe(1);
    expect(payload).toEqual({ checked: false });
  });

  it("저장에 실패하면 화면의 체크 상태를 바꾸지 않고 안내한다", async () => {
    updateDashboardItemDetails.mockRejectedValue(new Error("500"));
    render(<NaejipsaApp />);
    await login("a");
    fireEvent.click(await screen.findByRole("button", { name: "단지1 켜짐" }));

    expect(await screen.findByText("체크 상태를 저장하지 못했어요. 잠시 후 다시 시도해주세요.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "단지1 켜짐" })).toBeTruthy();
  });

  it("저장이 끝나기 전 연속 클릭은 한 번만 저장한다", async () => {
    let finish;
    updateDashboardItemDetails.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<NaejipsaApp />);
    await login("a");
    const button = await screen.findByRole("button", { name: "단지1 켜짐" });

    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => { finish({}); });

    expect(updateDashboardItemDetails).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "단지1 꺼짐" })).toBeTruthy();
  });

  it("사용자마다 체크 상태가 따로 저장된다", async () => {
    render(<NaejipsaApp />);
    await login("a");
    fireEvent.click(await screen.findByRole("button", { name: "단지1 켜짐" }));
    await screen.findByRole("button", { name: "단지1 꺼짐" });

    await logout();
    await login("b");

    expect(await screen.findByRole("button", { name: "단지2 켜짐" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /단지1/ })).toBeNull();
    expect(saved.get("a").get(1)).toBe(false);
    expect(saved.get("b").get(2)).toBe(true);
  });
});
