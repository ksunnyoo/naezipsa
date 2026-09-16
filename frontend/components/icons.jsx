// 프로토타입에서 문자열을 리턴하던 svg 헬퍼 함수들을 그대로 React 컴포넌트로
// 옮긴 것. 색은 stroke/fill에 currentColor 또는 CSS 변수를 그대로 사용.

// SNS 로그인 버튼용 브랜드 로고 - stroke=currentColor를 쓰는 다른 아이콘들과
// 달리 브랜드 고유 색을 고정으로 쓴다(2026-09, 로그인 모달 SNS 버튼 개편).
export function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}

export function KakaoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="9" fill="#FEE500" />
      <path
        fill="#391B1B"
        d="M9 4.5c-3.31 0-6 2.14-6 4.78 0 1.7 1.13 3.19 2.83 4.03-.12.44-.45 1.63-.51 1.88-.08.31.11.32.24.23.1-.07 1.66-1.13 2.33-1.58.36.05.74.08 1.11.08 3.31 0 6-2.14 6-4.78S12.31 4.5 9 4.5Z"
      />
    </svg>
  );
}

// 로그인 버튼 옆 아이콘(2026-09) - 화살표가 문/괄호 모양 안으로 들어가는
// 표준 "로그인" 아이콘. 버튼 글자색을 그대로 물려받도록 stroke=currentColor.
export function LoginIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 8l4 4-4 4M14 12H3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12l5 5L19 7"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 6개 점의 반지름/간격을 키워 "잡고 옮길 수 있는 그립"이라는 인상을 강화.
// 색은 fill="currentColor"로 둬서 .interest-drag-handle의 color 값(hover/focus/
// 드래그 중 진해짐)을 그대로 물려받는다.
export function DragHandleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="8" cy="5.5" r="2" fill="currentColor" />
      <circle cx="16" cy="5.5" r="2" fill="currentColor" />
      <circle cx="8" cy="12" r="2" fill="currentColor" />
      <circle cx="16" cy="12" r="2" fill="currentColor" />
      <circle cx="8" cy="18.5" r="2" fill="currentColor" />
      <circle cx="16" cy="18.5" r="2" fill="currentColor" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 20l.9-3.6L16.2 5.1a1.5 1.5 0 0 1 2.1 0l.6.6a1.5 1.5 0 0 1 0 2.1L7.6 19.1 4 20Z"
        stroke="var(--color-text-secondary)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="var(--color-text-secondary)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 5v14M5 12h14"
        stroke="var(--color-text-secondary)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 9l6 6 6-6"
        stroke="var(--color-text-secondary)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronRightIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M9 6l6 6-6 6"
        stroke="var(--color-text-faint)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="6.5" stroke="var(--color-ink)" strokeWidth="1.8" />
      <path
        d="M20 20l-4.3-4.3"
        stroke="var(--color-ink)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BackArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M15 6l-6 6 6 6"
        stroke="var(--color-text-secondary)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke="var(--color-ink)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ArrowUpIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path
        d="M18 15l-6-6-6 6"
        stroke="var(--color-text-secondary)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HomeMarkIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 18 18" fill="none">
      <path
        d="M4 9.2 9 4.6 14 9.2"
        stroke="var(--color-on-logo)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.6 8.6V13.2H12.4V8.6"
        stroke="var(--color-on-logo)"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12.4" cy="13.2" r="1.5" fill="var(--color-on-logo)" />
    </svg>
  );
}

export function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 9a6 6 0 0 1 12 0c0 4.2 1.4 5.8 2 6.5H4c.6-.7 2-2.3 2-6.5Z"
        stroke="var(--color-ink)"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 18.5a2.5 2.5 0 0 0 5 0"
        stroke="var(--color-ink)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" stroke="var(--color-ink)" strokeWidth="1.7" />
      <path
        d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M17.8 6.2l-1.5 1.5M7.7 16.3l-1.5 1.5M17.8 17.8l-1.5-1.5M7.7 7.7 6.2 6.2"
        stroke="var(--color-ink)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function GroupSaveIcon() {
  // 탭이 달린 폴더 한 장 - 왼쪽 위 작은 탭(4,6.5~9,6.5)에서 대각선으로
  // 본체 윗변(10.5,8)에 이어붙인 뒤 사각형을 그리는 단일 닫힌 path.
  // 다른 아이콘들처럼 각 모서리는 strokeLinejoin="round"로만 둥글리고
  // 별도 호(arc) 명령은 쓰지 않는다.
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 6.5H9L10.5 8H20V19H4Z"
        stroke="var(--color-ink)"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 마이페이지 - 원형 머리와 아래가 평평한 반원형 몸통. 공유·그룹 아이콘과 같은
// 18px·선 두께 1.7로 맞춘다.
export function ProfileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="7.5" r="4" stroke="var(--color-ink)" strokeWidth="1.7" />
      <path
        d="M4.5 21V18.5A7.5 7.5 0 0 1 19.5 18.5V21Z"
        stroke="var(--color-ink)"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="18" cy="5.5" r="2.5" stroke="var(--color-ink)" strokeWidth="1.7" />
      <circle cx="6" cy="12" r="2.5" stroke="var(--color-ink)" strokeWidth="1.7" />
      <circle cx="18" cy="18.5" r="2.5" stroke="var(--color-ink)" strokeWidth="1.7" />
      <path
        d="M8.2 10.7 15.8 6.8M8.2 13.3l7.6 3.9"
        stroke="var(--color-ink)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

// 그룹 하위 버튼(저장된 그룹 하나)에 쓰는 문서 모양 아이콘. GroupSaveIcon(저장
// 트리거)과는 다른 아이콘 - 저장 동작이 아니라 "저장된 항목 하나"를 나타낸다.
export function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z"
        stroke="var(--color-text-secondary)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M6 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1"
        stroke="var(--color-text-secondary)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DocumentIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M7 3.5h7l4 4V20a.6.6 0 0 1-.6.6H7a.6.6 0 0 1-.6-.6V4.1a.6.6 0 0 1 .6-.6Z"
        stroke="var(--color-text-secondary)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M14 3.5V7a1 1 0 0 0 1 1h3M9 12.5h6M9 15.8h6"
        stroke="var(--color-text-secondary)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

// 매물 수정 팝업 우측 상단 "체크리스트 작성" 버튼용 클립보드+체크 아이콘.
export function ChecklistIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M5.5 6.5A1.5 1.5 0 0 1 7 5H17A1.5 1.5 0 0 1 18.5 6.5V19.5A1.5 1.5 0 0 1 17 21H7A1.5 1.5 0 0 1 5.5 19.5Z"
        stroke="var(--color-ink)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9 4.5H15V7H9Z" stroke="var(--color-ink)" strokeWidth="1.6" strokeLinejoin="round" />
      <path
        d="M8 12.2 10 14.2 14.5 9.7"
        stroke="var(--color-ink)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8.5 17.5H15.5" stroke="var(--color-ink)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// 체크리스트 선택 항목(InspectionChecklist)용 체크 표시 - 원형 껍데기 없이
// 체크 모양 하나만. 선택 안 됐을 때는 회색(라벨 텍스트와 같은 톤),
// 선택되면 프라이머리 그린으로 바뀐다.
export function ChecklistCheckIcon({ checked }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M5.5 12.5 9.5 16.5 18.5 7"
        stroke={checked ? "var(--color-primary)" : "var(--color-text-faint)"}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 체크리스트 그룹 아코디언 토글용 아래 화살표 - 기본(펼침)은 아래를
// 가리키고, CSS에서 .is-collapsed일 때 180deg 회전시켜 위를 가리키게 한다.
export function ChevronIcon({ className }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M6 9l6 6 6-6"
        stroke="var(--color-text-secondary)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
