# 배포 — 프론트는 Vercel, 백엔드는 Render

세 조각이 각각 다른 곳에 있습니다.

```
브라우저 ─▶ Vercel (frontend/, Next.js)
                │  fetch
                ▼
           Render (backend/, FastAPI)
                │  SQLAlchemy
                ▼
           Supabase (지금 쓰는 그 DB 그대로)
```

DB는 **바꿀 것이 없습니다.** 지금 팀이 같이 쓰는 Supabase에 Render가 그대로 붙습니다.

순서가 중요합니다 — **백엔드를 먼저 올려서 주소를 받아야** 프론트에 그 주소를 넣을 수 있습니다.

---

## 1단계 · 백엔드를 Render에 올린다

1. [render.com](https://render.com)에 GitHub 계정으로 로그인합니다.
2. **New → Blueprint** → `niju0114/naezipsa` 저장소를 고릅니다.
   저장소 맨 위의 `render.yaml`을 읽어서 설정을 알아서 채웁니다.
3. 환경변수를 넣으라고 나옵니다. **`backend/.env`에 있는 값을 그대로 복사해서** 넣으면 됩니다.

   **꼭 필요한 것**

   | 넣을 값 | 없으면 어떻게 되나 |
   |---|---|
   | `DATABASE_URL` | 서버가 아예 안 뜹니다. **반드시 6543 포트(Transaction pooler) 주소**여야 합니다 |
   | `SUPABASE_JWT_SECRET` | 로그인이 필요한 기능이 전부 401로 막힙니다 |
   | `APPLYHOME_API_KEY` | 청약 탭이 빕니다 (청약홈 분양정보 API) |
   | `REB_API_KEY` / `KOSIS_API_KEY` | 거시지표 차트가 빕니다 |
   | `GEMINI_API_KEY` | AI 분석이 안 됩니다 |

   **안 넣어도 되는 것**

   | 값 | 왜 |
   |---|---|
   | `MOLIT_API_KEY` | 실거래를 **수집하는 배치**(`ingest/`)에서만 씁니다. 서버는 이미 DB에 쌓인 걸 읽습니다 |
   | `KAKAO_API_KEY` | 지금 코드에서 쓰는 곳이 없습니다(자리만 남아 있음) |
   | `MIGRATION_DATABASE_URL` | Render는 마이그레이션을 돌리지 않습니다 |
   | `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` | 백엔드는 ORM으로 직접 붙어서 안 씁니다(자리만) |
   | `CORS_ALLOW_ORIGINS` | 비워 두세요. 4단계에서 채웁니다 |

   > `MOLIT_API_KEY`가 비어 있으면 서버 시작 로그에 `[경고] .env에 다음 값이 비어있습니다`가
   > 뜨지만 **경고일 뿐이고 서버는 정상으로 뜹니다.** 배치를 돌릴 때만 필요합니다.

4. 배포가 끝나면 `https://naezipsa-api-xxxx.onrender.com` 같은 주소가 나옵니다.
   그 주소를 브라우저로 열어 `{"status":"ok", ...}`가 보이면 성공입니다.
   `/docs`를 붙이면 API 목록도 볼 수 있습니다.

> **빌드가 파이썬 버전 때문에 실패하면** — `render.yaml`의 `PYTHON_VERSION`을 `3.13.x`로 낮추면 됩니다.
> `requirements.txt`에 고정된 버전들은 3.13에서도 전부 설치됩니다.

---

## 2단계 · 프론트를 Vercel에 올린다

1. [vercel.com](https://vercel.com)에 GitHub 계정으로 로그인 → **Add New → Project** → 같은 저장소.
2. **Root Directory를 `frontend`로 바꿉니다.** ← 이게 제일 중요합니다.
   모노레포라서 이걸 안 바꾸면 Vercel이 저장소 맨 위에서 Next.js를 찾다가 실패합니다.
3. 환경변수 3개를 넣습니다.

   | 이름 | 값 |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `frontend/.env.local`의 같은 값 |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `frontend/.env.local`의 같은 값 |
   | `NEXT_PUBLIC_API_BASE_URL` | **1단계에서 받은 주소 + `/api/v1`** |

   > `/api/v1`까지 붙여야 합니다. `https://naezipsa-api-xxxx.onrender.com/api/v1` 이렇게요.
   > 이걸 빠뜨리면 화면은 뜨는데 모든 요청이 404가 납니다.

4. Deploy를 누릅니다.

---

## 3단계 · 확인

Vercel 주소를 열고 이 순서로 봅니다.

1. **단지 검색이 되는가** — 백엔드 연결이 맞는지 봅니다. 안 되면 `NEXT_PUBLIC_API_BASE_URL`을 의심하세요.
2. **로그인이 되는가** — 되면 `SUPABASE_JWT_SECRET`이 맞는 겁니다.
3. **후보 담기 → 새로고침** — 남아 있으면 DB까지 잘 붙은 겁니다.
4. **AI 분석** — 5~7초 걸립니다. 기다려보세요.

---

## 4단계(선택) · CORS 좁히기

지금은 백엔드가 아무 주소에서나 오는 요청을 받습니다. 프론트 주소가 정해졌으니 좁힐 수 있습니다.
Render 대시보드 → Environment → `CORS_ALLOW_ORIGINS`에 Vercel 주소를 넣습니다.

```
CORS_ALLOW_ORIGINS=https://naezipsa.vercel.app
```

**다만 좁히면 Vercel이 PR마다 만드는 미리보기 주소(랜덤 주소)에서는 API가 막힙니다.**
미리보기를 쓸 거면 그냥 비워 두세요.

---

## 미리 알아둘 것

**무료 등급은 잠듭니다.** 15분 동안 아무도 안 들어오면 Render가 백엔드를 재웁니다.
그 다음 첫 사람은 화면이 뜨고도 **40~60초**를 기다립니다. 팀원이나 외부에 보여주기 전에
한 번 먼저 열어서 깨워두세요.

**뉴스가 안 나올 수 있습니다.** 뉴스 기능은 네이버 검색 결과 화면을 긁어옵니다.
클라우드 IP에서 요청하면 막히거나 다른 화면이 오는 일이 흔합니다.
로컬에서는 되는데 배포에서만 빈다면 이것 때문입니다 — Render든 어디든 마찬가지입니다.

**DB 마이그레이션은 여전히 로컬에서 합니다.** Render는 `alembic upgrade`를 돌리지 않습니다.
테이블을 바꿨으면 지금처럼 각자 로컬에서 올리고, 그 다음에 배포하세요.

**데이터 수집 배치(`ingest/`)도 로컬입니다.** 배포된 서버는 웹 요청만 받습니다.
