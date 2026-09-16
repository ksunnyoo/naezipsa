import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import NaejipsaApp from "@/components/NaejipsaApp";
import {
  getDashboardItems,
  getMyProfile,
  reorderDashboardItems,
  updateDashboardItemDetails,
} from "@/lib/api";

// Phase 3 보완: 드래그 순서 저장. 실제 마우스 드래그 대신 Workspace를 대체해 드래그 결과를
// onReorder로 넘기고, 앱이 서버에 무엇을 보내고 실패를 어떻게 되돌리는지 확인한다.
const auth = vi.hoisted(() => ({ callback: null, session: null }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: { auth: {
  getSession: async () => ({ data: { session: auth.session } }),
  onAuthStateChange: (callback) => { auth.callback = callback; return { data: { subscription: { unsubscribe: () => {} } } }; },
  signOut: async () => { auth.session = null; auth.callback("SIGNED_OUT", null); },
} } }));
vi.mock("@/lib/api", () => ({
  getMyProfile: vi.fn(), updateMyProfile: vi.fn(), getDashboardItems: vi.fn(),
  createDashboardItem: vi.fn(), updateDashboardItemDetails: vi.fn(), deleteDashboardItem: vi.fn(),
  reorderDashboardItems: vi.fn(),
}));
vi.mock("@/components/Workspace", () => ({ default: ({ items, onReorder, onToggle, dragDisabled }) => <div>
  <ol aria-label="후보 목록">
    {items.map((item) => <li key={item.id}>{`${item.name}${item.checked ? "" : "(꺼짐)"}`}</li>)}
  </ol>
  <button disabled={dragDisabled} onClick={() => onReorder([...items].reverse())}>순서 뒤집기</button>
  <button onClick={() => onToggle(items[0].id)}>첫 후보 체크 토글</button>
</div> }));
vi.mock("@/components/Modal/InterestModal", () => ({ default: () => null }));
vi.mock("@/components/EditListingDialog", () => ({ default: () => null }));
vi.mock("@/components/Modal/AuthModal", () => ({ default: () => null }));

const ITEMS = [
  { id: 11, size_id: 200, complex_name: "가단지", checked: true },
  { id: 12, size_id: 201, complex_name: "나단지", checked: true },
  { id: 13, size_id: 202, complex_name: "다단지", checked: true },
];

function names() {
  return [...screen.getByRole("list", { name: "후보 목록" }).querySelectorAll("li")].map((li) => li.textContent);
}

function reverseButton() {
  return screen.getByRole("button", { name: "순서 뒤집기" });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function renderAs(userId) {
  auth.session = { user: { id: userId } };
  render(<NaejipsaApp />);
  await waitFor(() => expect(names().length).toBeGreaterThan(0));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("실제 네트워크 호출 금지"); }));
  auth.session = null;
  getMyProfile.mockResolvedValue({ service_purposes: [] });
  getDashboardItems.mockResolvedValue({ items: ITEMS });
  reorderDashboardItems.mockImplementation(async (itemIds) => ({ item_ids: itemIds }));
  updateDashboardItemDetails.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("드래그한 순서를 바로 보여주고, 전체 순서와 드래그 전 서버 순서를 저장하며, 저장 중에는 다음 드래그를 막는다", async () => {
  await renderAs("a");
  expect(names()).toEqual(["가단지", "나단지", "다단지"]);
  const pending = deferred();
  reorderDashboardItems.mockReturnValueOnce(pending.promise);

  fireEvent.click(reverseButton());

  expect(names()).toEqual(["다단지", "나단지", "가단지"]);
  expect(reorderDashboardItems).toHaveBeenCalledExactlyOnceWith([13, 12, 11], [11, 12, 13], "a");
  expect(reverseButton().disabled).toBe(true);

  await act(async () => { pending.resolve({ item_ids: [13, 12, 11] }); });
  expect(reverseButton().disabled).toBe(false);

  // 다음 저장은 방금 저장한 순서를 기준으로 보낸다.
  fireEvent.click(reverseButton());
  await waitFor(() => expect(reorderDashboardItems).toHaveBeenLastCalledWith([11, 12, 13], [13, 12, 11], "a"));
});

it("다른 곳에서 목록이 바뀌어 저장이 거절되면(409) 서버 목록을 다시 불러와 그 순서를 기준으로 삼는다", async () => {
  const serverNow = [ITEMS[1], ITEMS[0], ITEMS[2]];
  getDashboardItems.mockResolvedValueOnce({ items: ITEMS }).mockResolvedValueOnce({ items: serverNow });
  reorderDashboardItems.mockRejectedValueOnce(Object.assign(new Error("다른 곳에서 목록이 바뀌었습니다."), { status: 409 }));
  await renderAs("a");

  fireEvent.click(reverseButton());

  await screen.findByText("다른 곳에서 목록이 바뀌어 최신 순서로 다시 불러왔어요.");
  expect(names()).toEqual(["나단지", "가단지", "다단지"]);
  expect(getDashboardItems).toHaveBeenCalledTimes(2);

  fireEvent.click(reverseButton());
  await waitFor(() => expect(reorderDashboardItems).toHaveBeenLastCalledWith([13, 11, 12], [12, 11, 13], "a"));
});

it("저장과 다시 불러오기가 모두 실패하면 이전 순서로 되돌리되, 그사이 바꾼 체크 상태는 유지한다", async () => {
  await renderAs("a");
  const pending = deferred();
  reorderDashboardItems.mockReturnValueOnce(pending.promise);
  getDashboardItems.mockRejectedValueOnce(new Error("offline"));

  fireEvent.click(reverseButton());
  fireEvent.click(screen.getByRole("button", { name: "첫 후보 체크 토글" }));
  await waitFor(() => expect(names()[0]).toBe("다단지(꺼짐)"));

  await act(async () => { pending.reject(new Error("network")); });

  await screen.findByText("순서를 저장하지 못했어요. 이전 순서로 되돌렸어요.");
  expect(names()).toEqual(["가단지", "나단지", "다단지(꺼짐)"]);
  expect(reorderDashboardItems).toHaveBeenCalledOnce();
});

it("응답을 기다리는 동안 계정이 바뀌면 이전 계정의 늦은 실패를 새 계정 화면에 반영하지 않는다", async () => {
  getDashboardItems.mockImplementation(async () => ({
    items: auth.session.user.id === "a" ? ITEMS : [{ id: 21, size_id: 300, complex_name: "B단지", checked: true }],
  }));
  await renderAs("a");
  const pending = deferred();
  reorderDashboardItems.mockReturnValueOnce(pending.promise);

  fireEvent.click(reverseButton());
  await act(async () => {
    auth.session = { user: { id: "b" } };
    auth.callback("SIGNED_IN", auth.session);
  });
  await waitFor(() => expect(names()).toEqual(["B단지"]));

  await act(async () => { pending.reject(Object.assign(new Error("conflict"), { status: 409 })); });

  expect(names()).toEqual(["B단지"]);
  expect(getDashboardItems).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("다른 곳에서 목록이 바뀌어 최신 순서로 다시 불러왔어요.")).toBeNull();
  expect(reverseButton().disabled).toBe(false);
});
