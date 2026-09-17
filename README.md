# naezipsa

부동산 실거래 데이터 기반 매물 비교 대시보드.

국토교통부 실거래가를 수집·가공해서 아파트 평형별 시세 지표를 만들고,
사용자가 관심 매물을 최대 6개까지 담아 비교할 수 있는 서비스입니다.

## 폴더 구조

```
naezipsa/
├── backend/              FastAPI 백엔드 (여기서 모든 백엔드 명령어 실행)
│   ├── app/
│   │   ├── main.py
│   │   ├── core/         공용: 설정·DB연결·인증·오류형식·임장 점수 규칙
│   │   ├── user/         A · 프로필 (닉네임·나이대·이용 목적·내 점수 기준)
│   │   ├── dashboard/    A · 후보매물, 대시보드 집계, 스냅샷 공유
│   │   ├── group/        A · 후보 그룹, 그룹 공유 링크, 그룹별 점수 기준
│   │   ├── inspection/   A · 임장 체크리스트 기록 (후보당 1건)
│   │   ├── insight/      A · AI 종합분석
│   │   ├── property/     B · 실거래 검색/지표
│   │   ├── news/         정 · 부동산 뉴스
│   │   └── subscription/ 정 · 청약 정보
│   ├── ingest/           국토부 데이터 수집 배치 (B)
│   ├── alembic/          DB 마이그레이션
│   ├── tests/            pytest
│   └── info.md           ★ 명령어와 API 명세 전부 여기
├── frontend/             Next.js(App Router) + React 화면
│   ├── app/              layout.js · page.js · globals.css
│   ├── components/       화면 조각 (NaejipsaApp.jsx 가 최상위)
│   ├── lib/              API 호출·형태 변환·임장 점수 계산
│   ├── hooks/            프로필 온보딩, 토스트
│   └── tests/            vitest
└── README.md

기능 폴더는 안이 같은 모양입니다 — `router.py`(엔드포인트) · `service.py`(로직) ·
`schema.py`(요청·응답) · `model.py`(DB 테이블). 필요한 것만 두면 됩니다.
```

> **백엔드 작업은 반드시 `backend/` 폴더 안에서 실행합니다.**
> 루트에서 실행하면 `.env`를 못 찾아 서버가 뜨지 않습니다.

## 처음 시작하기

### 1. 저장소 받기

```bash
git clone https://github.com/niju0114/naezipsa.git
cd naezipsa/backend
```

### 2. 가상환경 + 패키지

**Python 3.14 기준**입니다. 다른 버전에서는 일부 패키지 설치가 실패할 수 있습니다.

```bash
# Windows
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# macOS / Linux
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

프롬프트 앞에 `(.venv)`가 뜨면 정상입니다.
macOS는 `bash setup.sh`로 위 과정을 한 번에 할 수도 있습니다.

### 3. `.env` 채우기 (이게 없으면 서버가 안 뜹니다)

```bash
cp .env.example .env
```

값은 **Git에 올라가지 않으므로 팀에서 따로 받아야 합니다.**
카톡·슬랙 평문 대신 1Password나 임시 비밀 공유 링크를 쓰세요.

| 항목 | 어디서 | 없으면 |
|---|---|---|
| `DATABASE_URL` | Supabase → Connect → ORMs | **서버가 안 뜸** |
| `SUPABASE_JWT_SECRET` | Supabase → Settings → API → JWT Settings | 로그인 API가 전부 500 |
| `MOLIT_API_KEY` | 공공데이터포털 | 데이터 수집만 불가 |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API Keys | 백엔드는 미사용 (프론트용) |
| `SUPABASE_SECRET_KEY` | Supabase → Settings → API Keys | 백엔드는 미사용 (향후 Admin API용) |

`DATABASE_URL`에서 자주 막히는 두 가지:

- **`https://`로 시작하면 틀린 값입니다.** 그건 Project URL이고, 필요한 건
  `postgresql://`로 시작하는 접속 문자열입니다.
- 연결 방식은 **Session pooler(5432번 포트, 주소에 `pooler.supabase.com`)** 를 쓰세요.
  Direct(IPv6 전용)는 국내 환경에서 자주 막히고, Transaction pooler(6543)는
  마이그레이션이 동작하지 않습니다.
- DB 비밀번호에 `@` 같은 기호가 있으면 `%40`처럼 퍼센트 인코딩해야 합니다.

### 4. 서버 실행

```bash
uvicorn app.main:app --reload
```

- 서버: http://localhost:8000
- **API 문서(자동 생성): http://localhost:8000/docs** ← 프론트엔드는 여기부터 보세요

### 5. 테스트

```bash
pytest tests/ -q
```

실제 개발 DB에 붙어서 돌기 때문에 `.env`가 필요하고, Supabase에 계정이
하나도 없으면 일부가 skip 됩니다. (Supabase → Authentication → Users → Add user)

## 프론트엔드 시작하기

Next.js(App Router) + React입니다. **`frontend/` 폴더 안에서** 실행합니다.

### 1. 패키지 설치

```bash
cd frontend
npm install
```

### 2. `.env.local` 채우기

`.env.example`를 복사해서 `.env.local`을 만들고 값을 채웁니다.

| 값 | 설명 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL (REST 경로 `/rest/v1/` 없이 base만) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable 키 |
| `NEXT_PUBLIC_API_BASE_URL` | 백엔드 주소. 기본 `http://127.0.0.1:8000/api/v1` |

- **`localhost` 말고 `127.0.0.1`을 쓰세요.** Windows에서 `localhost`는 IPv6(`::1`)부터
  시도하는데 개발 서버는 127.0.0.1에만 떠 있어, 새 연결마다 약 0.2초씩 늦어집니다.
- `NEXT_PUBLIC_` 값은 **브라우저에 그대로 노출**됩니다. 백엔드의 `DATABASE_URL`이나
  secret 키는 절대 여기 넣지 마세요.

### 3. 실행

```bash
npm run dev
```

- 화면: http://localhost:3000
- 로그인·후보 저장이 동작하려면 **백엔드도 같이 떠 있어야** 합니다.

### 4. 테스트 · 검사

```bash
npm test          # vitest (jsdom). 화면을 그려서 동작을 확인합니다
npm run lint      # eslint — 오류 0개를 유지합니다(경고는 기존 <img> 건)
npm run build     # 배포 빌드가 깨지지 않는지 확인
```

### 프론트에서 알아둘 것

- **상태는 `components/NaejipsaApp.jsx`에 모여 있습니다.** 후보 목록·그룹·체크리스트
  캐시·로그인 세션이 전부 여기 있고 props로 내려갑니다(3~4단계라 context를 쓰지 않습니다).
  **프론트를 처음 읽는다면 이 파일부터 여세요.**
- **로그인은 Supabase가 처리합니다.** 백엔드는 토큰을 검증만 합니다.
  `lib/api.js`의 `authHeaders()`가 세션 토큰을 `Authorization` 헤더에 실어 보냅니다.
- **금액은 화면에서 "만원", API에서는 "원"** 입니다. 변환은 `lib/dashboardItems.js`
  한 곳에서만 합니다.
- **임장 점수 규칙은 두 곳에 있습니다** — `lib/checklist.js`와
  `backend/app/core/scoring.py`. 한쪽만 고치면 카드에 보이는 점수와 AI가 말하는 점수가
  달라집니다. 양쪽 테스트가 같은 예시로 같은 값을 확인하니 함께 고치세요.

## 코드 읽는 순서

요청 하나가 응답이 되기까지 지나는 길입니다. **파일을 열기 전에 이 그림부터** 보세요.

```
  요청  GET /api/v1/dashboard
        Authorization: Bearer eyJ...
          │
          ▼
   0  main.py                 어느 라우터로 보낼지 결정
          │
          ▼
   1  core/security.py        토큰이 진짜인지 검증 (서명·만료·aud)
          │                   → CurrentUser(id, email, role)
          ▼
   2  core/deps.py            그 id로 DB의 프로필 행을 가져옴 (없으면 생성)
          │                   → Profile
          ▼
   3  {기능}/router.py        요청을 받아 처리 지시
          │
          ▼
   4  {기능}/service.py       로직. 다른 기능의 데이터가 필요하면 여기서 조인
          │
          ▼
   5  {기능}/model.py         DB 테이블 정의     "어떻게 저장되는가"
      {기능}/schema.py        요청·응답 형태     "어떻게 주고받는가"
          │
          ▼
       응답 (실패하면 어느 단계에서든 core/errors.py 로 모임)
```

**모든 파일 맨 위에 자기 위치가 적혀 있습니다.** 파일을 열면 첫 5줄만 봐도
"내가 흐름의 어디쯤이고, 누가 나를 부르고, 내가 남의 코드를 쓰는지" 알 수 있습니다.

```python
"""[dashboard] service — 후보에 단지 정보와 실거래 지표를 붙인다.

흐름   router ▶ ★service ▶ model / property.model
참조   app/property/model.py (B 소유 · 읽기 전용. 수정하려면 B에게 요청)
소유   A
"""
```

| 줄 | 뜻 |
|---|---|
| `[모듈] 역할` | 어느 기능 폴더의 무슨 파일인지 |
| `흐름` | 앞뒤로 무엇이 오는지. `★`가 지금 이 파일 |
| `호출` | 누가 나를 부르는지 (거꾸로 추적할 때) |
| `참조` | 내가 쓰는 남의 코드 — **소유권 경계** |
| `소유` | 이 파일 담당자. 남의 것은 고치지 말 것 |

**새 파일을 만들 때도 이 머리말을 붙여주세요.** 다음 사람이 파일을 하나씩
열어보지 않고도 전체 구조를 짐작할 수 있습니다.
(`app/property/`와 `app/news/`는 각 담당자가 붙이면 됩니다)

### 기능 폴더는 안이 같은 모양입니다

| 파일 | 하는 일 | 없어도 되나 |
|---|---|---|
| `router.py` | 엔드포인트 정의. 주소와 코드를 연결 | 필요 |
| `service.py` | 로직. 라우터가 길어지면 여기로 뺌 | 단순하면 생략 |
| `schema.py` | 요청·응답 형태와 허용값 검증 | 필요 |
| `model.py` | DB 테이블 정의 | 테이블이 있을 때만 |

`model.py`와 `schema.py`가 헷갈리기 쉬운데, **model은 "DB에 어떻게 저장되는가",
schema는 "프론트와 어떻게 주고받는가"** 입니다. 예를 들어 `profiles` 테이블의
컬럼명은 `id`지만 응답 키는 `user_id`인데, 이 변환을 schema가 합니다.

## 매일 작업 시작하기

처음 세팅은 위에서 한 번만 하면 되고, **매일 아침에는 아래 세 줄**로 시작합니다.

```bash
cd naezipsa/backend           # 1. 백엔드 폴더로 이동
.venv\Scripts\activate        # 2. 가상환경 켜기 (macOS: source .venv/bin/activate)
git checkout main && git pull origin main    # 3. 남들이 올린 최신 코드 받기
```

각각 왜 하는지:

| | 안 하면 |
|---|---|
| **1. `backend/`로 이동** | 서버가 `.env`를 못 찾아서 안 뜹니다 |
| **2. 가상환경 켜기** | `ModuleNotFoundError`가 납니다. 프롬프트 앞에 `(.venv)`가 보이면 켜진 겁니다 |
| **3. `git pull`** | 어제 상태에서 작업하게 됩니다. 나중에 합칠 때 충돌이 크게 납니다 |

**3번이 제일 중요합니다.** 내 컴퓨터의 코드는 마지막으로 `pull`한 순간에 멈춰 있는
사진입니다. 팀원이 아무리 많이 올려도, 내가 `pull`하기 전까지 내 폴더는 그대로예요.

### 그 다음 — 오늘 뭘 하느냐에 따라

**새 작업을 시작한다면** 브랜치를 새로 만듭니다.

```bash
git switch -c feature/작업이름
```

브랜치 이름은 **사람 이름이 아니라 작업 이름**입니다. 한 사람이 여러 개를 쓸 수 있고,
작업이 끝나 `main`에 합쳐지면 그 브랜치는 지웁니다.

| 담당 | 예시 |
|---|---|
| 회원·대시보드 | `feature/dashboard-metrics` |
| 실거래 데이터 | `feature/property-macro` |
| 정책·뉴스 | `feature/policy-data` |
| 프론트엔드 | `feature/frontend-login` |

**어제 하던 작업을 이어서 한다면** 그 브랜치로 옮기고, 최신을 한 번 당겨옵니다.

```bash
git switch feature/어제쓰던이름
git merge main
```

`git merge main`을 매일 해두면 충돌이 한꺼번에 몰리지 않고 조금씩 나뉘어 처리됩니다.
며칠씩 안 하다가 하면 수십 군데가 한 번에 터집니다.

### 백엔드는 두 가지 더

```bash
pip install -r requirements.txt   # pull 결과에 requirements.txt가 보였을 때만
pytest tests/ -q                  # 전부 통과하는지 확인 (30초)
```

`pip install`은 매일 할 필요 없습니다. `git pull` 출력에 `requirements.txt`가
있었을 때만 하면 됩니다. 새 패키지가 추가된 경우니까요.

> **`alembic/versions/`에 새 파일이 보였다면 서버를 반드시 다시 띄우세요.**
> 공용 DB에는 마이그레이션이 이미 적용돼 있는데, 옛 코드로 떠 있는 서버는 새 컬럼을
> 모릅니다. 없는 컬럼을 읽어 500이 나거나, 반대로 **새 필드를 조용히 무시해서
> "저장한 것처럼 보이지만 저장되지 않는"** 증상이 납니다. `--reload`를 켜놨어도
> 파일 변경을 놓칠 때가 있으니, 화면이 이상하면 코드보다 **서버가 최신인지**를
> 먼저 의심하세요.

`pytest`는 매일 한 번 돌려두면 좋습니다. **남의 작업이 내 코드를 깼는지** 바로 알 수
있습니다. 서버를 띄우려면:

```bash
uvicorn app.main:app --reload
```

### 코딩 시작 전에 한 번만 확인

```bash
git branch --show-current
```

여기에 **`main`이 나오면 멈추세요.** `main`에서 직접 코딩하면 나중에 PR을 만들 수
없고, 실수로 push하면 팀 전체의 기준 코드가 흔들립니다. 위의 `git switch -c`로
브랜치를 먼저 만들고 시작하세요.

### 하루를 끝낼 때

```bash
git add .
git commit -m "feat: 오늘 한 것"
git push origin feature/작업이름
```

**미완성이어도 올려두세요.** 커밋은 "완성했다"가 아니라 "여기까지 저장"이라는
뜻이고, 내 브랜치에 있는 한 `main`에는 아무 영향이 없습니다.
컴퓨터가 고장나도 작업이 남고, 팀원이 진행 상황을 볼 수 있습니다.

커밋 후에는 **출력을 꼭 확인하세요.**

```
[feature/policy-data abc1234] feat: 오늘 한 것
 3 files changed, 120 insertions(+)      ← 이렇게 나와야 성공
```

`nothing to commit, working tree clean`이 나오면 **아무것도 저장되지 않은 것**입니다.
파일이 이 폴더 안에 없거나, 아직 변경사항이 없다는 뜻이에요.

### 자주 나는 실수

| 증상 | 원인 | 해결 |
|---|---|---|
| `ModuleNotFoundError` | 가상환경을 안 켬 | `.venv\Scripts\activate` |
| 서버가 `.env`를 못 찾음 | 루트에서 실행함 | `cd backend` 후 실행 |
| 충돌이 잔뜩 남 | `pull`을 며칠 안 함 | 매일 아침 3줄 |
| "올렸는데 안 보여요" | 커밋 없이 push | `git commit` 출력 확인 |
| PR 버튼이 안 뜸 | `main`에서 작업함 | 브랜치를 만들고 다시 |

## API 한눈에 보기

| 담당 | 범위 | 로그인 |
|---|---|---|
| A | 프로필 `/api/v1/users/me/profile` | 필요 |
| A | 후보 매물 `/api/v1/dashboard/items` | 필요 |
| A | 대시보드 `/api/v1/dashboard` | 필요 |
| A | 후보 그룹 `/api/v1/groups` | 필요 |
| A | 그룹 공유 열람 `/api/v1/shared/groups/{token}` | 불필요 |
| A | 스냅샷 공유 `/api/v1/dashboard/shares` | 만들 때만 필요 |
| A | 임장 기록 `/api/v1/properties/{id}/inspection` | 필요 |
| A | 임장 일괄 조회 `/api/v1/properties/inspections` | 필요 |
| A | AI 종합분석 `/api/v1/dashboard/insight` | 필요 |
| B | 단지 검색 `/api/v1/search` | 불필요 |
| B | 평형·지표 `/api/v1/items/{size_id}/...` | 불필요 |
| B | 거시지표 `/api/v1/macro/indices` | 불필요 |
| 정 | 부동산 뉴스 `/api/v1/news` | 불필요 |
| 정 | 청약 정보 `/api/v1/subscription` | 불필요 |

엔드포인트별 요청·응답과 허용값은 **[backend/info.md](backend/info.md)** 에 있습니다.

### 로그인은 백엔드가 처리하지 않습니다

**Supabase Auth**가 회원가입·로그인을 담당하고, 백엔드는 발급된 토큰을
**검증만** 합니다 (`backend/app/core/security.py`).

```
프론트 ──로그인──▶ Supabase Auth ──토큰──▶ 프론트
프론트 ──Authorization: Bearer <토큰>──▶ 백엔드 (검증 후 처리)
```

회원 정보는 Supabase의 `auth.users`에 저장되고, 우리 `profiles` 테이블이
그 id를 외래키로 참조합니다. 그래서 **별도 로그인 API를 만들면 사용자 출처가
두 개로 갈라집니다.** 구글 로그인도 Supabase 대시보드에서 켜면 되고
백엔드 코드 변경은 없습니다.

### 금액 단위

**API 응답의 모든 금액은 원(₩)입니다.** 13.2억이면 `1320000000`.

DB에는 국토부 원본 그대로 만원으로 저장하고, `app/property/service.py`의
`to_won()`이 응답을 만들 때만 변환합니다. **변환 함수는 하나뿐이어야 합니다** —
각자 변환하면 화면마다 숫자가 어긋납니다.

`dashboard_items.list_price`만 예외적으로 DB에도 원으로 저장합니다.
사용자가 직접 입력하는 값이라 국토부 원본과 맞출 이유가 없습니다.

### 오류 응답 형식

성공이 아닌 응답은 전부 같은 모양입니다.

```json
{ "error": { "code": "NOT_FOUND", "message": "해당 후보 매물을 찾을 수 없습니다.", "details": null } }
```

`code`는 `UNAUTHORIZED` `NOT_FOUND` `CONFLICT` `VALIDATION_ERROR` `INTERNAL_ERROR` 등이고,
`details`는 입력값 검증 실패(422)일 때만 채워집니다.

## 협업 규칙

### 브랜치

`main`이 항상 최신이고 동작하는 상태입니다. **`main`에 직접 커밋하지 않습니다.**

```bash
git checkout main
git pull origin main                  # 남의 작업 먼저 받고
git checkout -b feature/작업이름       # 새 브랜치를 따서 작업
# ... 작업 ...
git add . && git commit -m "feat: 무엇을 했는지"
git push origin feature/작업이름
# GitHub에서 main 대상으로 Pull Request 생성
```

작업이 며칠 이상 이어지면 중간에 `git merge origin/main`으로 최신을 당겨오세요.
오래 두면 나중에 충돌이 커집니다.

### 백엔드 A / B 담당 구분

한 폴더 안에서 두 사람이 작업하므로, 소유자를 정해두고 남의 영역은 건드리지 않습니다.

**폴더 하나가 담당자 하나**입니다. 남의 폴더는 건드리지 않습니다.

| 폴더 | 담당 | 내용 |
|---|---|---|
| `app/user/` | A | 프로필 조회·수정, 내 임장 점수 기준 |
| `app/dashboard/` | A | 후보매물 CRUD, 대시보드 집계, 스냅샷 공유 |
| `app/group/` | A | 후보 그룹, 그룹 공유 링크, 그룹별 점수 기준 |
| `app/inspection/` | A | 임장 체크리스트 기록 (후보당 1건) |
| `app/insight/` | A | AI 종합분석 |
| `app/property/` | B | 단지 검색, 평형·시세 지표, 거시지표 |
| `ingest/` | B | 국토부 데이터 수집 배치 |
| `app/news/` `app/subscription/` | 정 | 부동산 뉴스, 청약 정보 |
| `app/core/` | 공용 | 설정, DB 연결, 인증, 오류 형식, 임장 점수 규칙 |
| `alembic/` `tests/` | A | 마이그레이션, 테스트 |

**규칙 4가지**

1. **남의 폴더 함수는 호출만 하고 수정하지 않습니다.**
   예를 들어 대시보드에 실거래 지표를 붙일 때 `app/property/service.py`의 함수를
   그대로 씁니다. 시그니처를 바꿔야 하면 담당자에게 요청하세요.
   직접 고치면 그쪽 API가 조용히 깨집니다.
2. **`app/core/`에 자기 기능 코드를 넣지 않습니다.** 여기는 모두가 쓰는 것만.
3. **`requirements.txt`는 자기 섹션에만 추가합니다.**
   파일이 용도별로 나뉘어 있으니 해당 구역에 넣으세요. 파일 끝에 몰아 쓰면 충돌합니다.
4. **`app/main.py`는 라우터 등록 줄만 추가합니다.** 자기 구역에 한 줄만.

공용 파일(`main.py`, `core/`, `requirements.txt`, `info.md`)은 여럿이 건드릴 수밖에
없지만, 서로 다른 줄에 추가하는 형태라 실제 충돌은 거의 없습니다.

**새 기능 폴더를 만들 때** (예: `policy/`)

```python
# app/policy/router.py
from fastapi import APIRouter
router = APIRouter(prefix="/policy", tags=["policy"])

# app/main.py 에 두 줄 추가
from app.policy import router as policy_router
app.include_router(policy_router.router, prefix="/api/v1")
```

DB 테이블이 필요하면 `app/policy/model.py`에서 `app.core.database`의 `Base`를
상속하고, **`alembic/env.py`에 그 모듈 import를 추가**해야 합니다.
빠뜨리면 Alembic이 테이블을 못 봅니다.

### DB 스키마 변경

회원·후보매물 테이블은 Alembic으로 관리합니다. Supabase 화면에서 손으로
테이블을 만들지 마세요.

```bash
alembic revision --autogenerate -m "무엇을 바꿨는지"
# ★ 생성된 alembic/versions/*.py 를 반드시 열어서 확인 ★
#   drop_table / drop_column 이 있으면 실행하지 말고 원인부터 찾을 것
alembic upgrade head
```

실거래 데이터 테이블(`raw_trades_*`, `complex_master`, `size_master`,
`item_metrics_cache`)은 Alembic이 관리하지 않습니다. `alembic/env.py`의
`include_object` 필터가 막고 있으니 그대로 두세요.

### 지켜야 할 것

- **`.env`를 커밋하지 않습니다.** 올라가면 모든 키를 재발급해야 합니다.
- **비밀키를 코드에 직접 쓰지 않습니다.** 반드시 `.env`를 거칩니다.
- **`ingest/reset_data.py`를 실행하지 않습니다.** `TRUNCATE ... RESTART IDENTITY`
  라서 `size_master.id`가 1번부터 다시 매겨지고, 사용자가 담아둔 후보 매물이
  전부 엉뚱한 단지를 가리키게 됩니다.

## 더 읽을 것

- **[backend/info.md](backend/info.md)** — 전체 명령어, API 명세, 지표 계산 기준
- **[frontend/README.md](frontend/README.md)** — 프론트엔드 폴더 구조, 화면 흐름, 상태를 어디서 들고 있는지
- [docs/development-kickoff-plan.md](docs/development-kickoff-plan.md) — 기능별 구현 기록과 결정 이력, 수동 확인 목록
