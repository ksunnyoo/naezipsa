"use client";

import { ArrowUpIcon } from "../icons";
// import DocumentLinkSection from "./DocumentLinkSection"; // 추후 구현 예정이라 주석 처리(2026-09)

// <MainHeroOverlay cleared /> : 블러 처리된 오버레이 레이어. cleared=true가
// 되면 위로 슬라이드되며 사라진다(.hero-overlay.is-cleared, globals.css).
//
// inert: 오버레이가 opacity/transform으로만 시각적으로 사라질 뿐 DOM에서
// 제거되지 않으므로(슬라이드 트랜지션 때문에 display:none을 못 씀), 걷힌
// 뒤에도 Tab이 안 보이는 내부 요소로 새지 않도록 React 19의 <div inert> 를
// 그대로 사용한다.
//
// showCloseBtn: "대시보드로 돌아가기" 버튼은 관심 매물을 한 번이라도 추가해
// 대시보드가 노출된 뒤에만(dashboardRevealed) 의미가 있어 그 전엔 계속 숨김.
export default function MainHeroOverlay({ cleared, showCloseBtn, onClose, onCtaClick }) {
  return (
    <div
      className={"hero-overlay" + (cleared ? " is-cleared" : "")}
      id="hero-overlay"
      data-component="MainHeroOverlay"
      inert={cleared}
    >
      <button
        type="button"
        className="hero-overlay-close"
        tabIndex={0}
        aria-label="대시보드로 돌아가기"
        hidden={!showCloseBtn}
        onClick={onClose}
      >
        <ArrowUpIcon />
        대시보드로 돌아가기
      </button>
      <div className="hero" data-component="MainHero">
        <h1>지금 관심있는 매물을 관리해보세요</h1>
        <p>내가 관심 있는 매물을 대시보드에 올려 다른 매물들과 같은 기준으로 관리할 수 있습니다.</p>
        <button
          tabIndex={0}
          className="cta-primary"
          type="button"
          id="open-modal-btn"
          data-component="CtaButton"
          onClick={onCtaClick}
        >
          관심 매물 추가하기
        </button>

        {/* 부동산 문서 출력 기능은 추후 구현 예정이라 우선 주석 처리(2026-09) */}
        {/* <div className="doc-section-label">부동산 문서 출력하러 가기</div>
        <DocumentLinkSection /> */}
      </div>
    </div>
  );
}
