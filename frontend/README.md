# 프론트엔드

Next.js(App Router) + React로 만든 화면입니다. 실행 방법과 환경 변수는
**[루트 README의 "프론트엔드 시작하기"](../README.md#프론트엔드-시작하기)** 에 있습니다.
이 문서는 **코드를 읽고 고칠 때 알아야 할 것**만 다룹니다.

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # vitest
npm run lint     # 오류 0개 유지
npm run build
```

## 어디부터 읽어야 하나

**`components/NaejipsaApp.jsx` 한 파일부터 여세요.** 앱의 상태가 전부 여기 모여 있습니다.

| 이 파일이 들고 있는 것 | 설명 |
|---|---|
| `dashboardItems` | 후보 매물 목록(최대 6개). 화면용 id와 서버 id(`backendId`)를 함께 가집니다 |
| `itemChecklists` | 후보별 임장 체크리스트. 서버 id 기준으로 캐시합니다 |
| `groups` · `activeGroup` | 그룹 목록과 지금 보고 있는 그룹 |
| `user` · `profile` | Supabase 세션과 우리 프로필(닉네임·이용 목적·내 점수 기준) |

상태를 아래로 props로 내려보냅니다. 깊이가 3~4단계라 context를 쓰지 않습니다.

## 화면 구조

```
Header            로고 · 상세데이터/인사이트 탭 · 그룹 메뉴 · 공유 · 마이페이지
└ Workspace       헤더 아래 전체
  ├ MainHeroOverlay   첫 화면을 덮는 안내. 매물을 담으면 위로 걷힘
  └ Dashboard
    ├ DashboardList   왼쪽 후보 카드 목록(드래그 정렬·체크·수정·삭제)
    └ 오른쪽 (좌우 슬라이드)
      ├ DashboardCharts   시세 추이·거래량·전세갭·실거래 분포·랭킹·거시지표
      └ InsightPanel      AI 분석 + 뉴스 + 청약
```

팝업은 `components/Modal/`에 있습니다 — 로그인(`AuthModal`), 매물 추가(`InterestModal`),
온보딩·마이페이지(`ProfileOnboardingModal`), 공유 받기(`ImportShareModal`).
매물 수정과 임장 체크리스트는 `EditListingDialog` + `InspectionChecklist`입니다.

## lib 폴더

| 파일 | 하는 일 |
|---|---|
| `api.js` | 백엔드 호출. 로그인이 필요한 것은 `authHeaders()`로 토큰을 붙입니다 |
| `insightApi.js` | 인사이트(뉴스·청약) 전용 호출 |
| `checklist.js` | 임장 18개 항목 정의 + **점수 계산**(100점 만점) |
| `dashboardItems.js` | 프론트 ↔ 백엔드 형태 변환(향·인테리어 한글↔영문, 금액 단위) |
| `supabaseClient.js` | Supabase Auth 클라이언트 |
| `data.js` · `charts.js` | 화면 상수, 차트 공용 설정 |

## 고칠 때 주의할 것

**로그인은 백엔드가 처리하지 않습니다.** Supabase Auth가 회원가입·로그인을 맡고,
백엔드는 토큰을 검증만 합니다. 그래서 프론트가 Supabase SDK로 직접 로그인하고,
받은 토큰을 우리 API에 실어 보냅니다(`authHeaders()`).

**금액 단위가 두 개입니다.** 화면 입력은 "만원", API는 "원"입니다. 변환은
`dashboardItems.js` 한 곳에서만 합니다 — 다른 데서 또 곱하면 0이 두 개 붙습니다.

**임장 점수 규칙이 두 곳에 있습니다.** `lib/checklist.js`(화면)와
`backend/app/core/scoring.py`(AI 분석용). 한쪽만 고치면 **카드에 보이는 점수와 AI가
말하는 점수가 달라집니다.** 양쪽 테스트가 같은 예시로 같은 값을 확인하니 함께 고치세요.

**후보 id가 두 종류입니다.** 화면용 `id`("item-1")와 서버 `backendId`입니다. 서버에
보내는 것은 전부 `backendId`이고, 체크리스트 캐시도 서버 id 기준입니다 — 화면용 id로
캐시하면 목록을 다시 불러올 때 다른 매물의 체크리스트가 붙습니다.

**분류·항목 목록을 화면에 하드코딩하지 마세요.** 청약 분류는 응답의
`category`/`label`에서 읽습니다. 예전에 4개를 박아뒀다가 백엔드에 분류가 늘어도
화면에 나타나지 않는 문제가 있었습니다.

## 테스트

`tests/`에 vitest로 있습니다. 화면을 실제로 그려서 동작을 확인합니다.

```bash
npm test                          # 전체
npx vitest run tests/파일명        # 하나만
```

- 백엔드 호출은 `vi.mock("@/lib/api", ...)`로 대체합니다. 실제 네트워크를 타지 않습니다.
- `NaejipsaApp`을 통째로 렌더링하는 테스트는 `Workspace`처럼 무거운 자식을 mock으로
  바꿔 관심 있는 것만 드러냅니다(`tests/group-scoring.test.jsx` 참고).
