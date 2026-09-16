"use client";

import { BellIcon, GearIcon, GroupSaveIcon, LoginIcon, ProfileIcon, ShareIcon } from "./icons";
import HeaderContentTabs from "./HeaderContentTabs";
import GroupBar from "./Dashboard/GroupBar";

// <Header /> : 로고 + 상세 데이터/인사이트 메뉴 + 우측 네비(알림/설정/로그인).
// 원래 있던 "단지 추가" 버튼은 헤더가 좁아지며(96px→72px) 요청으로 제거됨 —
// 매물 추가는 히어로 CTA와 대시보드 리스트의 "+ 매물 추가하기" 슬롯으로 충분.
//
// onLogoClick: 로고를 누르면 히어로(관심 매물 추가 CTA + 문서 안내)를 다시
// 슬라이드 다운시켜 홈으로 돌아가는 진입점 역할도 겸함.
//
// activeContentTab/onContentTabChange: 상세 데이터/인사이트 전환 - 실제 콘텐츠
// 슬라이드는 Workspace가 담당하고, 여기선 메뉴 UI + 클릭만 처리한다.
// showContentTabs: 관심 매물을 하나도 추가하기 전(히어로만 보이는 상태)에는
// 전환할 콘텐츠가 없으므로 숨기고, 대시보드가 한 번 노출된 뒤(dashboardRevealed)
// 부터 보여준다.
export default function Header({
  onLogoClick,
  onLoginClick,
  user,
  onLogoutClick,
  onProfileClick,
  profileReady,
  activeContentTab,
  onContentTabChange,
  showContentTabs,
  groupMenu,
  onShare,
}) {
  return (
    <div className="header" data-component="Header">
      <button
        type="button"
        id="logo-home-btn"
        className="logo-group"
        tabIndex={0}
        data-component="Logo"
        aria-label="홈으로"
        onClick={onLogoClick}
      >
        <img className="logo-mark" src="/logo-mark.png" alt="" />
        <span className="logo-word">내집사</span>
      </button>

      {showContentTabs && (
        <HeaderContentTabs active={activeContentTab} onChange={onContentTabChange} />
      )}

      <div className="header-actions" data-component="HeaderActions">
        {/* <button
          tabIndex={0}
          className="nav-icon-btn"
          type="button"
          aria-label="알림"
        >
          <BellIcon />
          <span className="badge-dot" />
        </button> */}
        {/* <button
          tabIndex={0}
          className="nav-icon-btn"
          type="button"
          aria-label="다크모드"
        >
          <GearIcon />
        </button> */}
        {user && (
          <>
            {/* group-save-wrap: position:relative 기준점. GroupBar는 이
                버튼 바로 아래에 position:absolute로 붙어서 중앙 정렬된다
                (Header 전체가 아니라 이 버튼 하나를 기준으로 뜬다). */}
            {groupMenu && (
              <div className="group-save-wrap">
                <button
                  type="button"
                  tabIndex={0}
                  className={"nav-icon-btn" + (groupMenu.open ? " is-active" : "")}
                  aria-label="그룹"
                  aria-expanded={groupMenu.open}
                  onClick={groupMenu.onToggle}
                >
                  <GroupSaveIcon />
                </button>
                {/* 닫힐 때 내려서, 이름을 고치던 상태가 다음에 열 때 남지 않게 한다. */}
                {groupMenu.open && <GroupBar menu={groupMenu} />}
              </div>
            )}
            <button
              type="button"
              tabIndex={0}
              className="nav-icon-btn"
              aria-label="공유하기"
              title={groupMenu?.activeGroup ? "보고 있는 그룹 링크 공유" : "관심 매물 공유"}
              onClick={onShare}
            >
              <ShareIcon />
            </button>
          </>
        )}
        {user ? (
          <div className="nav-user" data-component="NavUser">
            {/* 공유·그룹과 같은 원형 아이콘 버튼. 화면 읽기 프로그램에는 "마이페이지"로 읽힌다. */}
            <button
              type="button"
              tabIndex={0}
              className="nav-icon-btn"
              aria-label="마이페이지"
              onClick={onProfileClick}
              disabled={!profileReady}
              title={profileReady ? "마이페이지" : "프로필을 불러온 후 이용할 수 있습니다"}
            >
              <ProfileIcon />
            </button>
            <button
              type="button"
              tabIndex={0}
              className="nav-link nav-logout-btn"
              onClick={onLogoutClick}
            >
              로그아웃
            </button>
          </div>
        ) : (
          <button
            type="button"
            tabIndex={0}
            className="nav-link nav-login-btn"
            onClick={onLoginClick}
          >
            로그인
            <LoginIcon />
          </button>
        )}
      </div>
    </div>
  );
}
