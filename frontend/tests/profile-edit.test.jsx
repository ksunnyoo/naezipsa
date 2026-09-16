import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProfileOnboardingModal from "@/components/Modal/ProfileOnboardingModal";

const PROFILE = { nickname: "기존 닉네임", age_group: "30s", service_purposes: ["buy"] };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("실제 네트워크 호출 금지"); }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(["취소", "Escape"])("마이페이지 %s는 변경한 내용을 저장하지 않고 닫는다", (action) => {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<ProfileOnboardingModal mode="edit" profile={PROFILE} onSave={onSave} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText("닉네임 (선택)"), { target: { value: "저장하지 않을 이름" } });
  fireEvent.click(screen.getByRole("button", { name: "전세" }));
  if (action === "Escape") fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  else fireEvent.click(screen.getByRole("button", { name: "취소" }));

  expect(onClose).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
});

it("저장 실패는 편집 내용과 목적을 유지하고 재시도 성공 후 닫는다", async () => {
  const onSave = vi.fn().mockRejectedValueOnce(new Error("프로필 저장 실패")).mockResolvedValueOnce({ ...PROFILE, nickname: "바꾼 이름" });
  const onClose = vi.fn();
  render(<ProfileOnboardingModal mode="edit" profile={PROFILE} onSave={onSave} onClose={onClose} />);
  fireEvent.change(screen.getByLabelText("닉네임 (선택)"), { target: { value: "바꾼 이름" } });
  fireEvent.change(screen.getByLabelText("나이대 (선택)"), { target: { value: "50s" } });
  fireEvent.click(screen.getByRole("button", { name: "전세" }));
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  expect((await screen.findByRole("alert")).textContent).toBe("프로필 저장 실패");
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByLabelText("닉네임 (선택)").value).toBe("바꾼 이름");
  expect(screen.getByLabelText("나이대 (선택)").value).toBe("50s");
  expect(screen.getByRole("button", { name: "전세" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onSave).toHaveBeenLastCalledWith({ nickname: "바꾼 이름", age_group: "50s", service_purposes: ["buy", "jeonse"] });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("저장 대기 중 닫기·취소·Escape와 중복 저장을 막는다", async () => {
  let resolveSave;
  const onSave = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
  const onClose = vi.fn();
  render(<ProfileOnboardingModal mode="edit" profile={PROFILE} onSave={onSave} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  expect(screen.getByRole("button", { name: "마이페이지 닫기" }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "취소" }).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "마이페이지 닫기" }));
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "저장 중…" }));
  expect(onSave).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { resolveSave(PROFILE); });
  expect(onClose).toHaveBeenCalledOnce();
});
