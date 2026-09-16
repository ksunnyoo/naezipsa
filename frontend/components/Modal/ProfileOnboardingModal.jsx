"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "../icons";

const PURPOSES = [["move", "이사"], ["buy", "매매"], ["jeonse", "전세"], ["invest", "투자"]];
const AGES = [["20s", "20대"], ["30s", "30대"], ["40s", "40대"], ["50s", "50대"], ["60s+", "60대 이상"]];

export default function ProfileOnboardingModal({ profile, onSave, mode = "onboarding", onClose, email }) {
  const editing = mode === "edit";
  const [nickname, setNickname] = useState(profile.nickname ?? "");
  const [ageGroup, setAgeGroup] = useState(profile.age_group ?? "");
  const [purposes, setPurposes] = useState(profile.service_purposes ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const modalRef = useRef(null);
  const busy = useRef(false);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  function keepFocus(event) {
    if (event.key === "Escape" && editing) {
      event.stopPropagation();
      if (!busy.current) onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...modalRef.current.querySelectorAll("input, select, button")]
      .filter((element) => !element.matches(":disabled"));
    const first = controls[0];
    const last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === modalRef.current)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  async function submit(skip) {
    if (busy.current || (!editing && !skip && purposes.length === 0)) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const saved = await onSave(skip ? { service_purposes: [] } : {
        nickname: nickname.trim() || null,
        age_group: ageGroup || null,
        service_purposes: purposes,
      });
      if (editing && saved !== false) onClose();
    } catch (err) {
      setError(err.message || "저장하지 못했어요. 다시 시도해 주세요.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="auth-modal-overlay is-open">
      <section className="auth-modal profile-onboarding" role="dialog" aria-modal="true"
        aria-labelledby="profile-title" aria-describedby="profile-intro" tabIndex={-1}
        ref={modalRef} onKeyDown={keepFocus}>
        <div className="auth-modal-header">
          <h2 className="auth-modal-title" id="profile-title">{editing ? "마이페이지" : "내게 맞는 인사이트 준비하기"}</h2>
          {editing && <button type="button" className="auth-modal-close" aria-label="마이페이지 닫기" disabled={pending} onClick={onClose}><CloseIcon /></button>}
        </div>
        <form className="auth-modal-body auth-form" onSubmit={(event) => { event.preventDefault(); submit(false); }}>
          <p className="profile-intro" id="profile-intro">간단한 정보를 알려주시면, 내집사가 더 나에게 맞는 AI 인사이트를 제공할 수 있어요.</p>
          {editing && email && <p className="profile-intro">로그인 계정: {email}</p>}
          <label className="auth-field">닉네임 (선택)
            <input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={30} disabled={pending} autoComplete="nickname" placeholder="비워 두면 랜덤 닉네임이 만들어져요" />
          </label>
          <label className="auth-field">나이대 (선택)
            <select value={ageGroup} onChange={(event) => setAgeGroup(event.target.value)} disabled={pending}>
              <option value="">선택 안 함</option>
              {AGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <fieldset className="profile-purposes" disabled={pending}>
            <legend>이용 목적 (복수 선택)</legend>
            <div className="chip-row">
              {PURPOSES.map(([value, label]) => (
                <button key={value} type="button" className={"chip" + (purposes.includes(value) ? " is-selected" : "")}
                  aria-pressed={purposes.includes(value)} onClick={() => setPurposes((current) =>
                    current.includes(value) ? current.filter((item) => item !== value) : [...current, value])}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit-btn" type="submit" disabled={pending || (!editing && purposes.length === 0)}>
            {pending ? "저장 중…" : editing ? "변경사항 저장" : "저장하고 시작하기"}
          </button>
          {editing ? (
            <button className="auth-text-link" type="button" disabled={pending} onClick={onClose}>취소</button>
          ) : (
            <button className="auth-text-link" type="button" disabled={pending} onClick={() => submit(true)}>건너뛰기</button>
          )}
        </form>
      </section>
    </div>
  );
}
