import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AuthModal from "@/components/Modal/AuthModal";
import { supabase } from "@/lib/supabaseClient";

vi.mock("@/lib/supabaseClient", () => ({ supabase: { auth: {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signInWithOAuth: vi.fn(),
  resend: vi.fn(),
} } }));

const auth = supabase.auth;
const EMAIL = "new.user@example.com";
const PASSWORD = "password123";

function renderModal() {
  const onClose = vi.fn();
  const onSignupComplete = vi.fn();
  render(<AuthModal open onClose={onClose} onSignupComplete={onSignupComplete} />);
  return { onClose, onSignupComplete };
}

function signup(email = EMAIL) {
  fireEvent.click(screen.getByRole("button", { name: "회원가입" }));
  fireEvent.change(screen.getByPlaceholderText("이메일을 입력해 주세요"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "확인" }));
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  fireEvent.change(screen.getByPlaceholderText("비밀번호를 입력해 주세요"), { target: { value: PASSWORD } });
  fireEvent.change(screen.getByPlaceholderText("비밀번호를 다시 입력해 주세요"), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: "가입 완료" }));
}

function login(email = EMAIL, password = PASSWORD) {
  fireEvent.change(screen.getByPlaceholderText("이메일을 입력해 주세요"), { target: { value: email } });
  fireEvent.change(screen.getByPlaceholderText("비밀번호를 입력해 주세요"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /^로그인/ }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("requestAnimationFrame", (callback) => setTimeout(callback, 0));
  auth.signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
  auth.resend.mockResolvedValue({ data: {}, error: null });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("회원가입 — Supabase Confirm email", () => {
  it("인증 메일을 보냈으면 안내 화면을 띄우고 모달을 닫지 않는다", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null, user: { identities: [{ id: "i" }] } }, error: null });
    const { onClose, onSignupComplete } = renderModal();
    signup();

    expect(await screen.findByText("인증 메일을 보냈어요")).toBeTruthy();
    expect(screen.getByText(EMAIL)).toBeTruthy();
    expect(auth.signUp).toHaveBeenCalledWith({
      email: EMAIL,
      password: PASSWORD,
      options: { emailRedirectTo: window.location.origin },
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(onSignupComplete).not.toHaveBeenCalled();
  });

  it("안내 화면에서 인증 메일을 다시 보낼 수 있다", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null, user: { identities: [{ id: "i" }] } }, error: null });
    renderModal();
    signup();
    fireEvent.click(await screen.findByRole("button", { name: "인증 메일 다시 보내기" }));

    expect((await screen.findByRole("status")).textContent).toContain("인증 메일을 다시 보냈어요");
    expect(auth.resend).toHaveBeenCalledWith({
      type: "signup",
      email: EMAIL,
      options: { emailRedirectTo: window.location.origin },
    });
  });

  it("재발송 대기 시간 제한은 한국어로 안내한다", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null, user: { identities: [{ id: "i" }] } }, error: null });
    auth.resend.mockResolvedValue({ data: {}, error: { message: "For security purposes, you can only request this after 42 seconds." } });
    renderModal();
    signup();
    fireEvent.click(await screen.findByRole("button", { name: "인증 메일 다시 보내기" }));

    expect((await screen.findByRole("status")).textContent).toContain("잠시 후 다시 요청해 주세요.");
  });

  it("'로그인 화면으로'는 가입한 이메일을 채운 로그인 화면으로 돌아간다", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null, user: { identities: [{ id: "i" }] } }, error: null });
    renderModal();
    signup();
    fireEvent.click(await screen.findByRole("button", { name: "로그인 화면으로" }));

    expect(screen.getByPlaceholderText("이메일을 입력해 주세요").value).toBe(EMAIL);
    expect(screen.getByRole("button", { name: /^로그인/ })).toBeTruthy();
  });

  it("Confirm email이 꺼져 있어 세션이 오면 바로 로그인 상태로 닫는다", async () => {
    auth.signUp.mockResolvedValue({ data: { session: { access_token: "t" }, user: { identities: [{ id: "i" }] } }, error: null });
    const { onClose, onSignupComplete } = renderModal();
    signup();

    await waitFor(() => expect(onSignupComplete).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("이미 가입된 이메일(빈 identities)은 인증 화면 대신 이메일 단계에서 안내한다", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null, user: { identities: [] } }, error: null });
    renderModal();
    signup();

    expect(await screen.findByText("이미 가입된 이메일입니다.")).toBeTruthy();
    expect(screen.queryByText("인증 메일을 보냈어요")).toBeNull();
  });

  it("Confirm email이 꺼져 있을 때의 중복 가입 오류도 같은 자리에서 안내한다", async () => {
    auth.signUp.mockResolvedValue({ data: {}, error: { message: "User already registered" } });
    renderModal();
    signup();

    expect(await screen.findByText("이미 가입된 이메일입니다.")).toBeTruthy();
  });
});

describe("로그인 — 인증하지 않은 이메일", () => {
  it("인증해야 사용할 수 있다고 안내하고 그 이메일로 인증 메일을 다시 보낸다", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { code: "email_not_confirmed", message: "Email not confirmed" },
    });
    const { onClose } = renderModal();
    login();

    expect((await screen.findByRole("alert")).textContent).toContain("인증해야 사용할 수 있는 이메일입니다.");
    fireEvent.click(screen.getByRole("button", { name: "인증 메일 다시 보내기" }));

    await waitFor(() => expect(auth.resend).toHaveBeenCalledWith({
      type: "signup",
      email: EMAIL,
      options: { emailRedirectTo: window.location.origin },
    }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("비밀번호가 틀린 경우에는 재발송 버튼을 보여주지 않는다", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });
    renderModal();
    login(EMAIL, "wrong-password");

    expect((await screen.findByRole("alert")).textContent).toContain("이메일 또는 비밀번호가 올바르지 않습니다.");
    expect(screen.queryByRole("button", { name: "인증 메일 다시 보내기" })).toBeNull();
  });
});
