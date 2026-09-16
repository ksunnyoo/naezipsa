import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import useProfileOnboarding from "@/hooks/useProfileOnboarding";
import ProfileOnboardingModal from "@/components/Modal/ProfileOnboardingModal";
import { getMyProfile, updateMyProfile } from "@/lib/api";

vi.mock("@/lib/api", () => ({ getMyProfile: vi.fn(), updateMyProfile: vi.fn() }));

const rows = new Map();
function profile(userId, purposes = null) {
  return { user_id: userId, nickname: "기존 이름", age_group: "30s", service_purposes: purposes };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function Onboarding({ userId }) {
  const { profile, error, retry, save } = useProfileOnboarding(userId);
  return <>
    {error && <button onClick={retry}>프로필 재시도</button>}
    {profile?.service_purposes === null && <ProfileOnboardingModal key={userId} profile={profile} onSave={save} />}
  </>;
}

beforeEach(() => {
  vi.resetAllMocks();
  rows.clear();
  rows.set("a", profile("a"));
  rows.set("b", profile("b"));
  getMyProfile.mockImplementation(async (id) => structuredClone(rows.get(id)));
  updateMyProfile.mockImplementation(async (payload, id) => {
    const updated = { ...rows.get(id), ...payload };
    rows.set(id, updated);
    return structuredClone(updated);
  });
});
afterEach(cleanup);

describe("기존 프로필 API로 온보딩 완료 저장", () => {
  it("로그인 전 조회하지 않고 첫 로그인 null에서만 열리며 정확한 안내를 표시한다", async () => {
    const view = render(<Onboarding />);
    expect(getMyProfile).not.toHaveBeenCalled();
    view.rerender(<Onboarding userId="a" />);
    await screen.findByRole("dialog");
    expect(screen.getByText("간단한 정보를 알려주시면, 내집사가 더 나에게 맞는 AI 인사이트를 제공할 수 있어요.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "저장하고 시작하기" }).disabled).toBe(true);
  });

  it("목적을 저장하면 닫히고 재로그인 및 새로 마운트해도 반복하지 않는다", async () => {
    const view = render(<Onboarding userId="a" />);
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("닉네임 (선택)"), { target: { value: " 새 이름 " } });
    fireEvent.change(screen.getByLabelText("나이대 (선택)"), { target: { value: "40s" } });
    fireEvent.click(screen.getByRole("button", { name: "매매" }));
    fireEvent.click(screen.getByRole("button", { name: "이사" }));
    fireEvent.click(screen.getByRole("button", { name: "저장하고 시작하기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(updateMyProfile).toHaveBeenCalledWith({ nickname: "새 이름", age_group: "40s", service_purposes: ["buy", "move"] }, "a");
    view.rerender(<Onboarding />);
    view.rerender(<Onboarding userId="a" />);
    await waitFor(() => expect(getMyProfile).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.unmount();
    render(<Onboarding userId="a" />);
    await waitFor(() => expect(getMyProfile).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("건너뛰기는 []만 저장해 다른 필드를 보존하고 다음 로그인에 반복하지 않는다", async () => {
    const view = render(<Onboarding userId="a" />);
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("닉네임 (선택)"), { target: { value: "저장 안 할 이름" } });
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(updateMyProfile).toHaveBeenCalledWith({ service_purposes: [] }, "a");
    expect(rows.get("a").nickname).toBe("기존 이름");
    view.unmount();
    render(<Onboarding userId="a" />);
    await waitFor(() => expect(getMyProfile).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([{ purposes: [] }, { purposes: ["invest"] }])("기존 완료 상태 $purposes 는 온보딩을 열지 않는다", async ({ purposes }) => {
    rows.set("a", profile("a", purposes));
    render(<Onboarding userId="a" />);
    await waitFor(() => expect(getMyProfile).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateMyProfile).not.toHaveBeenCalled();
  });

  it("저장 실패는 모달을 유지하고 재시도에 성공하면 닫힌다", async () => {
    updateMyProfile.mockRejectedValueOnce(new Error("저장 실패"));
    render(<Onboarding userId="a" />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    expect((await screen.findByRole("alert")).textContent).toBe("저장 실패");
    expect(rows.get("a").service_purposes).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("프로필 조회 실패를 재시도할 수 있다", async () => {
    getMyProfile.mockRejectedValueOnce(new Error("연결 실패"));
    render(<Onboarding userId="a" />);
    fireEvent.click(await screen.findByRole("button", { name: "프로필 재시도" }));
    await screen.findByRole("dialog");
  });

  it("계정 전환 후 이전 계정의 늦은 GET과 PATCH 응답을 표시하지 않는다", async () => {
    const pendingGet = deferred();
    getMyProfile.mockReturnValueOnce(pendingGet.promise);
    const view = render(<Onboarding userId="a" />);
    view.rerender(<Onboarding userId="b" />);
    await screen.findByRole("dialog");
    await act(async () => pendingGet.resolve(profile("a", [])));
    expect(screen.queryByRole("dialog")).toBeTruthy();
    const pendingSave = deferred();
    updateMyProfile.mockReturnValueOnce(pendingSave.promise);
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    view.rerender(<Onboarding userId="a" />);
    await screen.findByRole("dialog");
    await act(async () => pendingSave.resolve(profile("b", [])));
    expect(screen.queryByRole("dialog")).toBeTruthy();
  });

  it("재로그인 GET이 늦어도 완료된 skip PATCH를 덮어쓰지 않는다", async () => {
    const view = render(<Onboarding userId="a" />);
    await screen.findByRole("dialog");
    view.rerender(<Onboarding />);
    const pendingGet = deferred();
    getMyProfile.mockReturnValueOnce(pendingGet.promise);
    view.rerender(<Onboarding userId="a" />);
    fireEvent.click(await screen.findByRole("button", { name: "건너뛰기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () => pendingGet.resolve(profile("a")));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("저장 중 중복 제출과 포커스 이탈을 막고 배경 스크롤을 복원한다", async () => {
    const pendingSave = deferred();
    updateMyProfile.mockReturnValueOnce(pendingSave.promise);
    const view = render(<Onboarding userId="a" />);
    const dialog = await screen.findByRole("dialog");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    expect(updateMyProfile).toHaveBeenCalledOnce();
    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => dialog.dispatchEvent(tabEvent));
    expect(tabEvent.defaultPrevented).toBe(true);
    view.unmount();
    expect(document.body.style.overflow).toBe("");
    await act(async () => pendingSave.resolve(profile("a", [])));
  });
});
