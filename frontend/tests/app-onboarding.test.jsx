import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import NaejipsaApp from "@/components/NaejipsaApp";
import { getMyProfile, updateMyProfile, getDashboardItems } from "@/lib/api";

const auth = vi.hoisted(() => ({ callback: null, session: null, unsubscribe: vi.fn() }));
vi.mock("@/lib/supabaseClient", () => ({ supabase: { auth: {
  getSession: async () => ({ data: { session: auth.session } }),
  onAuthStateChange: (callback) => { auth.callback = callback; return { data: { subscription: { unsubscribe: auth.unsubscribe } } }; },
  signOut: async () => { auth.session = null; auth.callback("SIGNED_OUT", null); },
} } }));
vi.mock("@/lib/api", () => ({
  getMyProfile: vi.fn(), updateMyProfile: vi.fn(), getDashboardItems: vi.fn(),
  createDashboardItem: vi.fn(), updateDashboardItemDetails: vi.fn(), deleteDashboardItem: vi.fn(),
}));
vi.mock("@/components/Workspace", () => ({ default: ({ userId, items, onAdd, onEdit }) => <div>
  <div>현재 사용자: {userId ?? "게스트"}</div>
  <button onClick={onAdd}>후보 등록 열기</button>
  {items.length > 0 && <button onClick={() => onEdit(items[0].id)}>후보 편집 열기</button>}
</div> }));
vi.mock("@/components/Modal/InterestModal", () => ({ default: function MockInterestModal({ open, onClose }) {
  // 실제 등록 모달의 scroll lock 해제 순서까지 재현한다.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [open]);
  return open && <section role="dialog" aria-label="후보 등록">
    <input aria-label="등록 입력" defaultValue="" />
    <button onClick={onClose}>후보 등록 닫기</button>
  </section>;
} }));
vi.mock("@/components/EditListingDialog", () => ({ default: ({ open, onCancel }) => open && <section role="dialog" aria-label="후보 편집">
  <input aria-label="편집 입력" defaultValue="" />
  <button onClick={onCancel}>후보 편집 닫기</button>
</section> }));
vi.mock("@/components/Modal/AuthModal", () => ({ default: () => null }));
// 공유 모달은 닫혀 있어도 dialog를 그려 두고 CSS로 숨기는데, jsdom은 CSS를
// 적용하지 않는다. 이 파일은 온보딩·마이페이지 dialog만 세므로 다른 모달처럼 대체한다.
vi.mock("@/components/Modal/ImportShareModal", () => ({ default: () => null }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("실제 네트워크 호출 금지"); }));
  auth.session = null;
  getDashboardItems.mockResolvedValue({ items: [] });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("실제 앱에서 session 생성 → 기존 프로필 조회 → 온보딩 → skip 저장 → 즉시 재로그인이 연결된다", async () => {
  let purposes = null;
  getMyProfile.mockImplementation(async (userId) => ({ user_id: userId, service_purposes: purposes }));
  updateMyProfile.mockImplementation(async (payload, userId) => {
    purposes = payload.service_purposes;
    return { user_id: userId, service_purposes: purposes };
  });
  const view = render(<NaejipsaApp />);
  expect(getMyProfile).not.toHaveBeenCalled();
  await act(async () => {
    auth.session = { user: { id: "a" } };
    auth.callback("SIGNED_IN", auth.session);
  });
  await screen.findByRole("dialog");
  expect(getMyProfile).toHaveBeenCalledWith("a");
  expect(view.container.querySelector("#main-screen").hasAttribute("inert")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(view.container.querySelector("#main-screen").hasAttribute("inert")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  await screen.findByText("현재 사용자: 게스트");
  await act(async () => {
    auth.session = { user: { id: "a" } };
    auth.callback("SIGNED_IN", auth.session);
  });
  await waitFor(() => expect(getMyProfile).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("dialog")).toBeNull();
  view.unmount();
  expect(auth.unsubscribe).toHaveBeenCalledOnce();
});

it("앱의 프로필 재조회 버튼으로 실패를 복구한다", async () => {
  auth.session = { user: { id: "b" } };
  getMyProfile.mockRejectedValueOnce(new Error("연결 실패"))
    .mockResolvedValueOnce({ user_id: "b", service_purposes: null });
  render(<NaejipsaApp />);
  fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
  await screen.findByRole("dialog");
});

it.each([
  ["후보 등록", "등록 입력"],
  ["후보 편집", "편집 입력"],
])("늦은 프로필 조회가 %s 모달과 입력을 유지하고 닫힌 뒤 온보딩을 연다", async (dialogName, inputLabel) => {
  let resolveProfile;
  const pendingProfile = new Promise((resolve) => { resolveProfile = resolve; });
  auth.session = { user: { id: "a" } };
  getMyProfile.mockReturnValueOnce(pendingProfile);
  updateMyProfile.mockResolvedValue({ user_id: "a", service_purposes: [] });
  getDashboardItems.mockResolvedValue({ items: [{ id: 11, size_id: 101, complex_name: "기존 후보" }] });
  const view = render(<NaejipsaApp />);
  await screen.findByText("현재 사용자: a");
  fireEvent.click(await screen.findByRole("button", { name: `${dialogName} 열기` }));
  fireEvent.change(screen.getByLabelText(inputLabel), { target: { value: "보존할 입력 내용" } });

  await act(async () => { resolveProfile({ user_id: "a", service_purposes: null }); });

  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByRole("dialog", { name: dialogName })).toBeTruthy();
  expect(screen.getByLabelText(inputLabel).value).toBe("보존할 입력 내용");
  expect(screen.queryByRole("dialog", { name: "내게 맞는 인사이트 준비하기" })).toBeNull();
  expect(view.container.querySelector("#main-screen").hasAttribute("inert")).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: `${dialogName} 닫기` }));

  const onboarding = await screen.findByRole("dialog", { name: "내게 맞는 인사이트 준비하기" });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(document.activeElement).toBe(onboarding);
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.body.style.overflow).toBe("");
  expect(view.container.querySelector("#main-screen").hasAttribute("inert")).toBe(false);
});

function completedProfile(userId = "a") {
  return { user_id: userId, nickname: "기존 닉네임", age_group: "30s", service_purposes: ["buy"] };
}

it("로그인 후 프로필 준비가 끝나야 마이페이지를 열고 기존 값으로 수정·저장할 수 있다", async () => {
  let resolveProfile;
  getMyProfile.mockReturnValueOnce(new Promise((resolve) => { resolveProfile = resolve; }));
  updateMyProfile.mockImplementation(async (payload, userId) => ({ ...completedProfile(userId), ...payload }));
  render(<NaejipsaApp />);
  expect(screen.queryByRole("button", { name: "마이페이지" })).toBeNull();
  await act(async () => {
    auth.session = { user: { id: "a", email: "a@example.com" } };
    auth.callback("SIGNED_IN", auth.session);
  });
  const entry = screen.getByRole("button", { name: "마이페이지" });
  // 글자 없이 아이콘만 보이는 버튼이다(이름은 aria-label).
  expect(entry.textContent).toBe("");
  expect(entry.querySelector("svg")).not.toBeNull();
  expect(entry.disabled).toBe(true);
  fireEvent.click(entry);
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => { resolveProfile(completedProfile()); });
  expect(entry.disabled).toBe(false);
  fireEvent.click(entry);
  expect(screen.getByRole("dialog", { name: "마이페이지" })).toBeTruthy();
  expect(screen.getByText("로그인 계정: a@example.com")).toBeTruthy();
  expect(screen.getByLabelText("닉네임 (선택)").value).toBe("기존 닉네임");
  expect(screen.getByLabelText("나이대 (선택)").value).toBe("30s");
  expect(screen.getByRole("button", { name: "매매" }).getAttribute("aria-pressed")).toBe("true");

  fireEvent.change(screen.getByLabelText("닉네임 (선택)"), { target: { value: " 새 닉네임 " } });
  fireEvent.change(screen.getByLabelText("나이대 (선택)"), { target: { value: "40s" } });
  fireEvent.click(screen.getByRole("button", { name: "전세" }));
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(updateMyProfile).toHaveBeenCalledExactlyOnceWith({ nickname: "새 닉네임", age_group: "40s", service_purposes: ["buy", "jeonse"] }, "a");
  fireEvent.click(screen.getByRole("button", { name: "마이페이지" }));
  expect(screen.getByLabelText("닉네임 (선택)").value).toBe("새 닉네임");
  expect(screen.getByLabelText("나이대 (선택)").value).toBe("40s");
  expect(screen.getByRole("button", { name: "전세" }).getAttribute("aria-pressed")).toBe("true");
});

it("마이페이지에서 목적을 모두 해제하면 []를 저장하고 재로그인해도 온보딩이 반복되지 않는다", async () => {
  let stored = completedProfile();
  auth.session = { user: { id: "a" } };
  getMyProfile.mockImplementation(async () => structuredClone(stored));
  updateMyProfile.mockImplementation(async (payload) => { stored = { ...stored, ...payload }; return structuredClone(stored); });
  render(<NaejipsaApp />);
  await waitFor(() => expect(screen.getByRole("button", { name: "마이페이지" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "마이페이지" }));
  fireEvent.click(screen.getByRole("button", { name: "매매" }));
  expect(screen.getByRole("button", { name: "변경사항 저장" }).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(updateMyProfile).toHaveBeenCalledExactlyOnceWith({ nickname: "기존 닉네임", age_group: "30s", service_purposes: [] }, "a");

  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  await screen.findByRole("button", { name: "로그인" });
  await act(async () => {
    auth.session = { user: { id: "a" } };
    auth.callback("SIGNED_IN", auth.session);
  });
  await waitFor(() => expect(getMyProfile).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "마이페이지" }));
  expect(screen.getByRole("button", { name: "매매" }).getAttribute("aria-pressed")).toBe("false");
});

it("계정 전환은 열린 마이페이지를 닫고 이전 저장 응답이 새 계정 편집창을 닫거나 덮어쓰지 않는다", async () => {
  let resolveSave;
  auth.session = { user: { id: "a" } };
  getMyProfile.mockImplementation(async (userId) => ({ ...completedProfile(userId), nickname: `${userId} 닉네임` }));
  updateMyProfile.mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
  render(<NaejipsaApp />);
  await waitFor(() => expect(screen.getByRole("button", { name: "마이페이지" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "마이페이지" }));
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  await act(async () => {
    auth.session = { user: { id: "b" } };
    auth.callback("SIGNED_IN", auth.session);
  });
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "마이페이지" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "마이페이지" }));
  await act(async () => { resolveSave(completedProfile("a")); });
  expect(screen.getByRole("dialog", { name: "마이페이지" })).toBeTruthy();
  expect(screen.getByLabelText("닉네임 (선택)").value).toBe("b 닉네임");
  expect(updateMyProfile).toHaveBeenCalledOnce();
});
