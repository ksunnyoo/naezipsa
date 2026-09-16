"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloseIcon, GoogleIcon, KakaoIcon, LoginIcon } from "../icons";
import { supabase } from "@/lib/supabaseClient";

// 2026-09: 로그인/회원가입을 Supabase Auth에 실제로 연결하면서, 과거에
// 로그인/중복확인을 흉내내던 하드코딩 아이디 목록(VALID_IDS)은 제거했다.

// Supabase가 돌려주는 에러 메시지(영어)를 자주 나오는 것 위주로 한국어
// 안내문으로 바꿔준다. 못 알아본 에러는 원문을 괄호로 같이 보여준다 -
// 디버깅할 때 원인을 바로 알 수 있도록.
function translateSupabaseAuthError(err) {
  const message = err?.message || "";
  if (message.includes("Invalid login credentials")) {
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }
  if (message.includes("User already registered")) {
    return "이미 가입된 이메일입니다.";
  }
  if (message.includes("Email not confirmed")) {
    return "인증해야 사용할 수 있는 이메일입니다. 받은 메일함의 인증 링크를 눌러 주세요.";
  }
  if (message.includes("Password should be at least")) {
    return "비밀번호가 너무 짧습니다.";
  }
  if (message.includes("you can only request this after")) {
    return "잠시 후 다시 요청해 주세요.";
  }
  if (message.toLowerCase().includes("email rate limit exceeded")) {
    return "인증 메일 발송 한도를 넘었어요. 잠시 후 다시 시도해 주세요.";
  }
  return message
    ? `요청을 처리하지 못했습니다. (${message})`
    : "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

// Supabase Auth의 Confirm email이 켜져 있을 때, 인증 링크를 누르지 않은 계정의
// 로그인 시도는 이 오류로 온다.
function isEmailNotConfirmed(err) {
  return err?.code === "email_not_confirmed" || (err?.message || "").includes("Email not confirmed");
}

const SIGNUP_AGREEMENTS = [
  { key: "all", label: "전제 동의하기" },
  { key: "terms", label: "[필수] 내집사 이용약관", required: true },
  { key: "privacy", label: "[필수] 개인정보 처리방침", required: true },
  { key: "marketing", label: "[선택] 마케팅 정보 수신 동의", required: false },
];

// Feature toggles for temporary shutdown.
// Set a flag to true to restore the flow later in one place.
const FEATURE_FLAGS = {
  login: true,
  kakaoLogin: false, // 이메일 제공 권한 준비 전까지 카카오 로그인 보류.
  accountRecovery: false,
  signupTerms: false,
  signupPhone: false,
};

export default function AuthModal({ open, onClose, onSignupComplete }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [screen, setScreen] = useState("login");
  const [agreements, setAgreements] = useState({
    all: false,
    terms: false,
    privacy: false,
    marketing: false,
  });
  const [signupStep, setSignupStep] = useState(0);
  const [signupData, setSignupData] = useState({
    username: "",
    password: "",
    passwordConfirm: "",
    gender: "",
    birth: "",
    phone: "",
  });
  const [usernameCheckStatus, setUsernameCheckStatus] = useState("idle");
  const [usernameCheckMessage, setUsernameCheckMessage] = useState("");
  const [signupError, setSignupError] = useState("");
  const [signupSubmitting, setSignupSubmitting] = useState(false);
  // 인증 메일을 보낸 가입 이메일(가입 직후 안내 화면)과, 인증 전이라 로그인에
  // 실패한 이메일(로그인 화면의 재발송 버튼). 재발송 진행 상태는 둘이 공유한다.
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState("");
  const [unconfirmedEmail, setUnconfirmedEmail] = useState("");
  const [resendStatus, setResendStatus] = useState({ state: "idle", message: "" });
  const [verificationCode, setVerificationCode] = useState("");
  const [showVerificationInput, setShowVerificationInput] = useState(false);
  const [recoveryType, setRecoveryType] = useState(null);
  const [recoveryName, setRecoveryName] = useState("");
  const [recoveryUsername, setRecoveryUsername] = useState("");
  const [recoveryPhone, setRecoveryPhone] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [showRecoveryCodeInput, setShowRecoveryCodeInput] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryResult, setRecoveryResult] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = useState("");

  const phoneInputRef = useRef(null);
  const verificationInputRef = useRef(null);
  const recoveryPhoneInputRef = useRef(null);
  const recoveryVerificationInputRef = useRef(null);
  const modalRef = useRef(null);
  const usernameInputRef = useRef(null);
  const loginButtonRef = useRef(null);
  const consentButtonRef = useRef(null);
  const nameInputRef = useRef(null);
  const birthInputRef = useRef(null);

  const signupSteps = useMemo(() => {
    const steps = [
      { key: "username", title: "이메일을 입력해 주세요", label: "이메일" },
      {
        key: "password",
        title: "비밀번호를 설정해 주세요",
        label: "비밀번호",
      },
      // { key: "gender", title: "성별을 선택해 주세요", label: "성별" },
      // { key: "birth", title: "생년월일을 입력해 주세요", label: "생년월일" },
    ];

    // if (FEATURE_FLAGS.signupPhone) {
    //   steps.push({
    //     key: "phone",
    //     title: "휴대폰 번호를 입력해 주세요",
    //     label: "휴대폰 번호",
    //   });
    // }

    return steps;
  }, []);

  const requiredAgreementsChecked = agreements.terms && agreements.privacy;
  const currentSignupStep = signupSteps[signupStep];

  const resetRecoveryState = useCallback(() => {
    setRecoveryType(null);
    setRecoveryName("");
    setRecoveryUsername("");
    setRecoveryPhone("");
    setRecoveryCode("");
    setShowRecoveryCodeInput(false);
    setRecoveryError("");
    setRecoveryResult("");
    setRecoveryPassword("");
    setRecoveryPasswordConfirm("");
  }, []);

  const resetAuthState = useCallback(() => {
    setUsername("");
    setPassword("");
    setError("");
    setLoginSubmitting(false);
    setScreen("login");
    setAgreements({
      all: false,
      terms: false,
      privacy: false,
      marketing: false,
    });
    setSignupStep(0);
    setSignupData({
      username: "",
      password: "",
      passwordConfirm: "",
      gender: "",
      birth: "",
      phone: "",
    });
    setUsernameCheckStatus("idle");
    setUsernameCheckMessage("");
    setSignupError("");
    setSignupSubmitting(false);
    setPendingVerificationEmail("");
    setUnconfirmedEmail("");
    setResendStatus({ state: "idle", message: "" });
    setVerificationCode("");
    setShowVerificationInput(false);
    resetRecoveryState();
  }, [resetRecoveryState]);

  const handleClose = useCallback(() => {
    resetAuthState();
    onClose();
  }, [onClose, resetAuthState]);

  const getFocusableElements = useCallback(() => {
    if (!modalRef.current) return [];

    return Array.from(
      modalRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => {
      const style = window.getComputedStyle(element);
      return (
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        element.getAttribute("aria-hidden") !== "true"
      );
    });
  }, []);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        handleClose();
        return;
      }

      if (event.key !== "Tab" || !modalRef.current) return;

      const focusable = getFocusableElements();
      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const currentIndex = focusable.indexOf(document.activeElement);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (currentIndex === -1) {
        event.preventDefault();
        if (event.shiftKey) {
          last.focus();
        } else {
          first.focus();
        }
        return;
      }

      const nextIndex = event.shiftKey ? currentIndex - 1 : currentIndex + 1;
      const target = focusable[nextIndex];

      if (target) {
        event.preventDefault();
        target.focus();
        return;
      }

      event.preventDefault();
      if (event.shiftKey) {
        last.focus();
      } else {
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleClose, getFocusableElements]);

  useEffect(() => {
    if (!open || !modalRef.current) return;

    requestAnimationFrame(() => {
      if (screen === "login") {
        usernameInputRef.current?.focus();
        return;
      }

      if (screen === "signup") {
        consentButtonRef.current?.focus();
        return;
      }

      if (screen === "signup-form") {
        if (signupStep === 0) {
          nameInputRef.current?.focus();
          return;
        }

        if (signupStep === 1) {
          const passwordInput = modalRef.current?.querySelector(
            'input[type="password"]',
          );
          passwordInput?.focus();
        }
      }
    });
  }, [open, screen, signupStep]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  async function handleSubmit(event) {
    event.preventDefault();

    const email = username.trim();
    if (!isValidEmailValue(email)) {
      setError("올바른 이메일 형식을 입력해 주세요.");
      return;
    }

    if (!password.trim()) {
      setError("비밀번호를 입력해 주세요.");
      return;
    }

    setError("");
    setLoginSubmitting(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoginSubmitting(false);

    if (authError) {
      setError(translateSupabaseAuthError(authError));
      // 인증 전 이메일이면 같은 자리에서 인증 메일을 다시 받을 수 있게 한다.
      setUnconfirmedEmail(isEmailNotConfirmed(authError) ? email : "");
      setResendStatus({ state: "idle", message: "" });
      return;
    }

    resetAuthState();
    onClose();
  }

  async function handleOAuthLogin(provider) {
    if (provider === "kakao" && !FEATURE_FLAGS.kakaoLogin) return;
    setError("");
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo:
          typeof window !== "undefined" ? window.location.origin : undefined,
      },
    });

    if (authError) {
      setError(translateSupabaseAuthError(authError));
    }
    // 정상적인 경우 Supabase가 제공자 로그인 페이지로 이동시키므로, 이 모달은
    // 돌아온 뒤 onAuthStateChange 리스너(NaejipsaApp)가 세션을 인식하면서
    // 자연스럽게 닫힌 상태로 이어진다.
  }

  // 인증 링크를 누르면 돌아올 앱 주소. Supabase SDK가 돌아온 URL의 토큰으로 세션을
  // 만들고, NaejipsaApp의 onAuthStateChange가 로그인 상태로 바꾼다.
  // (Supabase 대시보드 Authentication -> URL Configuration의 Redirect URLs에 이 주소가 있어야 한다.)
  function verificationRedirectTo() {
    return typeof window !== "undefined" ? window.location.origin : undefined;
  }

  async function handleResendVerification(email) {
    if (!email || resendStatus.state === "sending") return;
    setResendStatus({ state: "sending", message: "" });
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: verificationRedirectTo() },
    });
    setResendStatus(
      resendError
        ? { state: "error", message: translateSupabaseAuthError(resendError) }
        : { state: "sent", message: "인증 메일을 다시 보냈어요. 받은 메일함을 확인해 주세요." },
    );
  }

  function handleAgreementToggle(key) {
    if (key === "all") {
      const next = !agreements.all;
      setAgreements({ all: next, terms: next, privacy: next, marketing: next });
      return;
    }

    const nextValue = !agreements[key];
    const nextAgreements = { ...agreements, [key]: nextValue };
    nextAgreements.all =
      nextAgreements.terms &&
      nextAgreements.privacy &&
      nextAgreements.marketing;
    setAgreements(nextAgreements);
  }

  function canProceedSignup() {
    if (screen !== "signup-form") return false;

    // if (FEATURE_FLAGS.signupPhone) {
    //   if (signupStep !== signupSteps.length - 1) return false;
    //   return (
    //     signupData.phone.replace(/\D/g, "").length >= 8 &&
    //     verificationCode.replace(/\D/g, "").length === 6
    //   );
    // }

    return (
      signupStep === signupSteps.length - 1 &&
      signupData.password.length >= 8 &&
      signupData.password === signupData.passwordConfirm
    );
  }

  async function handleSignupComplete() {
    if (!canProceedSignup()) return;

    setSignupError("");
    setSignupSubmitting(true);
    const email = signupData.username.trim();
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password: signupData.password,
      options: { emailRedirectTo: verificationRedirectTo() },
    });
    setSignupSubmitting(false);

    // Confirm email이 켜져 있으면 이미 가입된 이메일에도 오류 대신 identities가 빈
    // 사용자로 성공처럼 응답한다(가입 여부 노출 방지). 꺼져 있으면 오류로 온다.
    const alreadyRegistered =
      Boolean(authError?.message?.includes("already registered")) ||
      (!authError && data?.user?.identities?.length === 0);

    if (alreadyRegistered) {
      // 오류 문구가 비밀번호 단계에만 보이므로, 이메일 단계로 돌아가 그 자리에 보여준다.
      setSignupStep(0);
      setUsernameCheckStatus("error");
      setUsernameCheckMessage("이미 가입된 이메일입니다.");
      return;
    }

    if (authError) {
      setSignupError(translateSupabaseAuthError(authError));
      return;
    }

    // 세션이 없으면 인증 메일이 발송된 상태다. 링크를 눌러야 로그인할 수 있다.
    if (!data?.session) {
      setPendingVerificationEmail(email);
      setResendStatus({ state: "idle", message: "" });
      setScreen("signup-verify");
      return;
    }

    resetAuthState();
    onClose();
    onSignupComplete?.();
  }

  function isValidEmailValue(value) {
    const trimmed = value.trim();
    if (!trimmed) return false;
    // 형식만 간단히 검증한다 - 실제 존재/중복 여부는 Supabase가
    // signUp()/signInWithPassword() 호출 시점에 최종 판단한다.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  }

  function handleUsernameChange(nextValue) {
    const trimmedValue = nextValue.slice(0, 20);
    setSignupData((prev) => ({ ...prev, username: trimmedValue }));

    if (usernameCheckStatus !== "idle") {
      setUsernameCheckStatus("idle");
      setUsernameCheckMessage("");
    }
  }

  function handleUsernameCheck() {
    const normalized = signupData.username.trim();
    if (!isValidEmailValue(normalized)) {
      setUsernameCheckStatus("idle");
      setUsernameCheckMessage("");
      return;
    }

    // Supabase는 이메일 중복 여부를 사전에 안전하게 확인하는 API를 제공하지
    // 않는다(이메일 추측 공격 방지). 여기서는 형식만 확인하고, 실제 중복
    // 여부는 handleSignupComplete()의 signUp() 호출 시점에 확인된다.
    setUsernameCheckStatus("available");
    setUsernameCheckMessage("사용 가능한 이메일 형식입니다.");
  }

  function handlePasswordChange(nextValue, field) {
    setSignupData((prev) => ({
      ...prev,
      [field]: nextValue,
    }));
  }

  function handleNextSignupStep() {
    if (screen !== "signup-form") return;

    if (signupStep === 0) {
      if (!isValidEmailValue(signupData.username)) return;
      if (usernameCheckStatus !== "available") return;
      setSignupStep(1);
      return;
    }

    if (signupStep === 1) {
      if (signupData.password.length < 8) return;
      if (signupData.password !== signupData.passwordConfirm) return;
      handleSignupComplete();
    }
  }

  // function handleGenderSelect(value) {
  //   setSignupData((prev) => ({
  //     ...prev,
  //     gender: value,
  //   }));

  //   if (screen === "signup-form" && signupStep === 2) {
  //     setSignupStep(3);
  //   }
  // }

  // function handleBirthChange(nextValue) {
  //   const digits = nextValue.replace(/\D/g, "").slice(0, 8);
  //   setSignupData((prev) => ({ ...prev, birth: digits }));
  //   if (
  //     screen === "signup-form" &&
  //     signupStep === 3 &&
  //     digits.length === 8 &&
  //     FEATURE_FLAGS.signupPhone
  //   ) {
  //     setSignupStep(4);
  //     requestAnimationFrame(() => phoneInputRef.current?.focus());
  //   }
  // }

  function handlePhoneChange(nextValue) {
    const digits = nextValue.replace(/\D/g, "").slice(0, 8);
    setSignupData((prev) => ({ ...prev, phone: digits }));
    if (screen === "signup-form" && signupStep === 3) {
      if (digits.length < 8) {
        setShowVerificationInput(false);
        setVerificationCode("");
      }
    }
  }

  function handleVerifyPhone() {
    if (signupData.phone.replace(/\D/g, "").length < 8) return;
    setShowVerificationInput(true);
    setVerificationCode("");
    requestAnimationFrame(() => verificationInputRef.current?.focus());
  }

  function openRecoveryFlow(type) {
    resetRecoveryState();
    setRecoveryType(type);
    setScreen(type === "id" ? "find-id" : "find-password");
  }

  function handleRecoveryPhoneChange(nextValue) {
    const digits = nextValue.replace(/\D/g, "").slice(0, 8);
    setRecoveryPhone(digits);
    if (digits.length < 8) {
      setShowRecoveryCodeInput(false);
      setRecoveryCode("");
      setRecoveryError("");
    }
  }

  function handleRecoveryVerifyPhone() {
    if (recoveryPhone.replace(/\D/g, "").length < 8) return;
    setShowRecoveryCodeInput(true);
    setRecoveryCode("");
    setRecoveryError("");
    requestAnimationFrame(() => recoveryVerificationInputRef.current?.focus());
  }

  function handleRecoverySubmit() {
    if (screen === "find-id") {
      if (!recoveryName.trim()) {
        setRecoveryError("이름을 입력해 주세요.");
        return;
      }

      if (recoveryPhone.replace(/\D/g, "").length < 8) {
        setRecoveryError("휴대폰 번호를 입력해 주세요.");
        return;
      }

      if (recoveryCode.replace(/\D/g, "").length !== 6) {
        setRecoveryError("인증번호 6자리를 입력해 주세요.");
        return;
      }

      setRecoveryError("");
      setRecoveryResult("demo");
      setScreen("find-id-result");
      return;
    }

    if (screen === "find-password") {
      if (!recoveryUsername.trim()) {
        setRecoveryError("아이디를 입력해 주세요.");
        return;
      }

      if (recoveryPhone.replace(/\D/g, "").length < 8) {
        setRecoveryError("휴대폰 번호를 입력해 주세요.");
        return;
      }

      if (recoveryCode.replace(/\D/g, "").length !== 6) {
        setRecoveryError("인증번호 6자리를 입력해 주세요.");
        return;
      }

      setRecoveryError("");
      setScreen("find-password-reset");
      return;
    }

    if (screen === "find-password-reset") {
      const trimmedPassword = recoveryPassword.trim();
      const trimmedConfirm = recoveryPasswordConfirm.trim();

      if (!trimmedPassword || !trimmedConfirm) {
        setRecoveryError("비밀번호를 입력해 주세요.");
        return;
      }

      if (trimmedPassword !== trimmedConfirm) {
        setRecoveryError("비밀번호를 확인해 주세요.");
        return;
      }

      setRecoveryError("");
      setRecoveryResult("비밀번호가 변경되었습니다.");
      setScreen("find-password-result");
    }
  }

  function goToSignupStep(index) {
    if (index < 0 || index >= signupSteps.length) return;
    setSignupStep(index);
  }

  function renderRecoveryScreen() {
    const isIdRecovery = recoveryType === "id";

    return (
      <div className="auth-signup-flow">
        <h2 className="auth-signup-title">
          {isIdRecovery ? "아이디 찾기" : "비밀번호 찾기"}
        </h2>

        {isIdRecovery && (
          <label className="auth-field">
            <span>이름</span>
            <input
              type="text"
              value={recoveryName}
              onChange={(event) => setRecoveryName(event.target.value)}
              placeholder="이름을 입력해 주세요"
            />
          </label>
        )}

        {!isIdRecovery && (
          <label className="auth-field">
            <span>아이디</span>
            <input
              type="text"
              value={recoveryUsername}
              onChange={(event) => setRecoveryUsername(event.target.value)}
              placeholder="아이디를 입력해 주세요"
            />
          </label>
        )}

        <label className="auth-field">
          <span>휴대폰 번호</span>
          <div className="phone-input-row">
            <button
              type="button"
              className="phone-prefix"
              onClick={() => recoveryPhoneInputRef.current?.focus()}
            >
              010
            </button>
            <input
              ref={recoveryPhoneInputRef}
              type="tel"
              value={recoveryPhone}
              onChange={(event) =>
                handleRecoveryPhoneChange(event.target.value)
              }
              placeholder="12345678"
              inputMode="numeric"
            />
            {recoveryPhone.replace(/\D/g, "").length >= 8 && (
              <button
                type="button"
                className="phone-verify-btn"
                onClick={handleRecoveryVerifyPhone}
              >
                인증하기
              </button>
            )}
          </div>
          {showRecoveryCodeInput && (
            <div className="verification-row" key="recovery-verification-row">
              <input
                ref={recoveryVerificationInputRef}
                type="tel"
                value={recoveryCode}
                onChange={(event) =>
                  setRecoveryCode(
                    event.target.value.replace(/\D/g, "").slice(0, 6),
                  )
                }
                placeholder="인증번호 6자리"
                inputMode="numeric"
              />
            </div>
          )}
        </label>

        {recoveryError && (
          <p className="auth-error" role="alert">
            {recoveryError}
          </p>
        )}

        <button
          type="button"
          className="auth-submit-btn"
          disabled={
            isIdRecovery
              ? !recoveryName.trim() ||
                recoveryPhone.replace(/\D/g, "").length < 8 ||
                recoveryCode.replace(/\D/g, "").length !== 6
              : !recoveryUsername.trim() ||
                recoveryPhone.replace(/\D/g, "").length < 8 ||
                recoveryCode.replace(/\D/g, "").length !== 6
          }
          onClick={handleRecoverySubmit}
        >
          {screen === "find-password" ? "다음" : "다음"}
        </button>
      </div>
    );
  }

  function renderPasswordResetScreen() {
    return (
      <div className="auth-signup-flow">
        <h2 className="auth-signup-title">비밀번호 재설정</h2>

        <label className="auth-field">
          <span>새 비밀번호</span>
          <input
            type="password"
            value={recoveryPassword}
            onChange={(event) => setRecoveryPassword(event.target.value)}
            placeholder="비밀번호를 입력해 주세요"
          />
        </label>

        <label className="auth-field">
          <span>비밀번호 확인</span>
          <input
            type="password"
            value={recoveryPasswordConfirm}
            onChange={(event) => setRecoveryPasswordConfirm(event.target.value)}
            placeholder="비밀번호를 다시 입력해 주세요"
          />
        </label>

        {recoveryError && (
          <p className="auth-error" role="alert">
            {recoveryError}
          </p>
        )}

        <button
          type="button"
          className="auth-submit-btn"
          disabled={!recoveryPassword || !recoveryPasswordConfirm}
          onClick={handleRecoverySubmit}
        >
          변경
        </button>
      </div>
    );
  }

  function renderRecoveryResultScreen() {
    const isIdRecovery = recoveryType === "id";

    return (
      <div className="auth-signup-flow">
        <h2 className="auth-signup-title">
          {isIdRecovery ? "아이디 찾기" : "비밀번호 찾기"}
        </h2>

        <div
          className="auth-error"
          style={{
            background: "#edfdf6",
            borderColor: "rgba(11, 183, 109, 0.2)",
            color: "#0e8f59",
          }}
        >
          {isIdRecovery
            ? `회원님의 아이디는 ${recoveryResult} 입니다.`
            : recoveryResult}
        </div>

        <button
          type="button"
          className="auth-submit-btn"
          onClick={() => {
            resetAuthState();
            onClose();
          }}
        >
          로그인
        </button>
      </div>
    );
  }

  function renderLoginScreen() {
    return (
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="auth-sns-wrap">
          <div className="auth-sns-list" aria-label="SNS 로그인">
            <button
              type="button"
              className="sns-btn sns-google"
              disabled={loginSubmitting}
              onClick={() => handleOAuthLogin("google")}
            >
              <GoogleIcon />
              <span className="sns-btn-label">구글 계정으로 로그인하기</span>
            </button>
            {FEATURE_FLAGS.kakaoLogin && (
              <button
                type="button"
                className="sns-btn sns-kakao"
                disabled={loginSubmitting}
                onClick={() => handleOAuthLogin("kakao")}
              >
                <KakaoIcon />
                <span className="sns-btn-label">카카오 계정으로 로그인하기</span>
              </button>
            )}
          </div>

          <div className="auth-divider">
            <span>또는</span>
          </div>
        </div>

        <label className="auth-field">
          <span>이메일</span>
          <input
            ref={usernameInputRef}
            type="email"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              if (error) setError("");
            }}
            placeholder="이메일을 입력해 주세요"
            autoComplete="email"
          />
        </label>

        <label className="auth-field">
          <span>비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (error) setError("");
            }}
            placeholder="비밀번호를 입력해 주세요"
            autoComplete="current-password"
          />
        </label>

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        {error && unconfirmedEmail && (
          <div className="auth-service-links">
            <button
              type="button"
              className="auth-text-link"
              disabled={resendStatus.state === "sending"}
              onClick={() => handleResendVerification(unconfirmedEmail)}
            >
              {resendStatus.state === "sending" ? "보내는 중..." : "인증 메일 다시 보내기"}
            </button>
          </div>
        )}
        {error && unconfirmedEmail && resendStatus.message && (
          <p
            className={resendStatus.state === "error" ? "auth-error" : "username-check-message is-success"}
            role="status"
          >
            {resendStatus.message}
          </p>
        )}

        <button
          ref={loginButtonRef}
          type="submit"
          className="auth-submit-btn"
          disabled={loginSubmitting}
        >
          {loginSubmitting ? "로그인 중..." : "로그인"}
          <LoginIcon />
        </button>

        {FEATURE_FLAGS.login && (
          <div
            className="auth-service-links"
            aria-label="회원가입 및 계정 찾기"
          >
            <button
              type="button"
              className="auth-text-link"
              onClick={() =>
                setScreen(FEATURE_FLAGS.signupTerms ? "signup" : "signup-form")
              }
            >
              회원가입
            </button>
            {FEATURE_FLAGS.accountRecovery && (
              <>
                <span className="auth-link-separator" aria-hidden="true" />
                <button
                  type="button"
                  className="auth-text-link"
                  onClick={() => openRecoveryFlow("id")}
                >
                  아이디 찾기
                </button>
                <span className="auth-link-separator" aria-hidden="true" />
                <button
                  type="button"
                  className="auth-text-link"
                  onClick={() => openRecoveryFlow("password")}
                >
                  비밀번호 찾기
                </button>
              </>
            )}
          </div>
        )}
      </form>
    );
  }

  function renderSignupConsentScreen() {
    return (
      <div className="auth-signup-flow">
        <h2 className="auth-signup-title">
          회원가입을 위한 약관 동의가 필요해요
        </h2>

        <div className="signup-agreement-list">
          {SIGNUP_AGREEMENTS.map((item) => (
            <label key={item.key} className="agreement-row">
              <span className="agreement-checkbox">
                <input
                  type="checkbox"
                  checked={agreements[item.key]}
                  onChange={() => handleAgreementToggle(item.key)}
                />
                <span
                  className="agreement-checkbox-visual"
                  aria-hidden="true"
                />
              </span>
              <span className="agreement-label">{item.label}</span>
              {item.key !== "all" && item.key !== "marketing" && (
                <button type="button" className="agreement-more-btn">
                  보기
                </button>
              )}
            </label>
          ))}
        </div>

        {FEATURE_FLAGS.signupTerms && (
          <button
            ref={consentButtonRef}
            type="button"
            className="auth-submit-btn"
            aria-disabled={!requiredAgreementsChecked}
            onClick={() => {
              if (!requiredAgreementsChecked) return;
              setScreen("signup-form");
            }}
          >
            다음
          </button>
        )}
        {!FEATURE_FLAGS.signupTerms && (
          <button
            ref={consentButtonRef}
            type="button"
            className="auth-submit-btn"
            onClick={() => setScreen("signup-form")}
          >
            다음
          </button>
        )}
      </div>
    );
  }

  function renderSignupVerifyScreen() {
    return (
      <div className="auth-signup-flow">
        <h2 className="auth-signup-title">인증 메일을 보냈어요</h2>
        <p>
          <strong>{pendingVerificationEmail}</strong>로 보낸 메일의 인증 링크를 누르면
          가입이 완료되고 바로 로그인돼요.
        </p>
        <p>메일이 보이지 않으면 스팸함도 확인해 주세요.</p>
        {resendStatus.message && (
          <p
            className={resendStatus.state === "error" ? "auth-error" : "username-check-message is-success"}
            role="status"
          >
            {resendStatus.message}
          </p>
        )}
        <button
          type="button"
          className="auth-submit-btn"
          disabled={resendStatus.state === "sending"}
          onClick={() => handleResendVerification(pendingVerificationEmail)}
        >
          {resendStatus.state === "sending" ? "보내는 중..." : "인증 메일 다시 보내기"}
        </button>
        <div className="auth-service-links">
          <button
            type="button"
            className="auth-text-link"
            onClick={() => {
              const email = pendingVerificationEmail;
              resetAuthState();
              setUsername(email);
            }}
          >
            로그인 화면으로
          </button>
        </div>
      </div>
    );
  }

  function renderSignupFormScreen() {
    const completedSteps = signupSteps.slice(0, signupStep).filter((step) => {
      if (step.key === "username")
        return isValidEmailValue(signupData.username);
      if (step.key === "password")
        return (
          signupData.password.length >= 8 &&
          signupData.password === signupData.passwordConfirm
        );
      return false;
    });

    return (
      <div className="auth-signup-flow">
        <div className="signup-summary-list">
          {completedSteps.map((step, index) => {
            const value =
              step.key === "username"
                ? signupData.username
                : step.key === "password"
                  ? signupData.password
                    ? "비밀번호 설정 완료"
                    : ""
                  : "";

            return (
              <button
                key={step.key}
                type="button"
                className="signup-summary-row"
                onClick={() => goToSignupStep(signupSteps.indexOf(step))}
              >
                <div className="signup-summary-label">{step.label}</div>
                <div className="signup-summary-value">{value}</div>
              </button>
            );
          })}
        </div>

        <div className="signup-step-stack">
          <div className="signup-step-panel" key={currentSignupStep.key}>
            <div className="signup-step-title">{currentSignupStep.title}</div>

            {currentSignupStep.key === "username" && (
              <label className="signup-field">
                <span>{currentSignupStep.label}</span>
                <div className="username-check-row">
                  <input
                    ref={nameInputRef}
                    type="email"
                    value={signupData.username}
                    onChange={(event) =>
                      handleUsernameChange(event.target.value)
                    }
                    placeholder="이메일을 입력해 주세요"
                    autoComplete="email"
                  />
                  <button
                    type="button"
                    className="username-check-btn"
                    disabled={!isValidEmailValue(signupData.username)}
                    onClick={handleUsernameCheck}
                  >
                    확인
                  </button>
                </div>
                {usernameCheckStatus !== "idle" && (
                  <p
                    className={
                      "username-check-message" +
                      (usernameCheckStatus === "available"
                        ? " is-success"
                        : " is-error")
                    }
                  >
                    {usernameCheckMessage}
                  </p>
                )}
              </label>
            )}

            {currentSignupStep.key === "password" && (
              <div className="auth-form">
                <label className="auth-field">
                  <span>비밀번호</span>
                  <input
                    type="password"
                    value={signupData.password}
                    onChange={(event) =>
                      handlePasswordChange(event.target.value, "password")
                    }
                    placeholder="비밀번호를 입력해 주세요"
                  />
                </label>

                <label className="auth-field">
                  <span>비밀번호 확인</span>
                  <input
                    type="password"
                    value={signupData.passwordConfirm}
                    onChange={(event) =>
                      handlePasswordChange(
                        event.target.value,
                        "passwordConfirm",
                      )
                    }
                    placeholder="비밀번호를 다시 입력해 주세요"
                  />
                </label>

                {signupError && (
                  <p className="auth-error" role="alert">
                    {signupError}
                  </p>
                )}
              </div>
            )}

            {/* {currentSignupStep.key === "gender" && (
              <div className="signup-choice-group">
                {[
                  { value: "male", label: "남성" },
                  { value: "female", label: "여성" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={
                      "signup-choice-btn" +
                      (signupData.gender === option.value ? " is-selected" : "")
                    }
                    onClick={() => handleGenderSelect(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )} */}

            {/* {currentSignupStep.key === "birth" && (
              <label className="signup-field">
                <span>{currentSignupStep.label}</span>
                <input
                  ref={birthInputRef}
                  type="text"
                  value={signupData.birth}
                  onChange={(event) => handleBirthChange(event.target.value)}
                  placeholder="19930415"
                  inputMode="numeric"
                />
              </label>
            )} */}

            {currentSignupStep.key === "phone" && (
              <label className="signup-field">
                <span>{currentSignupStep.label}</span>
                <div className="phone-input-row">
                  <button
                    type="button"
                    className="phone-prefix"
                    onClick={() => phoneInputRef.current?.focus()}
                  >
                    010
                  </button>
                  <input
                    ref={phoneInputRef}
                    type="tel"
                    value={signupData.phone}
                    onChange={(event) => handlePhoneChange(event.target.value)}
                    placeholder="12345678"
                    inputMode="numeric"
                  />
                  {signupData.phone.replace(/\D/g, "").length >= 8 && (
                    <button
                      type="button"
                      className="phone-verify-btn"
                      onClick={handleVerifyPhone}
                    >
                      인증하기
                    </button>
                  )}
                </div>
                {showVerificationInput && (
                  <div className="verification-row" key="verification-row">
                    <input
                      ref={verificationInputRef}
                      type="tel"
                      value={verificationCode}
                      onChange={(event) =>
                        setVerificationCode(
                          event.target.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                      placeholder="인증번호 6자리"
                      inputMode="numeric"
                    />
                  </div>
                )}
              </label>
            )}
          </div>
        </div>

        <button
          type="button"
          className="auth-submit-btn"
          disabled={
            signupStep < signupSteps.length - 1
              ? !(
                  (signupStep === 0 && usernameCheckStatus === "available") ||
                  (signupStep === 1 &&
                    signupData.password.length >= 8 &&
                    signupData.password === signupData.passwordConfirm)
                )
              : !canProceedSignup() || signupSubmitting
          }
          aria-disabled={
            signupStep < signupSteps.length - 1
              ? !(
                  (signupStep === 0 && usernameCheckStatus === "available") ||
                  (signupStep === 1 &&
                    signupData.password.length >= 8 &&
                    signupData.password === signupData.passwordConfirm)
                )
              : !canProceedSignup() || signupSubmitting
          }
          onClick={() => {
            const isCurrentStepReady =
              signupStep < signupSteps.length - 1
                ? (signupStep === 0 && usernameCheckStatus === "available") ||
                  (signupStep === 1 &&
                    signupData.password.length >= 8 &&
                    signupData.password === signupData.passwordConfirm)
                : canProceedSignup();

            if (!isCurrentStepReady) {
              return;
            }

            if (signupStep < signupSteps.length - 1) {
              handleNextSignupStep();
              return;
            }

            handleSignupComplete();
          }}
        >
          {signupStep === signupSteps.length - 1
            ? signupSubmitting
              ? "가입 중..."
              : "가입 완료"
            : "다음"}
        </button>
      </div>
    );
  }

  if (!open) return null;

  // 모달 상단 제목 - 로그인/회원가입 화면일 때만 노출(2026-09 요청). 계정
  // 찾기 등 나머지 화면은 각 화면 안에 자체 h2 제목이 이미 있어서 여기선
  // 비워둔다.
  const modalTitle =
    screen === "login"
      ? "로그인"
      : screen === "signup" || screen === "signup-form" || screen === "signup-verify"
        ? "회원가입"
        : null;

  return (
    <div
      className="modal-overlay auth-modal-overlay is-open"
      data-component="AuthModal"
      aria-hidden={false}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        ref={modalRef}
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-label={modalTitle || "로그인"}
        tabIndex={-1}
      >
        <div className="auth-modal-header">
          {modalTitle && <h2 className="auth-modal-title">{modalTitle}</h2>}
          <button
            type="button"
            className="modal-close auth-modal-close"
            aria-label="닫기"
            onClick={handleClose}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="auth-modal-body">
          {screen === "login" && renderLoginScreen()}
          {screen === "signup" &&
            (FEATURE_FLAGS.signupTerms
              ? renderSignupConsentScreen()
              : renderSignupFormScreen())}
          {screen === "signup-form" && renderSignupFormScreen()}
          {screen === "signup-verify" && renderSignupVerifyScreen()}
          {FEATURE_FLAGS.accountRecovery &&
            (screen === "find-id" || screen === "find-password") &&
            renderRecoveryScreen()}
          {screen === "find-password-reset" && renderPasswordResetScreen()}
          {(screen === "find-id-result" || screen === "find-password-result") &&
            renderRecoveryResultScreen()}
        </div>
      </div>
    </div>
  );
}
