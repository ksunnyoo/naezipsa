# 개발 실행 계획 — 기존 구조 유지

갱신일: 2026-09-16
현재 단계: **Phase 5 공유(읽기 전용 그룹 링크) — 구현·격리 검증·공용 DB 적용(`3c9e1a7b52d4`) 완료, PR 병합·수동 확인 대기.** Phase 3 보완(정렬 순서 저장)은 main 병합 완료, 수동 확인 대기.

랜덤 닉네임·속도 개선(2026-09-16): 사용자 요청으로 처리했다. 아래 "닉네임·속도 개선" 참고. DB 변경 없음.

Phase 5 착수(2026-09-16, 사용자 지시): 그룹 공유 링크(읽기 전용)만 구현했다. 공개 범위는 동·호수까지, 공동 참여는 구현 계획만 두고 보류다. 아래 "Phase 5 변경 요약" 참고.

임장 체크리스트(2026-09-16, 사용자 결정): 임장 체크리스트를 따로 공유하는 기능(Phase 7)은 만들지 않는다. 체크리스트가 DB에 점수별로 저장되는지 확인한 결과는 아래 "임장 체크리스트 저장 확인" 참고.

설계 준비(2026-09-15): 사용자 요청으로 [정렬 순서 저장·공유/공동참여 설계](ordering-and-sharing-design.md)를 추가했다. 현재 `7ed9923` 구현을 기준으로 정렬 API·migration 순서, 그룹/기존 스냅샷 공유 구분, membership·원본 소유권, 완료 기준을 정리한 **구현 전 제안**이다. 정렬 보완과 Phase 5 구현은 착수하지 않았다.

정렬 보완 착수(2026-09-15): 사용자 지시로 위 설계 3장(정렬 순서 저장)만 구현했다. 아래 "Phase 3 보완 변경 요약" 참고. 설계 4장(공유/공동참여)은 확정 요구가 아닌 제안으로 두고 착수하지 않았다.

현재 단계 마무리(2026-09-15, 사용자 결정): 다음 Phase(공유/공동참여 등)는 쉬고, 그룹 메뉴 후속 수정과 정렬 순서 저장을 PR·공용 DB 적용·수동 확인으로 마무리한다.

사용자가 카카오 보류에 동의한 뒤 Phase 2 착수를 명시적으로 요청했다. 이에 따라 Phase 2를 진행했으며, Phase 1의 이메일·Google 실제 로그인 미검증 이력은 그대로 남긴다. Phase 3은 시작하지 않는다.

재로그인 401 최종 반영 상태 재확인(2026-09-14): 원격 main을 직접 조회한 결과 `f1e8e52`이며, `verify_iat: False` 수정은 아직 `fix/phase1-auth`의 미커밋 변경이다. 기존 알고리즘 화이트리스트 반영과 재로그인 시각 차이 수정 반영은 별개다. 격리 인증 40건 통과 기록은 있으나, main 반영 및 실제 로그아웃 → 즉시 재로그인 → 첫 보호 API 성공이라는 완료 기준은 아직 미충족이다.

이 문서는 사용자의 최신 Phase 지시를 반영한다. 이전 계획의 저장 테이블/API 교체, 별도 비교 상태 신설, 후보별 공유 선택 화면, 임장 모델 선행 신설 제안은 철회한다. 구조 개편보다 기존 동작을 보존하는 최소 변경을 우선한다.

## 인수인계 후 갱신 (2026-09-14 오후)

아래 본문은 인수인계 시점 기록을 그대로 둔다. 그 뒤 달라진 사실만 여기에 적는다.

- **커밋·push:** Phase 1 `e1c5498`, Phase 2 `e695d26`로 나눠 커밋해 `origin/fix/phase1-auth`에 push했다. PR·main 병합·배포는 하지 않았다. 본문의 "미커밋" 표현은 이 시점 이전 기준이다.
- **최신 main 반영:** `b427582`(PR #11 뉴스·청약 화면 연결 + 임장) 위로 rebase했다. `InsightPanel.jsx`는 PR #11의 높이 조절 영역 안에 Phase 2 AI 분석을 넣었고, `Dashboard.jsx`는 양쪽 props를 모두 전달한다. rebase 전 상태는 로컬 `backup/phase1-2-before-rebase`에 있다.
- **재검증:** 백엔드 243개 통과(Phase 1·2 + PR #11의 임장·뉴스·청약, 모두 격리 테스트), 프론트 `npm test` 44개 통과, lint 오류 0개, build 성공.
- **Windows 시간대 DB:** 뉴스·청약의 `ZoneInfo("Asia/Seoul")`가 Windows에서 실패해 `tzdata`를 `requirements.txt`에 추가했다. Phase와 무관하므로 별도 브랜치 `fix/tzdata-windows`(`7d436c3`)로 올렸다.
- **마이그레이션 불일치 (Phase 3 선행 차단):** 공용 DB의 `alembic_version`은 `667be58b68d8`인데 원격 git 어디에도 없어 alembic 명령이 실패한다. 진수님 조사 결과 이 파일은 `20260911_0839_667be58b68d8_add_dashboard_item_groups_and_shares.py`로, **진수님 PC에만 untracked 상태**로 있고 dangling 커밋 `b7b7173`(그룹 저장·공유 링크 기능)에 같은 내용이 남아 있다. 체인은 `98a4d5fa65f8 → 258caef7f856(checked) → 667be58b68d8`이며, `667be58b68d8`은 `dashboard_item_groups`·`dashboard_shares` 두 테이블(`items` JSONB)을 만든다. `b7b7173` 커밋 직후 `git reset`(mixed)으로 git 기록만 지워지고 DB 적용은 남은 것으로 추정한다.
  - 인수인계 직후 "DB와 main의 차이는 checked뿐, 번호만 다른 같은 작업"이라고 적었던 추정은 **틀렸다.** 당시 스키마 비교가 모델에 등록된 테이블(`dashboard_items`, `profiles`, `property_inspections`)만 대상으로 해서 그룹·공유 테이블을 보지 못했다.
  - 트랜잭션 풀러로 확인한 결과(읽기 전용) **두 테이블 모두 존재하고 데이터가 있다**: `dashboard_item_groups` 3행, `dashboard_shares` 8행, 외래키 없음. `alembic_version=667be58b68d8`, `dashboard_items.checked`(boolean, NOT NULL, 기본 true)도 확인했다. DB에 upgrade/downgrade/stamp는 계속 실행하지 않는다.
  - 이 두 테이블은 고정 제약의 Phase 4·5 설계(`groups`·`group_items`, `group_members`·`group_share_links`)와 **다른 구조**다. 따라서 `b7b7173`의 기능 코드를 그대로 편입하지 않고 마이그레이션 체인만 git에 복원한다. 데이터가 있으므로 제거하지 않고, Phase 4에서 보존·이관 방법을 정한다.
  - 체인 복원에는 진수님 PC에만 있는 `667be58b68d8` 파일 원본이 필요하다(원격 백업 브랜치 push 요청). `c71f9a2d830e`(임장)도 `98a4d5fa65f8`에서 갈라져 있어 복원 후 merge revision이 필요하다.
- **공용 DB 연결 한도 초과 → 트랜잭션 풀러 전환 (2026-09-14 오후):** Supabase 세션 풀러(5432)가 `EMAXCONNSESSION: max clients … pool_size: 15`로 새 연결을 거절해 DB를 쓰는 API가 전부 500이었다. `pg_stat_activity`에는 Supavisor 연결 15개가 idle로 잡혀 있었고 민준님 PC는 연결을 잡고 있지 않았다. 구조적 원인은 백엔드가 SQLAlchemy 기본 풀(최대 15)로 한도 15인 세션 풀러에 붙어, 서버 프로세스 하나가 공용 한도를 혼자 채울 수 있었던 것이다. 코드에 세션 단위 기능(advisory lock·LISTEN·임시 테이블 등)이 없음을 확인하고 다음처럼 바꿨다.
  - 앱 `DATABASE_URL`은 트랜잭션 풀러(6543), Alembic은 새 `MIGRATION_DATABASE_URL`(세션 풀러 5432, 비우면 `DATABASE_URL`)을 쓴다.
  - 앱 엔진은 프로세스당 연결을 최대 5개(`pool_size=3`, `max_overflow=2`, `pool_recycle=300`)로 묶는다.
  - 민준님 로컬 `.env`를 전환하자 백엔드 자동 재시작 후 `/search`·`/subscription/nearby`가 500 → 200으로 회복됐다. 다른 팀원은 각자 `.env`의 포트를 바꿔야 세션 풀러 한도에서 벗어난다.
  - **동시성 점검:** API 30개가 모두 동기 함수라 요청 하나가 응답이 끝날 때까지 DB 세션을 쥔다. 프로세스당 연결을 5개로 묶으면 서버 하나가 동시에 처리하는 DB 요청도 5건이 상한이다. 특히 AI 분석(LLM 최대 30초)과 청약 nearby(청약홈 API)는 **DB 조회 뒤 트랜잭션을 연 채 외부 호출**을 해서, 동시 요청 몇 건만으로 같은 서버의 다른 DB 요청이 막힐 수 있었다. DB의 `idle_in_transaction_session_timeout`이 0이라 이런 연결이 자동으로 끊기지도 않는다.
  - **조치:** 두 곳 모두 DB 읽기 직후 `commit()`으로 트랜잭션을 끝낸 뒤 외부 호출을 한다(읽은 결과가 ORM 객체가 아니어서 안전). 연결 풀 크기·대기시간은 `DB_POOL_SIZE`/`DB_MAX_OVERFLOW`/`DB_POOL_TIMEOUT` 환경변수로 조정한다(기본 3/2/10초, 빈 값이면 기본값). 청약 nearby는 정정화님 담당 파일이다.
  - **규모가 커질 때:** 동시에 실행되는 트랜잭션 수의 실질 상한은 DB 쪽이다(확인 시점 `max_connections` 60, 풀러의 서버 연결 수는 컴퓨트 크기에 따름). 사용자가 늘면 ① 트랜잭션을 짧게 유지, ② 배포 서버 프로세스 수 × 풀 크기를 풀러 한도 안에서 조정, ③ 컴퓨트 업그레이드, ④ 캐시·읽기 전용 복제본 순으로 대응한다. LLM처럼 오래 걸리는 작업을 백그라운드 작업으로 분리하는 것은 후속 과제로 둔다.
- **main의 후보 삭제 500:** PR #11 이후 후보 삭제가 `property_inspections`를 먼저 조회하는데, 위 불일치로 해당 테이블을 만들지 못해 삭제가 500이 된다(삭제 전 조회에서 실패하므로 데이터 손실은 없음). 마이그레이션 정리 후 해소된다. 그 전까지 수동 검증에서 삭제는 제외한다.
- **정렬 순서 저장 결정:** 사용자가 드래그로 정한 후보 순서를 DB 컬럼으로 저장하기로 결정했다. 기존 팀 규칙("표시 순서는 백엔드에서 관리하지 않음")을 바꾸는 결정이다. **Phase 3(checked)과 함께** 같은 마이그레이션으로 구현한다. 위 마이그레이션 불일치 해소(JINS 확인)가 선행 조건이다.
- **온보딩 미표시 원인:** 수동 확인에 쓴 Google 계정은 이미 `service_purposes=['move','buy']`가 저장돼 있어 모달이 뜨지 않는 것이 정상이다. 새 계정으로 재확인한다.
- **아이디 로그인 전환 → 철회:** 한때 아이디 전용 로그인(`f9743cc`)을 넣었으나, 서비스가 덜 전문적으로 보인다는 판단에 따라 **이메일 로그인 유지 + 이메일 인증 도입**으로 방향을 바꿨다. 코드는 `e95d089`로 되돌렸다.
- **이메일 인증 방식:** Supabase Auth의 **Confirm email을 켠 상태**로 쓴다. 이 설정을 끄면 가입과 동시에 모든 계정이 인증된 것으로 처리돼 백엔드가 인증 여부를 구분할 수 없다. 백엔드에서 인증을 새로 만들면 메일 발송 서비스·토큰·만료·재발송 제한을 전부 직접 구현해야 하므로, 인증은 Supabase에 맡긴다. 프론트는 "인증 메일 발송 안내 / 인증해야 사용할 수 있는 이메일 안내 / 인증 메일 다시 보내기"만 담당하고, 인증 링크는 앱 주소로 돌아와 바로 로그인된다. 백엔드·DB 변경은 없다.
- **이메일 발송 선행 조건:** 인증 메일이 도착하지 않았던 원인은 Supabase 기본 메일 발송의 제한(시간당 발송 수가 매우 적고, 조직 팀원이 아닌 주소로는 보내지 않을 수 있음)으로 추정한다. 실사용·수동 검증 전에 대시보드 → Authentication → SMTP Settings에서 외부 SMTP(Resend·SendGrid 등)를 연결한다. 확인 시점(2026-09-14 오후)의 Confirm email은 켜짐(`mailer_autoconfirm: false`)이다.
- **이메일 인증 — 코드 유지, Confirm email 임시 해제 (2026-09-14 오후):** Confirm email과 Redirect URLs를 설정한 상태로 새 이메일(`daum.net`) 가입을 시도했으나 `auth.users`에 계정이 생기지 않았다. 지금까지 인증 메일이 실제로 발송된 기록은 팀원 주소 한 건뿐이라, Supabase 기본 메일 발송의 제한(팀원 주소 위주·발송량 제한)으로 인증 메일을 보내지 못해 가입이 취소된 것으로 추정한다. 외부 SMTP를 연결하기 전까지 **Confirm email을 끄고**(가입 즉시 로그인), 인증 안내 코드(`032e585`)는 세션이 오면 동작하지 않으므로 그대로 둔다. SMTP 연결 후 Confirm email을 다시 켜면 인증 흐름이 살아난다.
- **수동 확인 결과 (사용자 보고, 2026-09-14 오후):** Phase 1~3 수동 확인을 모두 통과했다. 이메일 인증 메일 수신만 위 이유로 미확인이다.
- **main 병합 — PR #12 그룹 저장·공유 (2026-09-14 오후):** 진수님이 16:51에 PR #12를 main에 머지했다. `fix/phase1-auth`에 병합(`ec71fd1`)하면서 충돌 5개(`model.py`, `globals.css`, `InsightPanel.jsx`, `NaejipsaApp.jsx`, `api.js`)를 양쪽 기능을 모두 유지하는 방향으로 해결했다. main에는 모델에 `checked` 컬럼이 빠져 있어 그룹 스냅샷 저장·불러오기가 참조하는 `checked`가 없었는데, 이 병합으로 채워진다. 병합 후 테스트 환경을 두 가지 보정했다: 후보 목록 조회가 규제지역을 조인하게 되어 SQLite 테스트에 `regulation_zones`를 추가했고, 그룹·공유 모달이 닫혀 있어도 dialog를 그려 두므로 온보딩 앱 테스트에서 mock으로 대체했다.
- **마이그레이션 체인 복원 (파일만, DB 미적용):** 진수님이 전달한 `667be58b68d8` 파일을 원문 그대로 추가했다(부모 `258caef7f856` 유지). 공용 DB의 `dashboard_item_groups`·`dashboard_shares` 구조가 이 파일 정의와 일치함을 읽기 전용으로 확인했다. 두 갈래를 합치는 병합 리비전 `b449723601b1`을 만들어 head가 하나가 됐고, `alembic current`가 `667be58b68d8`을 정상 인식한다. 부모를 `c71f9a2d830e`로 바꾸는 안은 택하지 않았다. DB가 `667be58b68d8`에 있으므로 임장 마이그레이션까지 적용된 것으로 간주돼, upgrade를 해도 `property_inspections`가 생성되지 않고 checked 리비전이 체인에서 떨어지기 때문이다. 같은 사고를 막는 `tests/test_alembic_chain.py`(head 1개, 적용된 리비전의 부모 고정, 모든 갈래가 head의 조상)를 추가했다.
- **upgrade 미리보기 (offline `--sql`):** `667be58b68d8` → head 적용 시 `property_inspections` 테이블·인덱스 생성과 `alembic_version` 갱신만 실행된다. 후보·그룹·공유 테이블은 건드리지 않는다. **실제 적용은 사용자 확인 후 진행한다.** 적용되면 main의 후보 삭제 500도 해소된다.
- **Phase 4 전에 결정할 위험:** 그룹 불러오기(`replace_dashboard_items`)는 내 `dashboard_items`를 모두 지운 뒤 스냅샷으로 다시 만든다. 임장 테이블의 외래키가 `ON DELETE RESTRICT`라서, upgrade 후 임장 기록이 있는 후보가 생기면 그룹 불러오기가 실패한다. 또 후보 id가 바뀌어 후보에 연결된 데이터가 끊긴다. 계획서 Phase 4(`groups`·`group_items`, 원본 후보 유지·copy 기본)와 설계가 달라 착수 전에 방향을 정한다.
  - **해소 (2026-09-15):** 사용자 결정에 따라 스냅샷 그룹 백엔드를 제거하고, 기존 후보 id를 유지하는 `groups`·`group_items` 관계 구조로 Phase 4를 구현했다. 아래 "Phase 4 변경 요약" 참고.
- **main 반영 — PR #14 (2026-09-14 17:39):** 진수님이 `fix/alembic-migration-chain`(`8f0953e`)을 main에 머지했다. 내용은 `258caef7f856`·`667be58b68d8`·`b449723601b1` 세 마이그레이션 파일이며, 이 브랜치의 같은 파일과 blob이 동일하다. 작업 트리를 건드리지 않는 시험 병합(`git merge-tree`)에서 충돌이 없었다.
- **이메일 로그인 400 원인:** 수동 확인 시점의 `auth.users`에 새 계정이 없었다. 가입이 완료되지 않은 계정으로 로그인해 `invalid_credentials`가 난 것이다.

## 고정 제약

- `dashboard_items`와 기존 후보 CRUD를 유지한다. `saved_items`, `/saved-items`, `/compare`, `/compare/swap`, `on_compare`는 도입하지 않는다. 비교 체크는 `checked`를 사용한다.
- 그룹은 `groups`와 `group_items`로 추가한다. 중첩 그룹은 만들지 않는다. 새 그룹 생성은 기본 copy이며 source group의 관계를 자동 제거하지 않는다.
- 후보 공유 단위는 group이다. 공유 직전에 후보별 별도 선택 UI를 만들지 않는다.
- 비로그인 사용자는 조회만 가능하다. editor도 타인의 원본 후보를 수정·삭제할 수 없다.
- 기존 profile API와 `/dashboard/insight`를 재사용하고 AI 응답 스키마·내 후보만 검사·오류 형식·금액 단위를 유지한다.
- 임장 DB/CRUD가 현재 브랜치에 없으면 임의로 만들지 않는다.
- 각 Phase만 구현·검증·보고하고 다음 Phase는 자동 시작하지 않는다.

## Phase별 범위

| Phase | 범위 | 현재 상태 |
|---|---|---|
| 1 인증 | 이메일·Google 로그인 → session → 보호 API 및 즉시 재로그인 검증. 최신 main 기준으로 기존 인증 수정안만 반영. 카카오는 이메일 권한 확보 전 사용자 결정에 따른 보류 | 인증 수정·자동 검증·수동 확인 완료. 카카오는 보류, 이메일 인증 메일 수신은 SMTP 연결 후 확인 |
| 2 프로필 + AI | 기존 GET/PATCH `/api/v1/users/me/profile` 사용. `service_purposes === null`은 onboarding, `[]`는 skip 완료, 값 존재는 완료. 목적에 따라 AI 강조점 조정. 나이로 소득·가족·구매력 추론 금지. profile null 동작·응답 스키마 유지 | 구현·자동 검증·수동 확인 완료 |
| 3 checked | 기존 auth 브랜치의 checked 수정안을 필요한 diff만 반영. Alembic, model/schema/service 응답, 프론트 toggle 저장·복원. PATCH에 checked만 보내고 다른 detail 필드 보존 | checked 저장·복원 구현·자동 검증·수동 확인 완료. 정렬 순서 저장(보완)은 구현·격리 검증·공용 DB 적용(`d755235ab9bc`)·main 병합(PR #17) 완료, 수동 확인 대기 |
| 4 groups | `groups`, `group_items`. `POST /api/v1/groups`의 optional `item_ids`로 빈 그룹·선택 후보 그룹·기존 그룹 후보로 새 그룹 생성. clone 전용 API 없음 | 구현·자동 검증·PR #13 main 병합·공용 DB 적용(`ff9db2ef90e4`) 완료. 그룹 메뉴 후속 수정은 PR #16으로 main 병합. 체크리스트 전체 수동 확인 기록 없음 |
| 5 공유/공동참여 | group 단위 공유. public viewer는 read-only. `allow_join=true`일 때 로그인 후 join. membership 기반 그룹 조회와 원본 item owner 기반 수정 권한 분리 | 읽기 전용 그룹 링크 구현·격리 검증·공용 DB 적용(`3c9e1a7b52d4`) 완료, PR 병합·수동 확인 대기. 공동 참여는 사용자 결정으로 보류(구현 계획만) |
| 6 그룹 AI | 기존 `/dashboard/insight`에 그룹 item IDs 전달. 내 후보만 검사 유지. 공동 그룹 전체 AI는 후속 범위 | 미착수 |
| 7 임장 공유 | 현재 브랜치에 임장 DB/CRUD가 있을 때만 시작. 없으면 "선행 임장 데이터 모델이 없어 구현 대기" 보고 | 하지 않음(2026-09-16 사용자 결정). 임장 DB·저장 API는 있으나 웹 체크리스트와 연결 전 — "임장 체크리스트 저장 확인" 참고 |

Phase 2 문구: “간단한 정보를 알려주시면, 내집사가 더 나에게 맞는 AI 인사이트를 제공할 수 있어요.”

Phase 5 CTA: “함께 비교하고 의견을 남기고 싶다면 회원가입하고 공동 참여해보세요.”

## 공통 작업 절차

1. 관련 파일을 읽고 현재 구현과 계획의 차이를 10줄 이내로 정리한다.
2. 수정 파일 목록과 migration 필요 여부를 먼저 제시한다.
3. 해당 Phase만 구현한다. FastAPI router → service → model/schema, SQLAlchemy + Alembic, 기존 Supabase session/auth header를 따른다.
4. 관련 테스트를 실행한다. frontend 변경 시 lint/build도 실행한다.
5. 변경 요약·수정 파일·DB migration·테스트·수동 확인 필요·다음 Phase 전에 확인할 것을 보고한다.
6. 현재 Phase가 완료되지 않으면 다음 Phase로 넘어가지 않는다.

## Phase 1 변경 요약

- 최신 원격 `origin/main`은 `f1e8e52`다. 기존 작업 HEAD `8ffd7f0`와 파일 내용이 같음을 확인하고, `origin/main`에서 `fix/phase1-auth` 브랜치를 생성했다.
- `origin/feature/supabase-auth`의 `f9cc0d1`에는 인증과 checked 수정이 함께 있다. 전체 merge/cherry-pick 없이 인증 부분만 수동 반영했다.
- HS256 및 ES256/RS256 검증의 `verify_iat`만 비활성화했다. 발급 서버의 시계가 앞서 있을 때 로그인 직후 정상 토큰이 거부되는 수정안이다. 허용 알고리즘, 서명, 만료(`exp`), 사용 시작(`nbf`), 대상 서비스(`aud`) 검증을 유지했다.
- 이 수정은 허용 시간 오차에 상한을 추가하는 방식이 아니라 `iat` 검증 자체를 제외하는 방식이다. `iat` 자료형 검증도 제외되며, 원격 인증 수정안의 동작과 같다.
- `alg`가 배열·객체 등 문자열이 아닐 때 500 대신 기존 형식의 401로 거부하도록 보완했다.
- 사용자가 이메일 권한 확보 전 카카오 로그인을 현재 범위에서 제외하기로 했다. `AuthModal.jsx`의 기능 flag를 `false`로 두어 로그인 화면의 카카오 버튼을 숨긴다. 기존 이메일·Google 로그인, 세션 저장, auth header, 기존 후보 CRUD와 프로필/AI/checked 동작은 유지한다.
- 카카오 로그인은 **사용자 결정에 따른 보류**다. 카카오 설정 조치와 실제 로그인 검증은 Phase 1 완료 조건에서 제외하고, 기존 KOE004/KOE205 조사 내용은 향후 재개 참고로 보존한다. Supabase provider·이메일 정책·카카오 콘솔 설정은 변경하지 않는다.
- 실제 계정의 재로그인 성공은 아직 검증하지 않았다. 이 변경은 확인한 브랜치의 `iat` 원인을 처리하며 모든 401 원인을 해결했다고 간주하지 않는다.

### 수정 파일

- [backend/app/core/security.py](../backend/app/core/security.py): 인증 diff 반영, 비정상 알고리즘 자료형 거부.
- [backend/tests/test_auth_algorithms.py](../backend/tests/test_auth_algorithms.py): 미래 발급 시각 및 기존 검증 유지 회귀 테스트.
- [frontend/components/Modal/AuthModal.jsx](../frontend/components/Modal/AuthModal.jsx): 기존 기능 flag로 로그인 화면의 카카오 버튼 숨김 및 비활성 제공자 호출 방지.
- [docs/development-kickoff-plan.md](development-kickoff-plan.md): 사용자 제약과 Phase 1 결과 반영.

### DB migration

없음. DB 스키마·데이터 변경 없음. checked migration은 Phase 3에 남겨둔다.

### 테스트

**이전 인증 변경의 격리 인증 테스트: 40 passed.** 실제 `.env` 로딩을 비활성화하고 테스트용 JWT secret·메모리 SQLite 설정으로 실행했다. SQL 실행은 차단했고, 외부 네트워크도 차단했다. Windows 이벤트 루프에 필요한 loopback 연결만 허용했다. 실제 사용자 계정·후보 데이터는 사용하지 않았다. 이번 카카오 버튼 숨김 변경 후 frontend lint/build도 통과했다. 인증 모달을 메모리에서 정적 렌더링해 카카오 버튼 미노출, Google 버튼 및 이메일·비밀번호 입력란 유지를 확인했다. 이 렌더링 확인에는 실제 OAuth 호출을 사용하지 않았다.

| 항목 | 결과 |
|---|---|
| 기존 + 추가 `test_auth_algorithms.py` | 28개 통과 |
| 토큰 없는 기존 보호 endpoint 9개 | 9개 모두 401 |
| 다른 secret, 잘못된 JWT, 소셜 metadata 추출 | 3개 통과 |
| 미래 `iat` | HS256/ES256/RS256 정상 서명 토큰 허용 |
| 미래 `iat` + 만료/미래 `nbf`/잘못된 `aud`/서명 변조 | 401 유지 |
| `alg` 배열·객체 및 기존 허용 외 알고리즘 | 401, JWKS 미호출 |
| 이전 frontend `npm run lint` | 오류 0개, 기존 img 관련 경고 8개 |
| 이전 frontend `npm run build` | 성공 |
| 카카오 버튼 숨김 후 frontend `npm run lint` | 오류 0개, 기존 img 관련 경고 8개 |
| 카카오 버튼 숨김 후 frontend `npm run build` | 성공 |
| 인증 모달 정적 렌더링 | 카카오 버튼 없음, Google 버튼·이메일·비밀번호 입력란 유지 |
| 실행 중인 로컬 frontend `/` 및 backend `/` | 각각 200 |
| 실행 중인 로컬 profile API 무토큰 / 후보 목록 API 잘못된 토큰 | 각각 401, `UNAUTHORIZED` |

테스트 실행 대상은 아래와 같다. 실제 `.env`를 사용하는 전체 통합 테스트는 실행하지 않았다. 기존 `conftest.py`의 `auth` fixture는 실제 첫 사용자 후보를 삭제·프로필 초기화하므로 별도 검증 환경 없이 전체 테스트를 실행하지 않는다.

```text
pytest tests/test_auth_algorithms.py
       tests/test_auth.py::test_requires_token
       tests/test_auth.py::test_wrong_secret_is_rejected
       tests/test_auth.py::test_malformed_token_is_rejected
       tests/test_auth.py::test_social_metadata_is_extracted
       -q -p no:cacheprovider
```

기존 Starlette/anyio 사용 중단 예정 안내 2개와 테스트용 잘못된 HMAC 키 길이 경고 2개는 남아 있다. 이번 Phase에서 라이브러리 교체는 수행하지 않는다.

### 실제 설정·연결 확인

비밀 값은 출력하지 않고 기존 설정의 유무·일치 여부와 공개 인증 진입 응답만 확인했다.

| 확인 | 결과 | 검증의 한계 |
|---|---|---|
| 프론트/백엔드 Supabase URL | 같은 프로젝트 | 콘솔 전체 설정 일치까지 의미하지 않음 |
| 프론트 공개 키, 백엔드 JWT secret/DB URL | 설정 존재 | 값 전체의 유효성을 단정하지 않음 |
| Supabase `/auth/v1/settings` | 200; Kakao/Google/email 활성화 | 카카오 앱 자체의 사용 설정과는 별개 |
| Kakao authorize 진입 | 302 → `kauth.kakao.com`, 프로젝트 callback 일치 | 카카오 로그인·동의·토큰 교환 미완료 |
| Google authorize 진입 | 302 → `accounts.google.com`, 프로젝트 callback 일치 | Google 로그인·동의·토큰 교환 미완료 |
| 사용자 제공 카카오 오류 | 최초 `KOE004` → QR 인증 진행 후 `KOE205` | 로그인 사용 설정 이후 동의항목 단계에서 실패 |
| Kakao authorize의 실제 scope | `account_email profile_image profile_nickname` | 키·state·토큰은 출력하지 않고 scope만 조회 |
| KOE205 상세 화면 | 위 세 항목 모두 미설정으로 표시 | Supabase 요청 항목과 카카오 앱의 동의항목 설정 불일치 확인 |

### 수동 확인 필요

현재 Phase 1에서 필요한 수동 확인은 아래와 같다. 카카오 설정 조치와 로그인 성공은 현재 완료 조건에 포함하지 않는다.

1. 로그인 화면에서 카카오 버튼이 숨겨지고 이메일·Google 로그인이 계속 제공되는지 확인한다.
2. 이메일·Google 각각 실제 로그인 후 앱 복귀 → session 생성 → 첫 `/api/v1/users/me/profile` 및 `/api/v1/dashboard/items` 조회가 200인지 확인한다.
3. 로그아웃 → 즉시 재로그인 후 첫 보호 API가 성공하는지 확인한다. 토큰 원문·비밀키는 공유하지 않는다.

이메일·Google의 실제 로그인과 재로그인 성공은 아직 검증하지 않았다. 카카오 보류 결정만으로 Phase 1 전체를 완료 처리하지 않는다.

### 카카오 보류 이력 및 향후 재개 참고

사용자는 이메일 허용을 위한 앱 권한 준비 때문에 카카오 로그인을 현재 단계에서 제외하기로 했다. 이는 **이메일 권한 확보 전 사용자 결정에 따른 보류**다. 아래 조사 결과와 설정 확인 절차는 향후 카카오 재개 시 참고용으로 남긴다.

최초 `KOE004` 이후 사용자가 카카오 설정을 조치했고, QR 인증 뒤 `KOE205`가 표시됐다. 당시 상세 화면은 `account_email`, `profile_image`, `profile_nickname` 세 동의항목 모두 미설정이라고 명시했다. 실제 Supabase authorize 요청에서도 같은 세 scope를 확인했다. 재개 시에는 카카오 앱의 동의항목과 요청 항목을 일치시켜야 한다. [카카오 공식 오류 안내](https://developers.kakao.com/docs/ko/kakaologin/trouble-shooting)

향후 재개할 때 **Supabase에 등록한 REST API 키가 속한 카카오 앱**(오류 화면 표시명: “서울 사람”)에서 다음을 확인한다.

1. Kakao Developers → 해당 앱 → 카카오 로그인 → 사용 설정 → 상태를 **ON**으로 설정한다.
2. 이미 ON이면 Supabase Kakao provider의 Client ID가 그 앱의 **REST API 키**인지 확인한다. 다른 앱이나 다른 종류의 키와 혼동하지 않는다.
3. 카카오 로그인 → 동의항목에서 **닉네임(`profile_nickname`)**, **프로필 사진(`profile_image`)**, **카카오계정 이메일(`account_email`)**의 사용 설정을 확인하고 저장한다. 현재는 세 항목 모두 미설정이므로 닉네임·사진만 설정하고 이메일을 남겨두면 같은 오류가 계속될 수 있다.
4. `account_email`이 앱 권한상 설정 불가라면 그 상태를 먼저 확인한다. 기존 이메일 수신 동작을 보존하려면 해당 항목의 사용 권한·설정을 확보해야 한다. 이메일 없이 로그인하는 방식은 별도 대안이며, Supabase의 **Allow users without an email**과 이메일을 제외한 scope 요청을 함께 검토해야 한다. 현재는 이 정책·코드를 변경하지 않았다. [Supabase Kakao 설정](https://supabase.com/docs/guides/auth/social-login/auth-kakao)
5. Kakao redirect URI는 Supabase 프로젝트의 `https://<project-ref>.supabase.co/auth/v1/callback`으로 확인한다. Supabase Redirect URLs에는 앱 복귀 주소를 등록한다. 현재 코드의 `redirectTo`는 `window.location.origin`이다. [앱 복귀 URL 설정](https://supabase.com/docs/guides/auth/redirect-urls)
6. 설정과 카카오 버튼 복원을 반영한 뒤 `http://localhost:3000`에서 카카오 로그인을 새로 시작한다. 앱 복귀 → session 생성 → 첫 `/api/v1/users/me/profile` 및 `/api/v1/dashboard/items` 조회가 200인지 확인한다. 당시 로컬 backend 확인 주소는 `http://127.0.0.1:8000`이었다.
7. 카카오 로그아웃 → 즉시 재로그인 후 첫 보호 API를 다시 확인하고, 이메일·Google 실제 로그인도 회귀 확인한다. 토큰 원문·비밀키는 공유하지 않는다.

당시 자동화 세션에 연결된 브라우저가 없어 실제 사용자 계정으로 위 흐름을 완료하지 못했다. 에이전트가 콘솔 설정·기존 자격증명·계정을 변경하지 않았으며, KOE004/KOE205 해결을 위한 scope·이메일 정책 변경은 적용하지 않았다. 이번 프론트 변경은 사용자 보류 결정에 따른 카카오 버튼 숨김에 한정한다.

### 다음 Phase 전에 확인할 것

- [x] 사용자 결정에 따라 카카오 로그인을 현재 범위에서 보류하고 설정·실제 로그인 검증을 완료 조건에서 제외.
- [x] 카카오 버튼 숨김 후 frontend lint/build 및 로그인 화면 정적 렌더링 확인.
- [ ] 실제 로그아웃 → 즉시 재로그인 후 첫 보호 API 성공.
- [ ] 실제 이메일·Google 로그인 → session → 첫 보호 API 성공.
- [ ] Phase 1 결과 확인 및 필요 시 main 반영·배포.

위 현재 범위의 실제 로그인 검증은 대기 중이다. 이후 사용자가 Phase 2 진행을 명시적으로 요청하여 아래 범위를 구현했다. 카카오의 KOE205 해소는 보류 범위다. 현재 코드 변경은 로컬 작업 브랜치에 있으며 커밋·push·main 병합·배포는 수행하지 않았다.

## Phase 2 변경 요약

- 기존 프로필 model/schema/API가 nullable `service_purposes`와 부분 PATCH를 이미 지원하여 새 API·테이블 없이 연결했다.
- 로그인 세션 복원/변경 후 `GET /api/v1/users/me/profile`을 호출한다. `service_purposes === null`일 때만 온보딩을 표시하고, `[]`와 선택값은 완료로 처리한다.
- 닉네임·나이대는 선택 입력이며 이용 목적은 기존 `move/buy/jeonse/invest` 값으로 복수 선택한다. 안내문은 지정된 문구를 그대로 사용한다.
- 저장은 기존 PATCH를 사용한다. 건너뛰기는 `{ "service_purposes": [] }`만 보내 기존 닉네임·나이대를 보존한다. 요청 성공 후 닫으며 실패하면 입력과 모달을 유지한다.
- 계정 전환 중 이전 화면의 프로필/AI 요청은 세션 사용자 ID를 확인한다. 이전 계정의 늦은 응답과 저장 뒤 도착한 이전 조회 응답은 화면에 반영하지 않는다.
- 초기 `getSession()` 응답이 이미 수신한 최신 로그인 이벤트를 덮어쓰지 않도록 보완했다. 기존 후보 등록·편집·인증 모달이 열려 있으면 온보딩은 해당 모달이 닫힌 후 표시한다.
- 기존 `/dashboard/insight`에서 현재 프로필의 이용 목적만 고정 강조 지침으로 변환한다. 나이·닉네임 값은 AI에 전달하지 않으며 소득·가족 구성·구매력 추론 금지 지침을 둔다.
- 목적이 null/빈 배열이면 기존 system/user prompt를 유지한다. `get_items_with_metrics(db, user_id)` 소유권 필터, 요청·응답 schema, 오류 형식, 금액 단위는 유지한다.
- 인사이트 화면의 기존 빈 영역에 선택 후보 분석 버튼과 요약·강점·약점·분석 시각을 연결했다. 사용자의 클릭 때만 실행하며 비로그인·빈 선택에서는 호출하지 않는다. 후보·계정·목적이 바뀌면 이전 결과를 폐기한다.
- 후보 CRUD와 checked 저장 동작은 이번 Phase에서 변경하지 않았다. checked 영속화는 Phase 3 범위다.
- 사용자 추가 요청으로 로그인 후 헤더에 마이페이지를 연결했다. 로그인 계정 이메일을 확인하고 닉네임·나이대·이용 목적을 수정할 수 있다. 기존 온보딩 폼을 편집 모드로 재사용하며 새 페이지/API는 추가하지 않는다.
- 마이페이지에서는 기존 값을 채워 보여주고 저장 성공 후 닫는다. 취소·닫기·Escape는 저장하지 않으며, 저장 실패 시 입력을 유지한다. 이용 목적을 모두 해제하면 `[]`를 저장해 온보딩 완료 상태를 유지한다. 계정 변경 시 열린 마이페이지는 닫힌다.

### 수정 파일

| 파일 | 변경 내용 |
|---|---|
| [frontend/components/Header.jsx](../frontend/components/Header.jsx) | 로그인 후 마이페이지 진입점, 비로그인 시 기존 로그인 진입 유지 |
| [frontend/components/NaejipsaApp.jsx](../frontend/components/NaejipsaApp.jsx) | 로그인 후 프로필 연결, 모달 표시 조건, 최신 인증 이벤트 보존, AI용 현재 사용자 후보 전달 |
| [frontend/hooks/useProfileOnboarding.js](../frontend/hooks/useProfileOnboarding.js) | 기존 프로필 조회·저장·재시도와 늦은 응답 무효화 |
| [frontend/components/Modal/ProfileOnboardingModal.jsx](../frontend/components/Modal/ProfileOnboardingModal.jsx) | 온보딩과 마이페이지 편집 폼 공유, 선택 입력·목적 복수 선택·저장·건너뛰기·취소·실패 처리 |
| [frontend/lib/api.js](../frontend/lib/api.js) | 기존 GET/PATCH profile 및 POST insight 연결, Supabase 세션·오류 형식 재사용 |
| [frontend/components/Workspace.jsx](../frontend/components/Workspace.jsx), [frontend/components/Dashboard/Dashboard.jsx](../frontend/components/Dashboard/Dashboard.jsx) | 기존 컴포넌트 경로로 AI props 전달 |
| [frontend/components/Insight/InsightPanel.jsx](../frontend/components/Insight/InsightPanel.jsx) | 분석 실행·로딩·결과·실패·재시도·결과 초기화 |
| [frontend/app/globals.css](../frontend/app/globals.css) | 온보딩과 기존 인사이트 영역 스타일 |
| [backend/app/insight/router.py](../backend/app/insight/router.py), [backend/app/insight/service.py](../backend/app/insight/service.py) | 이용 목적만 전달하고 고정 강조 지침 추가 |
| [backend/app/user/router.py](../backend/app/user/router.py) | 온보딩 상태 설명 주석 정정; API 동작 유지 |
| [backend/tests/test_profile_onboarding.py](../backend/tests/test_profile_onboarding.py), [backend/tests/test_insight_profile.py](../backend/tests/test_insight_profile.py) | 격리 프로필·AI 회귀 테스트 |
| [frontend/tests/profile-onboarding.test.jsx](../frontend/tests/profile-onboarding.test.jsx), [frontend/tests/app-onboarding.test.jsx](../frontend/tests/app-onboarding.test.jsx) | 온보딩 저장/skip/재로그인/계정 전환/앱 연결 검증 |
| [frontend/tests/profile-edit.test.jsx](../frontend/tests/profile-edit.test.jsx) | 마이페이지 초기값·수정·취소·실패·목적 전체 해제 검증 |
| [frontend/tests/profile-api.test.js](../frontend/tests/profile-api.test.js), [frontend/tests/insight-panel.test.jsx](../frontend/tests/insight-panel.test.jsx) | auth header·기존 API·분석 화면 회귀 검증 |
| [frontend/vitest.config.mjs](../frontend/vitest.config.mjs), [frontend/package.json](../frontend/package.json), [frontend/package-lock.json](../frontend/package-lock.json) | Vitest/jsdom/Testing Library 테스트 환경과 `npm test` 추가; 기존 의존성 버전 변경 없음 |
| [.gitignore](../.gitignore) | 로컬 검증용 `.tmp/` 산출물 제외 |
| [docs/development-kickoff-plan.md](development-kickoff-plan.md) | Phase 2 결과와 검증 범위 기록 |

기존 Phase 1 변경인 `backend/app/core/security.py`, `backend/tests/test_auth_algorithms.py`, `frontend/components/Modal/AuthModal.jsx`도 같은 작업 브랜치에 남아 있다. Phase 2에서 카카오 제공자 설정은 변경하지 않았다.

### DB migration

**없음.** 기존 profiles 컬럼과 GET/PATCH API를 사용한다. SQLAlchemy 모델·Pydantic schema·Alembic revision은 변경하지 않았다. 실제 DB 스키마나 사용자 데이터도 이번 검증에서 변경하지 않았다.

### 테스트

- 백엔드 **71 passed**: Phase 2 프로필 14개 + AI 17개 + 기존 인증 회귀 40개.
- 프론트엔드 `npm test`: **44 passed** (온보딩 10개 + 앱 연결·마이페이지 연결 7개 + 마이페이지 편집 4개 + API 5개 + AI 화면 18개). 마이페이지 추가 전 기록은 37개였다.
- `npm run lint`: 오류 0개, 기존 `<img>` 관련 경고 8개.
- `npm run build`: production build 및 정적 페이지 생성 성공.
- `git diff --check`: 공백 오류 없음.

백엔드는 `.env` 로딩 비활성화, 테스트 전용 JWT secret, SQLite 설정과 SQL/외부 네트워크 차단 하에 선택한 테스트만 실행했다. 새 프로필 테스트는 메모리 저장소로 실제 JWT 검증과 기존 dependency·router를 통과하며 null/[]/선택값의 요청 간 보존과 사용자 분리를 확인한다. AI 테스트는 DB 조회와 LLM을 mock하여 목적별 강조점, null/[] 기존 프롬프트 동일성, 나이·닉네임 미접근, 소유권 필터, schema, 400/503을 확인한다.

프론트 테스트는 jsdom에서 실제 React 컴포넌트와 hook을 실행하고 API/Supabase를 mock한다. 저장/skip 후 재로그인·재마운트 비반복, 조회·저장 실패 재시도, 계정 전환, 늦은 GET/PATCH/AI 응답, 중복 실행 방지, 기존 후보 모달 우선 표시를 검증한다. 실제 OAuth나 유료 AI 요청을 자동으로 실행하지 않았다. 검증 환경은 Node 24.18.1이며 새 테스트 도구는 Node 24.15 이상인 24.x 또는 지원되는 최신 22.x/26.x 환경이 필요하다.

### 수동 확인 필요

1. 이메일·Google 실제 로그인 후 프로필 조회 200 및 최초 `service_purposes=null` 사용자에게 온보딩이 표시되는지 확인한다. Phase 1의 즉시 재로그인 보호 API 검증도 함께 확인한다.
2. 이용 목적 저장 → 새로고침/재로그인 시 모달 미노출을 확인한다. 다른 최초 사용자로 건너뛰기 → 재로그인 시에도 반복하지 않는지 확인한다.
3. 관심 후보를 선택하고 인사이트 탭에서 AI 분석을 실행해 요약·강점·약점이 표시되는지 확인한다. 목적 설정 여부와 관계없이 실행 가능하며, 외부 AI 미설정/장애 시 실패 안내와 재시도가 표시되어야 한다.
4. 모바일·데스크톱에서 모달 높이/스크롤/키보드 포커스와 실제 AI 결과의 가독성을 확인한다.
5. 헤더 마이페이지 → 프로필 수정 → 다시 열기/새로고침에서 저장값을 확인한다. 취소 시 기존 값이 유지되고, 이용 목적 전체 해제 후에도 온보딩이 다시 표시되지 않는지 확인한다.

실제 Supabase/DB 저장, 외부 LLM의 목적 반영 품질, 브라우저 화면 배치는 격리 자동 테스트만으로 검증하지 않았다. 실제 계정을 연결한 브라우저 검증은 남아 있다.

### 다음 Phase 전에 확인할 것

- [x] Phase 2 구현과 격리 자동 테스트.
- [x] frontend lint/build.
- [ ] 실제 계정 온보딩 저장·건너뛰기·재로그인 및 AI 응답 확인.
- [ ] Phase 2 수동 확인 결과 검토 후 사용자의 Phase 3 착수 지시.

**Phase 3은 시작하지 않았다.** 현재 Phase 2는 구현·자동 검증 완료이며 수동 확인 대기 상태다. 커밋·push·병합·배포는 수행하지 않았다.

## Phase 3 변경 요약 (checked)

2026-09-14 오후 사용자의 진행 지시로 착수했다. 착수 시점의 계획 대비 차이는 다음과 같았다.

1. 공용 DB에는 `dashboard_items.checked`(boolean, NOT NULL, 기본 true)가 이미 있다. 그 마이그레이션 파일 `258caef7f856`이 git에 없었다.
2. 모델·요청/응답 스키마·응답 조립 코드에 `checked`가 없었다.
3. PATCH details는 이미 `exclude_unset`으로 보낸 필드만 반영한다.
4. 프론트 체크 토글은 로컬 상태만 바꾸고, 서버 목록 복원 시 `checked: true`로 고정했다.
5. 편집창 저장 요청(`toDetailsPayload`)에는 `checked`가 없어 체크 상태를 건드리지 않는다.

구현 내용은 다음과 같다.

- `origin/feature/supabase-auth`의 `f9cc0d1`에서 checked 관련 diff(마이그레이션 파일·model·schema·service)만 그대로 적용했다. 같은 커밋의 인증 수정은 Phase 1에서 이미 반영했다.
- 등록(A-03)은 `checked`를 생략하면 true, 수정(A-06)은 `checked`를 보낼 때만 바꾼다. 목록·단건·집계 응답에 `checked`가 포함된다.
- 프론트 토글은 로그인 상태에서 `PATCH .../details`에 `{ checked }`만 보내고, 성공한 뒤 화면에 반영한다. 실패하면 상태를 유지하고 안내한다. 저장 중인 카드의 연속 클릭은 무시해 이전 값 기준 중복 저장을 막는다.
- 서버 목록을 불러올 때 저장된 `checked`로 복원한다. `checked`가 없는 예전 응답은 기존 기본값(true)을 쓴다.
- 사용자 결정에 따라 같은 Phase로 합친 **정렬 순서 컬럼은 이번에 넣지 않았다.** 새 마이그레이션이 필요한데, `667be58b68d8` 파일(진수님 PC에만 존재) 복원과 merge revision 없이 체인을 만들 수 없기 때문이다.

### 수정 파일

| 파일 | 변경 내용 |
|---|---|
| [backend/alembic/versions/20260911_0813_258caef7f856_add_dashboard_items_checked.py](../backend/alembic/versions/20260911_0813_258caef7f856_add_dashboard_items_checked.py) | 원본 그대로 git에 추가 |
| [backend/app/dashboard/model.py](../backend/app/dashboard/model.py), [schema.py](../backend/app/dashboard/schema.py), [service.py](../backend/app/dashboard/service.py) | `checked` 컬럼·요청/응답 필드·응답 조립 |
| [frontend/components/NaejipsaApp.jsx](../frontend/components/NaejipsaApp.jsx) | 토글 저장, 실패 안내, 연속 클릭 방지 |
| [frontend/lib/dashboardItems.js](../frontend/lib/dashboardItems.js) | 서버 값으로 체크 상태 복원 |
| [backend/tests/test_dashboard_checked.py](../backend/tests/test_dashboard_checked.py), [frontend/tests/dashboard-checked.test.jsx](../frontend/tests/dashboard-checked.test.jsx) | 신규 테스트 |

### DB migration

`258caef7f856` 파일을 git에 추가했다. 공용 DB에는 이미 적용돼 있어 **upgrade를 실행하지 않았다.** DB의 현재 버전 `667be58b68d8` 파일이 복원되기 전까지 alembic 명령은 계속 실패한다.

### 테스트

- 백엔드 **255 passed**. 신규 8개는 임시 SQLite에서 router → service → model을 통과한다. 끄기 → 다음 조회에서 꺼짐 유지, checked만 보내면 호가·동·호·향·수리·메모 유지, 편집 저장 시 체크 유지, 사용자 간 분리(남의 후보 404), 새 후보 기본 true, 잘못된 값 422, 마이그레이션이 기존 행을 true로 채움을 확인한다.
- 프론트 **59 passed**. 신규 6개는 끄기 → 로그아웃 → 재로그인 후 꺼짐 복원, PATCH 바디가 `{ checked }`뿐임, 저장 실패 시 상태 유지·안내, 연속 클릭 1회 저장, 계정별 분리를 확인한다.
- Phase 3 코드를 빼면 신규 테스트가 실패함을 확인했다(프론트 6/6 실패, 백엔드 fixture 오류).
- `npm run lint` 오류 0개(기존 경고 8개), `npm run build` 성공.
- 실행 중인 로컬 백엔드에 읽기 전용 `GET /api/v1/dashboard/items`를 보내 실제 DB 값의 `checked`가 응답에 포함됨을 확인했다(데이터 변경 없음).

### 수동 확인 필요

1. 로그인 → 후보 카드 체크 끄기 → 새로고침 후에도 꺼져 있는지 확인한다.
2. 로그아웃 → 다시 로그인 후에도 꺼져 있는지 확인한다.
3. 체크를 끈 후보를 편집창에서 호가만 바꿔 저장해도 체크가 꺼진 채로 남는지, 반대로 체크를 바꿔도 호가·동·호가 그대로인지 확인한다.
4. 체크를 끈 후보가 차트와 AI 분석 대상에서 빠지는지 확인한다.
5. 다른 계정으로 로그인하면 그 계정의 체크 상태가 따로 보이는지 확인한다.

### 다음 Phase 전에 확인할 것

- [ ] Phase 3 수동 확인.
- [ ] 진수님 백업 브랜치 push → `667be58b68d8` 파일 복원 → `c71f9a2d830e`(임장)와 merge revision → `alembic upgrade head` 실행 승인(임장 테이블 생성, 후보 삭제 500 해소).
- [ ] 위 체인 복원 후 정렬 순서 컬럼 구현(Phase 3 보완).
- [ ] 사용자의 Phase 4 착수 지시. **Phase 4는 시작하지 않았다.**

## Phase 4 변경 요약 (groups)

2026-09-14 저녁 사용자의 진행 지시로 착수했다. 사용자 결정은 세 가지다. 마이그레이션은 부모를 바꾸지 않고 병합 리비전으로 합친다. 진수님이 만든 그룹 백엔드는 빼고 계획대로 구현한다. 그룹은 기존 후보 id를 유지하는 구조로 간다. 착수 시점의 계획 대비 차이는 다음과 같았다.

1. main의 그룹(PR #12)은 `dashboard_item_groups.items`(JSONB)에 후보 내용을 복사해 두는 스냅샷이다.
2. 그룹 "불러오기"는 내 `dashboard_items`를 모두 지우고 스냅샷으로 다시 만들어 후보 id가 바뀐다. 임장 기록(`ON DELETE RESTRICT`)이 있는 후보가 생기면 실패하고, 후보에 연결된 데이터가 끊긴다.
3. 계획은 `groups`·`group_items` 관계 테이블, `POST /api/v1/groups`의 선택 `item_ids`, 복제 전용 API 없음, 원래 그룹 관계 유지다.
4. 공유(`dashboard_shares`)는 Phase 5 범위라 이번에 바꾸지 않는다.

구현 내용은 다음과 같다.

- **구조:** 그룹은 후보를 가리키기만 한다. 어떤 그룹 조작도 `dashboard_items`를 지우거나 새로 만들지 않는다.
  - `group_items`의 복합 PK `(group_id, dashboard_item_id)`로 한 그룹 안의 중복을 막는다. 같은 후보는 여러 그룹에 들어갈 수 있다. 중첩 그룹은 없다.
  - 그룹 삭제·그룹에서 빼기는 관계만 지운다. 후보를 삭제하면 그 후보의 관계만 함께 지워진다(`ON DELETE CASCADE`).
  - 후보는 주인만 그룹에 넣을 수 있으므로 "누가 넣었는지"는 `dashboard_items.user_id`로 알 수 있다. 그래서 별도 컬럼을 두지 않았다.
- **API** (`app/group`, 모두 로그인 필수, 남의 그룹·후보는 존재 여부와 무관하게 404):

  | 메서드 | 경로 | 동작 |
  |---|---|---|
  | GET | `/api/v1/groups` | 내 그룹 목록(후보 수 포함) |
  | POST | `/api/v1/groups` | 그룹 만들기. `item_ids` 생략 시 빈 그룹 |
  | GET | `/api/v1/groups/{id}` | 상세(`item_ids` + 후보 목록과 같은 모양의 `items`) |
  | PATCH | `/api/v1/groups/{id}` | 이름 변경 |
  | DELETE | `/api/v1/groups/{id}` | 그룹 삭제(후보 유지) |
  | POST | `/api/v1/groups/{id}/items` | 기존 그룹에 후보 추가. 이미 있는 후보가 섞이면 하나도 넣지 않고 409 |
  | DELETE | `/api/v1/groups/{id}/items/{item_id}` | 그룹에서 빼기(후보 유지) |

  기존 그룹의 후보로 새 그룹을 만들 때도 같은 `POST /groups`에 그 후보 id를 넘긴다(화면에서는 그룹을 보는 중에 "새 그룹 만들기"). 그룹 수 상한은 기존 화면 기준대로 8개, 이름은 1~30자(앞뒤 공백 제거)다.
- **진수님 그룹 백엔드 제거:** 다음을 뺐다.
  - `/dashboard/groups` 6개 경로
  - `replace_dashboard_items`
  - 그룹 스키마 4개
  - `DashboardItemGroup` 모델과 `MAX_DASHBOARD_GROUPS`

  공유 경로와 스냅샷 헬퍼는 Phase 5까지 그대로 둔다. DB의 `dashboard_item_groups` 테이블과 기존 3행은 **지우지 않았다.** 앱에서 사용만 멈췄고, `include_object`가 모델 밖 테이블을 무시하므로 autogenerate가 DROP을 만들지 않는다.
- **화면:** "선택"은 기존 카드 체크(`checked`)를 그대로 쓴다. 별도 선택 UI는 만들지 않았다(2026-09-15 사용자 확인: 이 방식 유지).
  - **그룹 메뉴(헤더 그룹 아이콘):** 그룹에 관한 동작은 모두 이 메뉴 하나에서 한다.
    - 그룹 줄(이름·후보 수): 누르면 그 그룹 보기. 보고 있는 그룹은 이름·후보 수 글자색만 메인색으로 표시하고(배경·테두리 없음), 한 번 더 누르면 전체 후보로 돌아간다.
    - "추가"는 체크한 후보 중 그 그룹에 없는 후보만 넣는다(서버도 409로 막는다).
    - 연필은 모달 없이 그 자리에서 이름을 고친다(Enter·입력칸 밖 클릭 저장, Esc 취소).
    - X는 그룹만 삭제한다.
    - 맨 아래 "새 그룹 만들기"는 이름을 묻지 않고 기본 이름("새 그룹", 겹치면 "새 그룹 2")으로 바로 만들고 새 줄의 이름 입력칸을 연다. 보고 있는 화면은 바꾸지 않는다. 지금 보이는 목록(전체 후보 또는 보고 있는 그룹)에서 체크한 후보로 만든다(체크가 없으면 빈 그룹). 그래서 "이 그룹으로 새 그룹 만들기"를 따로 두지 않는다.
  - **사용자 피드백 반영 이력 (2026-09-15):**
    1. 목록 위 "전체 후보 · 새 그룹 만들기 · 기존 그룹에 추가" 줄과 그룹 보기 줄은 만들기·추가 동작만 늘어놓아 그룹 전체를 한눈에 볼 수 없어 폐기하고 그룹 메뉴로 옮겼다.
    2. 그룹 메뉴에서 "전체 후보" 줄, "이 그룹으로 새 그룹 만들기", 이름 수정 모달, 헤더 버튼의 그룹 이름 표시를 뺐다. 기능은 그대로다.
    3. 새 그룹 이름 모달을 없애고 바로 만든 뒤 그 자리에서 이름을 고치게 했다. 보고 있는 그룹의 테두리·연한 배경 표시는 빼고 글자색만 남겼으며, 마우스로 누른 뒤 남던 전역 포커스 테두리를 그룹 메뉴에서 없앴다(키보드 이동 시 테두리는 유지).
    4. 헤더의 "마이페이지" 글자 버튼을 공유·그룹과 같은 원형 사람 아이콘 버튼으로 바꿨다(접근성 이름·툴팁은 "마이페이지", 프로필을 불러오기 전에는 흐리게 비활성).
  - **그룹 보기:** 후보를 교체하지 않고 목록을 그 그룹 후보로 좁혀 보여준다.
    - 카드 X는 그룹에서 빼기다(후보 유지).
    - 드래그는 보이는 후보끼리만 순서를 바꾼다.
    - 매물 추가는 전체 후보에 등록한 뒤 이 그룹에도 넣는다.
    - 차트·AI 분석도 보이는 후보 기준이다.

### 수정 파일

| 파일 | 변경 내용 |
|---|---|
| [backend/app/group/](../backend/app/group/) (`model.py`, `schema.py`, `service.py`, `router.py`) | 신규 그룹 모듈 |
| [backend/alembic/versions/20260914_1733_16bbbf4cc3a5_create_groups_and_group_items.py](../backend/alembic/versions/20260914_1733_16bbbf4cc3a5_create_groups_and_group_items.py) | 신규 마이그레이션(`b449723601b1` 다음) |
| [backend/alembic/env.py](../backend/alembic/env.py) | 손으로 만든 외래키 `fk_groups_owner` 등록 |
| [backend/app/main.py](../backend/app/main.py) | 그룹 라우터 등록 |
| [backend/app/dashboard/router.py](../backend/app/dashboard/router.py), [service.py](../backend/app/dashboard/service.py), [schema.py](../backend/app/dashboard/schema.py), [model.py](../backend/app/dashboard/model.py) | 스냅샷 그룹 코드 제거(공유는 유지) |
| [frontend/lib/api.js](../frontend/lib/api.js) | 옛 그룹 함수 제거, 새 그룹 API 7개 |
| [frontend/components/NaejipsaApp.jsx](../frontend/components/NaejipsaApp.jsx) | 그룹 보기(필터)·만들기·복사·추가·빼기·삭제 상태와 처리 |
| [frontend/components/Dashboard/DashboardList.jsx](../frontend/components/Dashboard/DashboardList.jsx), [Dashboard.jsx](../frontend/components/Dashboard/Dashboard.jsx), [Workspace.jsx](../frontend/components/Workspace.jsx) | 그룹 보기에서 남은 등록 칸을 전체 후보 수로 계산, props 전달 |
| [frontend/components/Dashboard/GroupBar.jsx](../frontend/components/Dashboard/GroupBar.jsx), [Header.jsx](../frontend/components/Header.jsx) | 그룹 메뉴(그룹 보기·추가·이름 바로 수정·삭제·새 그룹 만들기), 보고 있는 그룹 줄 테두리 |
| [frontend/components/Modal/SaveGroupModal.jsx](../frontend/components/Modal/SaveGroupModal.jsx), [ImportShareModal.jsx](../frontend/components/Modal/ImportShareModal.jsx), [frontend/lib/data.js](../frontend/lib/data.js), [frontend/app/globals.css](../frontend/app/globals.css) | 기본 문구·주석·표시줄 스타일 |
| [backend/tests/test_groups.py](../backend/tests/test_groups.py), [frontend/tests/dashboard-groups.test.jsx](../frontend/tests/dashboard-groups.test.jsx), [frontend/tests/group-api.test.js](../frontend/tests/group-api.test.js) | 신규 테스트 |

### DB migration

새 리비전 `16bbbf4cc3a5`(부모 `b449723601b1`, head 1개)다. **파일만 만들었고 공용 DB에는 적용하지 않았다.**

offline `--sql` 기준으로 공용 DB 현재 위치 `667be58b68d8` → head 적용 시 실행되는 문장은 다음뿐이다.

- `property_inspections` 테이블·인덱스 생성
- `groups` 테이블·인덱스 생성
- `groups.owner_user_id → profiles.id`(CASCADE) 외래키 추가
- `group_items` 테이블(복합 PK, 두 외래키 CASCADE)·인덱스 생성
- `alembic_version` 갱신

기존 테이블을 지우거나 바꾸는 문장은 없다.

**적용 (2026-09-15, 사용자 승인):**
- 적용 직전 확인에서 공용 DB는 이미 `b449723601b1`이었고 `property_inspections`도 있었다. main 기준으로 누군가 upgrade를 실행한 것으로 보인다.
- 그래서 `alembic upgrade 16bbbf4cc3a5`로 `groups`·`group_items`만 추가했다.
- 적용 후 읽기 전용으로 확인한 결과는 다음과 같다.
  - 컬럼·외래키(CASCADE)·복합 PK·인덱스가 파일 정의와 같다.
  - 모델과 DB 비교에서 차이가 없다.
  - 기존 행 수(후보 4, 프로필 3, 공유 10, 옛 그룹 3)는 그대로다.

**예전 그룹 데이터 삭제 (사용자 결정, 2026-09-15):**
- `dashboard_item_groups`를 지우는 리비전 `ff9db2ef90e4`(부모 `16bbbf4cc3a5`)를 만들었다.
- **PR #13 머지 후에 적용한다.** main에는 아직 이 테이블을 읽는 옛 그룹 코드가 있어, 먼저 지우면 main을 실행 중인 화면의 그룹 목록이 500이 된다.
- **적용 (2026-09-15):** PR #13이 main에 병합된 뒤 main 코드에 이 테이블 참조가 없음을 확인하고 `alembic upgrade ff9db2ef90e4`로 적용했다. 그룹 2개·후보·공유 행 수는 그대로다.
- downgrade는 빈 테이블 구조만 되살리고, 지운 데이터는 돌아오지 않는다.
- `tests/test_alembic_chain.py`에 적용된 `b449723601b1`·`16bbbf4cc3a5`의 부모 고정을 추가했다.

### 테스트

- **백엔드 신규 12개** (임시 SQLite, 외래키 검사 켬):
  - 빈 그룹
  - `item_ids` 그룹
  - 그룹 → 새 그룹(원래 그룹 유지)
  - 같은 후보 여러 그룹
  - 중복 차단(409·422, 섞이면 하나도 안 넣음)
  - 그룹에서 빼도 후보 유지
  - 그룹 삭제해도 후보 유지
  - 후보 삭제 시 관계만 제거
  - IDOR(남의 그룹 조회·수정·삭제·추가·빼기, 남의 후보로 만들기·추가 모두 404)
  - 그룹 수 상한
  - 이름 공백·길이
  - 옛 스냅샷 경로 404

  그룹 조작 전후로 후보 id·내용·등록 시각이 같은지도 비교한다.
- **백엔드 실행 결과:** **275 passed**(conftest 픽스처를 쓰지 않는 파일 188개 + `client`만 쓰는 인증·청약 4개 파일 87개). 실DB 후보를 비우는 `auth` 픽스처를 쓰는 `test_insight.py`·`test_user_api.py`는 실행하지 않았다.
- **프론트 신규 10개:**
  - 그룹 동작은 헤더 그룹 메뉴에만 있고, 메뉴에 "전체 후보"·"이 그룹으로 새 그룹 만들기"가 없음
  - 그룹을 누르면 목록만 좁히고 그 줄에 테두리, 한 번 더 누르면 전체 후보, 헤더 버튼에 이름 표시 없음, 후보 삭제·재생성 호출 없음
  - 새 그룹은 지금 보이는 목록의 체크한 후보로 만들어짐(그룹 보기 중에도), 원래 그룹 유지
  - 연필로 모달 없이 이름 수정(Enter 저장·Esc 취소, Esc가 메뉴를 닫지 않음)
  - 메뉴의 추가는 그 그룹에 없는 후보만 전송하고 후보 수를 바로 갱신
  - 체크 0개면 추가 비활성·빈 그룹 안내
  - 그룹 보기에서 빼기는 관계만 제거
  - API 경로·헤더·오류 문구 3개

  전체 **69 passed**, `eslint` 오류 0개(기존 `<img>` 경고 12개), `next build` 성공.

### 수동 확인 필요

`alembic upgrade head` 적용과 백엔드 재시작 후에 확인한다. 적용 전에는 새 그룹 API가 테이블이 없어 500이다.

1. 목록 위에 그룹 버튼 줄이 없는지 확인한다. 후보 2개만 체크 → 헤더 그룹 아이콘 → "새 그룹 만들기" → 이름 입력칸이 바로 열리고 Enter로 저장되는지, 그 그룹을 누르면 2개만 보이고 그룹 이름만 메인색 글자로 표시되는지, 후보 수가 맞는지 확인한다.
2. 그룹을 보는 중에 "새 그룹 만들기"로 새 그룹을 만들고, 새 그룹에서 카드 X로 하나 빼기 → 원래 그룹에는 남아 있는지, 보고 있는 그룹을 한 번 더 눌러 전체 후보로 돌아가면 후보가 그대로인지 확인한다.
3. 전체 후보에서 체크 → 그룹 줄 "추가" → 이미 있던 후보는 제외됐다는 안내가 나오고 후보 수가 바로 바뀌는지 확인한다. 체크를 모두 끄면 "추가"가 비활성인지 확인한다. 연필로 이름을 바꾸고 Enter로 저장, Esc로 취소되는지 확인한다.
4. 헤더에서 그룹 X로 삭제 → 전체 후보가 그대로인지 확인한다.
5. 그룹을 여러 번 오가도 후보의 체크·메모·임장 기록이 그대로인지 확인한다(후보 id 유지).
6. 그룹 보기에서 매물 추가 → 전체 후보와 그 그룹 양쪽에 보이는지 확인한다.
7. 다른 계정으로 로그인하면 내 그룹이 보이지 않는지 확인한다.

### 다음 Phase 전에 확인할 것

- [x] 공용 DB에 `16bbbf4cc3a5` 적용(2026-09-15, 사용자 승인).
- [ ] Phase 4 수동 확인. 사용자가 그룹 메뉴를 직접 써 보며 기능이 유지된다고 보고했으나, 위 7개 항목 전체의 확인 기록은 없다. 그룹 메뉴 후속 수정은 PR #16으로 main에 병합했다.
- [x] PR #13 머지(2026-09-15 15:09, 정정화님, `fdb6998`). `7ed9923`까지 main에 포함됐다.
- [x] PR #13 머지 후 `ff9db2ef90e4` 적용(옛 그룹 테이블 삭제). 공용 DB 현재 위치는 `ff9db2ef90e4`다.
- [x] 진수님 UI 수정 반영: PR #15(체크리스트·인사이트·실거래 분포도, `d016f36`)가 들어간 main에서 브랜치를 새로 만들었다. PR #15의 인사이트 화면 재작성으로 빠진 "늦은 AI 응답 덮어쓰기 방지"를 복구하고(`0cafb83`), 테스트를 새 문구에 맞췄다. "분석 시각" 표시 제거는 진수님 결정으로 유지한다(사용자 확인).
- [ ] 진수님께 공유할 것:
  - 스냅샷 그룹 백엔드를 제거했고, 화면의 그룹 선택이 "불러오기(목록 교체)"에서 "보기(목록 좁히기)"로 바뀌었다.
  - `dashboard_item_groups`의 기존 3행은 옮기지 않고 사용자 결정에 따라 테이블과 함께 삭제했다.
  - PR #15에서 `frontend/lib/api.js`에 추가된 `createInsight`는 어디에서도 쓰이지 않는다. 인사이트 화면은 Phase 2의 `createDashboardInsight`(계정 확인·선택 후보만 전송)를 쓴다.
- [x] 그룹 보기에서 차트·AI 분석이 보이는 후보 기준으로 동작한다. 백엔드 `/dashboard/insight`는 바꾸지 않았다. 사용자가 설명을 확인했고 변경 요청이 없어 유지한다(Phase 6에서는 확인 위주).
- [ ] 헤더 공유 버튼은 여전히 전체 후보 스냅샷이다. **사용자 결정(2026-09-15):** Phase 5에서 그룹이 있으면(그룹을 보고 있을 때) 그 그룹 단위로 공유하고, 그룹이 없으면(전체 후보를 보고 있을 때) 매물만 공유한다. 고정 제약의 "후보 공유 단위는 group"을 이렇게 보완한다. 세부 동작은 Phase 5 착수 시 확인한다.
- [x] 정렬 순서 컬럼(Phase 3 보완): 아래 "Phase 3 보완 변경 요약" 참고.
- [ ] 사용자의 Phase 5 착수 지시. **Phase 5는 시작하지 않았다.**

## Phase 3 보완 변경 요약 (정렬 순서 저장)

2026-09-15 사용자 지시로 착수했다. 기준은 [정렬 순서 저장·공유/공동참여 설계](ordering-and-sharing-design.md) 3장이며, 4장(공유/공동참여)은 구현하지 않았다. 작업 브랜치는 `feat/phase3-sort-order`로, 그룹 메뉴 후속 수정 브랜치 `feat/group-menu-quick-create` 위에 쌓여 있다.

**선행 조건 대조 (착수 시점)**

| 항목 | 확인 결과 |
|---|---|
| PR #13 병합 | main `fdb6998`에 `7ed9923`까지 포함 |
| 옛 그룹 테이블 삭제 | `ff9db2ef90e4` 공용 DB 적용 완료. 코드 head와 DB 위치 모두 `ff9db2ef90e4` |
| 이미 적용된 migration 파일 | main 대비 변경 없음 |
| Phase 4 수동 확인 | 사용자의 그룹 메뉴 사용 피드백은 있으나 체크리스트 전체 확인 기록 없음(Phase 4 참고) |

**설계 대비 현재 코드의 차이와 최소 변경**

1. 드래그 순서는 프론트 상태에만 있었고 서버 조회는 `created_at`순이었다. `sort_order` 컬럼과 `PATCH /api/v1/dashboard/items/order`를 추가했다.
2. 후보 등록·삭제에 계정 단위 잠금이 없었다. 설계대로 `profiles` 행 `FOR UPDATE` 잠금을 등록·삭제·순서 저장에 공통으로 적용했다.
3. 그룹 상세는 그룹에 넣은 순서였다. 내 전체 순서에서 그룹 후보만 남기는 순서로 바꿨다.
4. 공유 스냅샷 생성은 순서가 정해져 있지 않았다. 저장한 순서로 뜬다(이미 만든 스냅샷 JSON은 그대로).
5. SQLite 격리 테스트에는 `profiles` 테이블이 없었다(PostgreSQL 배열 컬럼). 테스트 픽스처에서만 이용 목적 컬럼을 JSON으로 바꾼 사본을 만든다. 운영 코드는 이 때문에 바꾸지 않았다.
6. 설계와 다른 점 하나: 공유받은 매물 가져오기는 여러 후보를 동시에 등록한다(PR #12의 속도 개선). 가져온 후보들은 모두 맨 뒤에 붙지만 그들끼리의 순서는 요청 도착 순서를 따른다. 순차 등록으로 바꾸지는 않았다.

**구현**

- **백엔드**
  - `dashboard_items.sort_order` INTEGER NOT NULL DEFAULT 0, CHECK `sort_order >= 0`, 인덱스 `(user_id, sort_order, id)`. 순번 교환 중 임시 충돌을 피하려고 `(user_id, sort_order)` UNIQUE는 두지 않았다.
  - 조회 순서 `sort_order, created_at, id`(`ITEM_ORDER`)를 후보 목록·대시보드 집계·그룹 상세·공유 스냅샷에 공통으로 쓴다.
  - 새 후보는 `max(sort_order)+1`(빈 목록이면 0). 삭제로 생긴 빈 번호는 두고, 다음 저장에서 0부터 다시 매긴다.
  - 후보 응답에 `sort_order`를 추가했다. 등록·details PATCH 입력으로는 바꿀 수 없다.
  - `PATCH /api/v1/dashboard/items/order` `{item_ids, expected_item_ids}` → `200 {item_ids}`.
    - 남의 id나 없는 id: 404
    - 내 후보 누락, 기준 순서 불일치: 409(아무것도 저장하지 않음)
    - 중복·문자열·불리언·0 이하·7개 이상·필드 누락: 422
    - 순번이 바뀐 행만 갱신하고 checked·상세·그룹 관계·임장 기록은 쓰지 않는다.
- **프론트**
  - 드래그 결과를 바로 보여주고, 로그인 상태면 전체 순서와 마지막으로 서버에서 확인한 순서를 함께 저장한다. 저장 중에는 드래그를 막는다.
  - 그룹 보기에서는 그룹 후보가 차지하던 자리만 바꾼 전체 순서를 저장한다(그룹 밖 후보 위치 유지).
  - 409나 실패면 서버 목록을 다시 불러오고 안내한다. 다시 불러오기도 실패하면 마지막으로 확인한 순서로만 되돌린다(체크·메모 등 최신 내용 유지). 같은 저장 요청은 재시도하지 않는다.
  - 응답 전에 계정이 바뀌면 결과를 무시한다. 요청 시점에 세션 계정이 다르면 보내지 않는다. 비로그인 드래그는 기존대로 화면에서만 바뀐다.

### 수정 파일

| 파일 | 변경 내용 |
|---|---|
| [backend/alembic/versions/20260915_1601_d755235ab9bc_add_dashboard_items_sort_order.py](../backend/alembic/versions/20260915_1601_d755235ab9bc_add_dashboard_items_sort_order.py) | 신규 마이그레이션(부모 `ff9db2ef90e4`) |
| [backend/app/dashboard/model.py](../backend/app/dashboard/model.py), [schema.py](../backend/app/dashboard/schema.py), [service.py](../backend/app/dashboard/service.py), [router.py](../backend/app/dashboard/router.py) | `sort_order` 컬럼·응답·조회 순서, 순서 저장 API, 계정 단위 잠금 |
| [backend/app/group/service.py](../backend/app/group/service.py) | 그룹 상세를 내 전체 순서로 |
| [frontend/lib/api.js](../frontend/lib/api.js) | `reorderDashboardItems` |
| [frontend/components/NaejipsaApp.jsx](../frontend/components/NaejipsaApp.jsx) | 순서 저장·충돌/실패 복구·계정 전환 무시 |
| [frontend/components/Workspace.jsx](../frontend/components/Workspace.jsx), [Dashboard.jsx](../frontend/components/Dashboard/Dashboard.jsx), [DashboardList.jsx](../frontend/components/Dashboard/DashboardList.jsx) | 저장 중 드래그 비활성 전달 |
| [backend/tests/test_dashboard_order.py](../backend/tests/test_dashboard_order.py), [frontend/tests/dashboard-order.test.jsx](../frontend/tests/dashboard-order.test.jsx), [frontend/tests/order-api.test.js](../frontend/tests/order-api.test.js) | 신규 테스트 |
| [backend/tests/test_dashboard_checked.py](../backend/tests/test_dashboard_checked.py), [test_groups.py](../backend/tests/test_groups.py), [test_inspection.py](../backend/tests/test_inspection.py), [test_alembic_chain.py](../backend/tests/test_alembic_chain.py) | SQLite `profiles` 사본, 적용된 `ff9db2ef90e4` 부모 고정 |

### DB migration

새 리비전 `d755235ab9bc`(부모 `ff9db2ef90e4`, head 1개)다. **2026-09-15 사용자 승인 후 공용 DB에 적용했고, 이어서 PR #17을 main에 병합했다.**

offline `--sql`에서 실행되는 문장은 다음뿐이다.

- `sort_order` 컬럼 추가
- 사용자별 등록순 backfill
- NOT NULL·DEFAULT 0 설정
- CHECK 제약 추가
- 인덱스 생성
- `alembic_version` 갱신

기존 테이블 삭제나 다른 컬럼 변경은 없다. downgrade는 정렬 정보만 지운다.

- **적용 결과(읽기 전용 확인):** 컬럼 `integer NOT NULL DEFAULT 0`, CHECK `sort_order >= 0`, 인덱스 `(user_id, sort_order, id)`가 생겼다. NULL 0건, 후보가 있는 계정 2곳 모두 등록순 0부터 번호가 매겨졌다. 행 수는 적용 전과 같다(후보 9, 그룹 3, 그룹 관계 10, 공유 14, 프로필 3, 임장 0). 모델과 DB 스키마 비교에서 차이가 없고, 실제 후보 목록 조회 코드가 새 컬럼으로 동작함을 확인했다.
- **적용 전 주의(기록):** 이 브랜치 코드는 `sort_order`를 조회한다. 적용 전의 공용 DB에 이 코드로 서버를 띄우면 후보 목록·등록 API가 실패한다. 로컬 서버가 이 브랜치 코드로 자동 재시작돼 있으면, 적용 승인 전까지 이전 브랜치로 되돌려 둔다.
- **적용 후 혼용:** 이 컬럼을 모르는 main 코드 서버로 등록한 후보는 기본값 0이라 목록 맨 앞에 온다. 적용과 이 브랜치의 병합을 가깝게 진행한다.

### 테스트

- **백엔드 신규 `tests/test_dashboard_order.py` 21개** (임시 SQLite, 외래키 검사 켬):
  - 저장한 순서가 다음 조회에 복원
  - 순서 저장 전후 id·checked·상세·등록 시각·그룹 관계·임장 기록 보존, 그룹 상세도 내 순서
  - 새 후보 맨 뒤·삭제 후 상대 순서 유지·빈 번호 재배정
  - 첫 후보 0번·빈 목록 저장
  - 남의/없는 id 404
  - 누락·낡은 기준 순서 409(미저장)
  - 같은 기준 순서로 저장한 두 번째 탭 409
  - 잘못된 입력 7종 422(미저장)
  - 계정별 분리
  - 공유 스냅샷 순서
  - 마이그레이션 backfill(사용자별 등록순, 같은 시각이면 id순)
- **백엔드 전체:** **297 passed**. 실DB 후보를 비우는 `auth` 픽스처를 쓰는 `test_insight.py`·`test_user_api.py`는 실행하지 않았다.
- **프론트 신규 6개:**
  - 드래그 즉시 반영·전체 순서와 기준 순서 저장·저장 중 드래그 비활성·다음 저장 기준 갱신
  - 409 시 서버 목록 재조회
  - 저장·재조회 모두 실패 시 이전 순서 복원과 최신 체크 상태 유지
  - 계정 전환 후 늦은 실패 무시
  - API 경로·본문·헤더
  - 409 status 전달과 계정 변경 시 미전송
- **프론트 전체:** **76 passed**, `eslint` 오류 0개(기존 `<img>` 경고 16개), `next build` 성공.
- **격리 테스트로 확인하지 못한 것:** 실제 PostgreSQL의 행 잠금 동작.

### 수동 확인 필요

`d755235ab9bc` 적용과 서버 재시작 후에 확인한다.

1. 전체 후보에서 드래그로 순서를 바꾼 뒤 새로고침, 로그아웃 → 재로그인에도 같은 순서인지 확인한다.
2. 그룹 보기에서 드래그 → 그룹을 다시 눌러 전체 후보로 돌아가면 그룹 밖 후보 위치가 그대로인지 확인한다. 같은 후보가 든 다른 그룹도 같은 상대 순서인지 확인한다.
3. 체크를 끈 후보도 순서에 포함되는지, 새 후보를 등록하면 맨 뒤에 붙는지, 후보 삭제 후 나머지 순서가 유지되는지 확인한다.
4. 탭 두 개를 열고 한쪽에서 순서를 바꾼 뒤 다른 탭에서 새로고침 없이 드래그 → "다른 곳에서 목록이 바뀌어 최신 순서로 다시 불러왔어요." 안내와 최신 순서가 보이는지 확인한다.
5. 순서를 바꿔도 체크·호가·메모·임장 기록·그룹 구성이 그대로인지 확인한다.
6. 다른 계정으로 로그인하면 그 계정의 순서가 따로 보이는지 확인한다.

### 다음 단계 전에 확인할 것

- [x] `d755235ab9bc` 공용 DB 적용(2026-09-15, 사용자 승인).
- [ ] 위 수동 확인.
- [x] PR #16(그룹 메뉴 후속) → DB 적용 → PR #17(정렬 순서) 순서로 main에 병합했다. 팀원은 main을 받은 뒤 서버를 재시작해야 순서 저장이 동작한다(이전 코드 서버로 등록한 후보는 순번 0으로 맨 앞에 온다).
- [ ] 공유/공동참여 설계(4장)는 **확정 요구가 아닌 제안**이다. 착수 전에 따로 검토·결정할 항목:
  - 그룹 공유 링크로 공개할 필드(상세 동·호·개인 메모·임장 제외안)
  - `allow_join` 기본값과 링크 수명(회수 전까지 유효안), 토큰 hash 저장
  - 공동 그룹 후보 총수(6개안)
  - 회원 제거·탈퇴 시 그 회원이 넣은 그룹 관계 제거 여부
  - 타인 후보가 섞인 그룹의 체크·드래그 제한과 AI 분석 범위(내 후보만)
  - 기존 스냅샷 공유(`?share=`)와 그룹 공유 링크의 진입 구분
- [ ] 사용자의 다음 Phase 착수 지시. **다음 Phase는 시작하지 않았다.**

## 닉네임·속도 개선 (2026-09-16)

사용자 요청으로 처리했다. 작업 브랜치는 `feat/nickname-and-speed`(main `81889b7`에서 분기)다. DB 변경은 없다.

**랜덤 닉네임**

- 처음 로그인하면 "반포사는호랑이"처럼 수식어 38개 중 하나와 동물 30개 중 하나를 붙인 닉네임으로 시작한다([backend/app/user/nickname.py](../backend/app/user/nickname.py)).
- 어색한 조합은 버리고 다시 뽑는다. 자연스러운 조합은 1,086개다.
  - 붙는 자리에서 같은 소리가 반복되는 조합(받침은 무시): "반포사는사자", "든든한하마"
  - 붙이면서 부적절한 표현이 생기는 조합
  - 4자 미만·10자 초과
- 소셜 로그인 제공자의 이름(실명일 수 있음)은 더 이상 닉네임 초기값으로 저장하지 않는다.
- 닉네임이 비어 있던 기존 계정은 다음 API 요청 때 한 번 채운다. `{"nickname": null}` 저장도 빈 값 대신 새 랜덤 닉네임을 준다. 온보딩 닉네임 칸에 "비워 두면 랜덤 닉네임이 만들어져요" 안내를 넣었다.

**느린 화면 측정과 조치**

| 느린 곳 | 측정 | 원인 | 조치 |
|---|---|---|---|
| AI 분석 | 16.8초, 가끔 503("요청이 많음") | 모델이 답을 쓰기 전에 오래 "생각"함(생각 토큰 2,165개) | `thinkingLevel: low` → 약 6초. 503·429면 1초 뒤 한 번만 다시 시도 |
| 모든 API 요청 | 새 연결마다 +0.22초 | Windows에서 `localhost`는 IPv6(::1)부터 시도하는데 개발 서버는 127.0.0.1에만 떠 있음 | 프론트 기본 주소와 `.env.example`을 `127.0.0.1`로. 각자 `.env.local`도 바꿔야 함 |
| 첫 화면 거시지표·랭킹·뉴스·청약 | 차트 2.6초 이내, 뉴스·청약 3~4초, 거시지표 다른 기간 미리받기 5~6.6초 | 외부 공공 API 자체가 느림(R-ONE/KOSIS 36개월 4.4초). 브라우저는 한 서버에 동시에 6개만 요청하는데 첫 화면 요청이 약 31개. 개발 서버가 코드 저장으로 재시작될 때마다 6시간 캐시가 비워짐 | 코드 변경 없음. 숨겨진 인사이트 탭의 뉴스·청약 지연 로딩, 캐시 유지 방식은 담당자(정정화님·진수님·B)와 협의할 후속 |
| 그룹 새로 만들기 | API 자체는 22~150ms | 첫 화면 요청이 몰린 동안 줄을 서서 기다림 | 첫 화면 요청이 줄면 함께 해소 |

그 밖에 DB 왕복 8ms, 인증 API 22~150ms, 랭킹 계산 0.1~0.4초로 병목이 아니었다.

### 수정 파일

| 파일 | 변경 내용 |
|---|---|
| [backend/app/user/nickname.py](../backend/app/user/nickname.py) | 신규. 단어 목록·어색한 조합 걸러내기 |
| [backend/app/core/deps.py](../backend/app/core/deps.py), [backend/app/user/router.py](../backend/app/user/router.py) | 새 프로필·빈 닉네임 계정·닉네임 비우기에 랜덤 닉네임 |
| [backend/app/insight/llm.py](../backend/app/insight/llm.py) | 생각 단계 낮춤, 일시 과부하 1회 재시도 |
| [frontend/lib/api.js](../frontend/lib/api.js), [insightApi.js](../frontend/lib/insightApi.js), [frontend/.env.example](../frontend/.env.example) | API 기본 주소 127.0.0.1 |
| [frontend/components/Modal/ProfileOnboardingModal.jsx](../frontend/components/Modal/ProfileOnboardingModal.jsx) | 닉네임 칸 안내 문구 |
| [backend/tests/test_nickname.py](../backend/tests/test_nickname.py), [test_insight_llm.py](../backend/tests/test_insight_llm.py) | 신규 테스트 |
| [backend/tests/test_profile_onboarding.py](../backend/tests/test_profile_onboarding.py), [test_user_api.py](../backend/tests/test_user_api.py) | 닉네임 기대값을 랜덤으로(실DB `test_user_api.py`는 수정만 하고 실행하지 않음) |

### 테스트

- 백엔드 신규: 닉네임 규칙 12개(생성 결과가 항상 자연스러운 조합, 어색한 조합 거부, 다양성, 대체 닉네임), LLM 호출 5개(생각 설정 전송, 503·429 한 번 재시도, 두 번 실패 시 중단, 다른 오류는 재시도 안 함). 프로필 2개(닉네임 비우기, 빈 닉네임 기존 계정 채우기).
- 백엔드 전체 격리 테스트 **316 passed**. 실DB 후보를 비우는 `auth` 픽스처를 쓰는 `test_insight.py`·`test_user_api.py`는 실행하지 않았다.
- 실제 Gemini 한 번 호출: 바뀐 설정으로 200 응답(짧은 질문 1.8초).
- 프론트 76개 통과, `eslint` 오류 0개(기존 `<img>` 경고 16개), `next build` 성공.

### 수동 확인 필요

1. 새 계정으로 로그인 → 마이페이지에 랜덤 닉네임이 보이는지, 닉네임을 지우고 저장하면 새 랜덤 닉네임이 되는지 확인한다.
2. 후보 6개로 AI 분석 → 이전(15초 이상)보다 짧은지, 분석 내용 품질이 떨어지지 않았는지 확인한다.
3. `frontend/.env.local`의 `NEXT_PUBLIC_API_BASE_URL`을 `http://127.0.0.1:8000/api/v1`로 바꾸고 새로고침한 뒤 첫 화면이 빨라졌는지 확인한다.

## Phase 5 변경 요약 (그룹 공유 링크, 읽기 전용)

2026-09-16 사용자 지시로 착수했다. 작업 브랜치는 `feat/phase5-group-share`로, `feat/nickname-and-speed` 위에 쌓여 있다.

**착수 전 사용자 결정**

| 항목 | 결정 |
|---|---|
| 그룹 링크로 공개할 정보 | 동·호수까지 공개. 메모·임장 기록·계정 정보는 비공개 |
| 공동 참여(join) | 구현 계획만 두고 보류 |
| 공동 그룹 후보 수, 탈퇴·추방 처리 | 공동 참여 보류로 이번 범위 아님 |
| 공유 단위(기존 결정) | 그룹을 보고 있으면 그룹 링크, 전체 후보면 기존 매물 스냅샷 |

**설계 문서 4장 대비 차이와 최소 변경**

1. 공개 필드: 설계 제안은 상세 동·호 제외였으나 사용자 결정으로 동·호수를 공개한다. 후보 id·메모·상태·체크·순서·등록 시각·계정 정보는 내보내지 않는다.
2. `allow_join`, `group_members`, `group_items.added_by_user_id`, join·회원 API는 만들지 않았다(보류). 나중에 `allow_join`을 추가할 때 기존 링크는 기본값 false로 채우면 된다.
3. 링크 목록 조회·링크별 회수 API 대신, 그룹 응답의 `share_link_count`와 그룹 단위 "공유 중지"로 줄였다. 화면에 필요한 것은 "공유 중인지"와 "끊기"뿐이다.
4. 공유 버튼을 누를 때마다 새 링크를 만든다. 원문은 hash로만 저장해 다시 보여줄 수 없기 때문이다. 그룹당 살아 있는 링크는 20개까지다.
5. 받는 사람 화면은 기존 스냅샷 공유와 같은 미리보기 모달을 쓴다. 설계의 "읽기 전용 대시보드(차트·임시 체크)"는 만들지 않았다. "내 목록에 추가"는 기존처럼 내 후보로 복사한다.
6. 기존 `dashboard_shares`와 `?share=` 링크는 그대로다.

**구현**

- **백엔드**
  - `group_share_links`: id, group_id(FK CASCADE), token_hash(UNIQUE), created_at, revoked_at. `group_id` 인덱스.
  - 토큰은 `secrets.token_urlsafe(24)`(32자)이고 DB에는 SHA-256만 저장한다.
  - `POST /api/v1/groups/{group_id}/share-links` → 201 `{id, token, created_at}`. 남의·없는 그룹 404, 상한 409.
  - `DELETE /api/v1/groups/{group_id}/share-links` → 200 `{revoked_count}`. 다시 보내면 0. 남의 그룹 404.
  - `GET /api/v1/shared/groups/{token}` → 로그인 불필요, `{name, items, count}`.
    - 없거나 중지된 토큰, 129자 이상: 404
    - `Cache-Control: no-store`
    - 그룹 주인의 후보 순서
    - 프로필 생성·DB 쓰기 없음
  - 그룹 목록·상세 응답에 `share_link_count`를 추가했다. 그룹을 지우면 링크도 지운다.
- **프론트**
  - 그룹을 보는 중 헤더 공유 → 그룹 링크를 만들고 `?groupShare=` 주소를 복사한다. 전체 후보면 기존 스냅샷이다. 후보가 없는 그룹은 안내만 한다.
  - 그룹 메뉴: 공유 중인 그룹 줄에만 메인색 공유 아이콘이 보인다. 누르면 공유 중지(마우스를 올리면 빨간색).
  - `?groupShare=` 링크 열기 → 로그인 없이 "공유받은 그룹" 미리보기(그룹 이름, 단지·동·호수·면적) → 닫기 / 내 목록에 추가. 주소에서 토큰을 지운다. 없거나 중지된 링크는 안내만 한다.
  - 기존 스냅샷 미리보기에도 동·호수가 함께 보인다(스냅샷 응답에 원래 있던 값).

### 수정 파일

| 파일 | 변경 내용 |
|---|---|
| [backend/alembic/versions/20260916_1030_3c9e1a7b52d4_create_group_share_links.py](../backend/alembic/versions/20260916_1030_3c9e1a7b52d4_create_group_share_links.py) | 신규 마이그레이션(부모 `d755235ab9bc`) |
| [backend/app/group/model.py](../backend/app/group/model.py), [schema.py](../backend/app/group/schema.py), [service.py](../backend/app/group/service.py), [router.py](../backend/app/group/router.py) | 링크 모델·공개 DTO·생성/중지/열람, 그룹 응답 링크 수, 그룹 삭제 시 링크 삭제 |
| [backend/app/main.py](../backend/app/main.py) | 공개 열람 라우터 등록 한 줄 |
| [frontend/lib/api.js](../frontend/lib/api.js) | `createGroupShareLink`, `revokeGroupShareLinks`, `getSharedGroup` |
| [frontend/components/NaejipsaApp.jsx](../frontend/components/NaejipsaApp.jsx) | 공유 버튼 분기, `?groupShare=` 미리보기, 공유 중지 |
| [frontend/components/Dashboard/GroupBar.jsx](../frontend/components/Dashboard/GroupBar.jsx), [Header.jsx](../frontend/components/Header.jsx), [globals.css](../frontend/app/globals.css) | 공유 중 아이콘·공유 버튼 툴팁 |
| [frontend/components/Modal/ImportShareModal.jsx](../frontend/components/Modal/ImportShareModal.jsx) | 그룹 이름·동·호수 표시, 빈 그룹이면 추가 버튼 비활성 |
| [backend/tests/test_group_shares.py](../backend/tests/test_group_shares.py), [frontend/tests/group-share.test.jsx](../frontend/tests/group-share.test.jsx) | 신규 테스트 |
| [backend/tests/test_groups.py](../backend/tests/test_groups.py), [test_dashboard_order.py](../backend/tests/test_dashboard_order.py), [test_alembic_chain.py](../backend/tests/test_alembic_chain.py), [frontend/tests/group-api.test.js](../frontend/tests/group-api.test.js), [dashboard-groups.test.jsx](../frontend/tests/dashboard-groups.test.jsx) | 픽스처 새 테이블, 적용된 `d755235ab9bc` 부모 고정, API·mock 추가 |

### DB migration

새 리비전 `3c9e1a7b52d4`(부모 `d755235ab9bc`, head 1개)다. **2026-09-16 사용자 승인 후 공용 DB에 적용했다.**

offline `--sql`에서 실행되는 문장은 다음뿐이다.

- `group_share_links` 테이블 생성(외래키 CASCADE·UNIQUE 포함)
- `group_id` 인덱스 생성
- `alembic_version` 갱신

기존 테이블 변경은 없다. downgrade는 링크 테이블만 지운다(이미 보낸 링크는 모두 끊긴다).

- **적용 결과(읽기 전용 확인):**
  - DB 위치: 적용 전 `d755235ab9bc` → 적용 후 `3c9e1a7b52d4`(head).
  - 새 테이블 0행. 컬럼·외래키(CASCADE)·UNIQUE·인덱스가 설계대로 생겼고, 모델과 DB 비교 차이는 0건이다.
  - 기존 행 수는 적용 전과 같다(프로필 4, 후보 10, 그룹 3, 그룹 관계 5, 스냅샷 공유 18, 임장 0).
  - 실제 PostgreSQL에서 그룹 목록 쿼리(후보 수·링크 수)가 계정별로 맞게 돌았다. 로컬 서버에서 없는 토큰 열람은 404, 비로그인 링크 생성은 401이다.
- **적용 전 주의(기록):** 이 브랜치 코드는 그룹 목록·상세·삭제에서 `group_share_links`를 읽어, 적용 전에는 그룹 메뉴가 실패한다. 그래서 승인 전까지 로컬 작업 트리를 `feat/nickname-and-speed`로 되돌려 두었고, 적용 후 이 브랜치로 옮겼다.
- **혼용:** 새 테이블만 추가했으므로 이 코드를 받지 않은 main 서버도 그대로 동작한다. PR은 `feat/nickname-and-speed` → `feat/phase5-group-share` 순서로 병합한다.

### 테스트

- **백엔드 신규 `tests/test_group_shares.py` 13개** (임시 SQLite, 외래키 검사 켬):
  - 로그인 없이 열람, 공개 필드만 나감(메모·계정 id 없음), `no-store`, 주인의 후보 순서
  - DB에는 hash만 저장, hash 값으로는 열리지 않음
  - 링크를 만든 뒤 후보 추가·빼기·이름·호가 변경·후보 삭제가 다음 열람에 반영
  - 공유 중지: 그 그룹 링크만 모두 끊김, 다시 보내면 0, 새로 공유한 링크만 열림
  - 그룹 목록·상세의 링크 수(후보 수가 부풀지 않음)
  - 남의 그룹 404, 비로그인 생성·중지 401
  - 그룹 삭제 시 링크 삭제·후보 유지
  - 없는·긴·공백 토큰 404
  - 그룹당 링크 상한 409, 중지 후 다시 생성
  - 열람 전후 프로필·후보·그룹 관계·링크가 그대로
  - 마이그레이션 컬럼·UNIQUE·인덱스·외래키가 모델과 같고 downgrade는 링크 테이블만 삭제
- **백엔드 전체:** **329 passed**. 실DB `auth` 픽스처를 쓰는 `test_insight.py`·`test_user_api.py`는 실행하지 않았다.
- **프론트 신규 9개:**
  - 그룹 보기에서 공유 → 그룹 링크 생성·`?groupShare=` 복사·공유 아이콘 표시
  - 전체 후보 공유는 기존 스냅샷
  - 빈 그룹은 링크를 만들지 않음
  - 공유 아이콘 → 그 그룹만 공유 중지
  - 비로그인 링크 열기 → 그룹 이름·동·호수 미리보기, 주소에서 토큰 제거, 저장 호출 없음
  - 없는·중지된 링크 안내
  - 로그인 상태에서 내 목록에 추가 → 동·호수까지 복사
  - API 경로·로그인 헤더, 열람은 헤더 없이 `no-store`·실패 status
- **프론트 전체:** **85 passed**, `eslint` 오류 0개(기존 `<img>` 경고 16개), `next build` 성공.
- **격리 테스트로 확인하지 못한 것:** 실제 PostgreSQL에서의 행 잠금. 링크 수 하위 쿼리는 DB 적용 후 실제 PostgreSQL에서 읽기 전용으로 확인했다.

### 수동 확인 필요

`3c9e1a7b52d4`는 공용 DB에 적용됐다. 이 브랜치 코드로 서버를 띄운 뒤 확인한다.

1. 그룹을 보는 중 공유 → 복사된 주소를 시크릿 창(비로그인)에서 연다. 그룹 이름·단지·동·호수가 보이고 메모는 보이지 않는지 확인한다.
2. 원래 창에서 그룹에 후보를 넣거나 빼고 호가를 고친 뒤, 시크릿 창에서 링크를 다시 열면 반영되는지 확인한다.
3. 그룹 메뉴의 공유 아이콘을 누른 뒤 링크를 다시 열면 "존재하지 않거나 공유가 중지된 그룹 링크예요."가 뜨는지 확인한다.
4. 전체 후보에서 공유한 기존 스냅샷 링크(`?share=`)가 그대로 동작하는지 확인한다.
5. 다른 계정 창에서 그룹 링크 → 내 목록에 추가 → 동·호수까지 복사되고, 주인의 그룹·후보는 그대로인지 확인한다.
6. 그룹을 삭제하면 그 그룹 링크가 열리지 않는지 확인한다.

### 공동 참여 구현 계획 (보류)

사용자 결정으로 구현하지 않았다. 재개할 때의 순서만 남긴다.

1. **먼저 정할 것**
   - 공동 그룹 후보 총수(설계 제안: 6개)
   - 참여자 제거·탈퇴 시 그 사람이 넣은 그룹 관계를 지울지
   - 남의 후보가 섞인 그룹의 체크·드래그·AI 분석 범위(설계 제안: 임시 체크, 드래그 없음, 내 후보만 분석)
   - CTA 문구 위치: “함께 비교하고 의견을 남기고 싶다면 회원가입하고 공동 참여해보세요.”
2. **DB(별도 migration)**
   - `group_share_links.allow_join` BOOLEAN NOT NULL DEFAULT false
   - `group_members`(group_id, user_id 복합 PK, role 'editor', joined_at, CASCADE)
   - `group_items.added_by_user_id`(기존 행은 `dashboard_items.user_id`로 채움)
3. **API**
   - `POST /shared/groups/{token}/join`(로그인 + `allow_join`)
   - 회원 목록·제거·탈퇴
   - 그룹 목록에 참여 그룹·내 역할·소유 그룹 수
   - 권한은 설계 4.3 표를 따른다. 원본 후보 수정은 원본 주인만 한다.
4. **프론트**
   - 공유할 때 "참여 허용" 선택
   - 남의 후보 카드의 편집·삭제 숨김
   - 그룹 목록에 참여 그룹 표시

### 다음 단계 전에 확인할 것

- [x] `3c9e1a7b52d4` 공용 DB 적용(2026-09-16, 사용자 승인).
- [ ] 위 수동 확인.
- [x] 두 브랜치(`feat/nickname-and-speed`, `feat/phase5-group-share`)를 원격에 push.
- [ ] PR 병합: `feat/nickname-and-speed` → `feat/phase5-group-share` 순서.
- [ ] 공동 참여 착수 여부와 위 결정 항목.
- [ ] 사용자의 다음 Phase 착수 지시. **Phase 6(그룹 AI)은 시작하지 않았다.**

## 임장 체크리스트 저장 확인 (2026-09-16)

사용자 요청으로 코드와 공용 DB를 읽기만 해서 확인했다. 코드는 바꾸지 않았다. 임장 체크리스트를 따로 공유하는 기능은 사용자 결정으로 만들지 않는다.

| 구분 | 현재 상태 |
|---|---|
| DB | `property_inspections`에 후보별로 18개 항목 점수(항목마다 컬럼, 1~3 / 유해시설 0~1), 종합 평점(1~5, 필수), 메모를 저장하는 구조가 있다. 저장할 때마다 새 기록이 쌓인다. 공용 DB에 적용돼 있고 확인 시점 0행 |
| 백엔드 API | `POST /api/v1/properties/{id}/inspection`으로 저장한다(내 후보만, 격리 테스트 있음). **저장한 기록을 다시 읽는 API는 없다** |
| 웹 체크리스트 화면 | 매물 수정 창의 "체크리스트 작성"(진수님 `b3b14aa`). 항목 키 18개와 점수 규칙은 DB와 같다. **서버로 보내지 않고 화면 메모리에만 둔다.** 새로고침·재로그인하면 사라진다 |

**결론:** 점수별로 저장할 DB와 저장 API는 준비돼 있지만(PR #11 `b6c4b11`), 웹 체크리스트와 연결되지 않아 실제로는 저장되지 않는다.

**사용자 결정(2026-09-16):** 연결 방식은 담당자(체크리스트 화면·임장 백엔드)가 정한다. 현황·API 계약·선택지·주의점을 [임장 체크리스트 저장 연결 명세](inspection-checklist-handover.md)로 정리해 전달한다. 코드는 바꾸지 않았다.

연결하려면 정할 것(선택지와 영향은 명세 5장):

1. 종합 평점(1~5): DB·API는 필수인데 웹 체크리스트에 입력칸이 없다. 화면에 추가할지, 백엔드에서 선택값으로 바꿀지.
2. 다시 열었을 때 이어서 보기: 가장 최근 기록을 읽는 API가 필요하다.
3. 저장 방식: 저장할 때마다 새 기록(방문 이력)으로 둘지, 후보당 기록 하나를 고칠지.
4. 임장 기록이 생긴 후보는 삭제가 막히고(409) 제외 상태로만 숨길 수 있다. 화면 안내가 필요하다.
5. 웹에는 후보 상태(제외)를 바꾸는 화면이 없고, 삭제 실패 시 서버 안내(409) 대신 일반 실패 문구만 보인다.
6. 체크리스트 캐시가 화면용 id 기준이라, 목록을 다시 불러오면 다른 매물에 붙을 수 있다. 연결할 때 서버 id 기준으로 둔다.
