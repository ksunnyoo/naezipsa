# 정렬 순서 저장 · 공유/공동참여 설계

작성일: 2026-09-15  
검토 기준: `fix/phase1-auth`, `7ed9923`  
상태: **설계 제안 완료. 구현·migration 파일 작성·DB 적용·테스트 실행은 하지 않음.**

이 문서는 정렬 저장(Phase 3 보완)과 공유/공동참여(Phase 5)를 각각 착수할 때 사용할 계약이다. 두 범위를 한 번에 구현하는 지시가 아니다. 사용자 확정 사항은 유지하며, 아래의 구체적인 컬럼명·API 계약·권한 운영 방식은 구현 검토용 제안이다.

## 1. 현재 구현과 설계의 차이

1. `checked`는 서버에 저장되지만 드래그 순서는 프론트 상태에만 있다.
2. 전체 후보 조회는 `created_at`순이며, 그룹 드래그는 전체 목록에서 보이는 후보의 자리만 바꾼다.
3. 그룹은 이미 `groups`·`group_items` 관계로 구현되어 원본 후보 ID를 유지한다.
4. 현재 그룹 API는 owner 전용이고 `group_items`에는 추가자 컬럼이 없다.
5. 현재 그룹 상세와 프론트는 내 후보 목록만 이용하므로, membership 검사만 추가하면 타인의 후보는 누락된다.
6. 현재 공유는 `dashboard_shares`에 전체 후보를 저장하는 스냅샷이며 로그인 없이 조회할 수 있다.
7. 기존 공유받기에는 로그인 후 내 후보로 복사하는 동작과 게스트 로컬 추가가 있다. 이는 공동 그룹 참여와 다른 동작이다.
8. 새로운 그룹 공유에는 제한된 공개 응답, 참여·권한 검사, 링크 회수, 회원 제거가 필요하다.

확인한 코드: [후보 router](../backend/app/dashboard/router.py), [후보 service](../backend/app/dashboard/service.py), [그룹 model](../backend/app/group/model.py), [그룹 service](../backend/app/group/service.py), [앱 상태·공유·드래그](../frontend/components/NaejipsaApp.jsx), [공유 미리보기](../frontend/components/Modal/ImportShareModal.jsx).

## 2. 유지할 결정과 범위

| 항목 | 유지할 내용 |
|---|---|
| 후보 원본 | `dashboard_items`와 기존 CRUD 유지. 그룹 조작으로 후보를 삭제·재생성하지 않음 |
| 비교 선택 | `checked` 유지. `on_compare` 신설 금지 |
| 그룹 | 중첩 없음. 새 그룹은 copy이며 source 관계 자동 제거 없음 |
| 공유 단위 | 그룹을 보는 중이면 해당 그룹 전체. 전체 후보 화면이면 기존 매물 스냅샷 공유. 2026-09-15 사용자 결정에 따른 구분 |
| 공유 선택 UI | 공유 직전 후보 선택 단계를 추가하지 않음. 체크 해제한 후보도 그룹 공유에서는 포함 |
| 원본 쓰기 | 인증된 원본 item owner만 가능. 그룹 owner/editor라는 이유로 타인 원본을 수정하지 않음 |
| 인증·오류·금액 | Supabase session/auth header, `{error:{code,message,details}}`, 기존 원 단위 유지 |
| AI | `/dashboard/insight`와 response schema·내 후보 검사 유지 |
| 임장 | 현재 모델/CRUD는 존재하지만 공유 대상에 포함하지 않음. 임장 공유는 Phase 7에서 별도 검토 |

## 3. 정렬 순서 저장 — Phase 3 보완

### 3.1 사용자 동작

- 내 전체 후보의 순서를 계정별로 저장한다. 새로고침·재로그인 후 같은 순서로 복원한다.
- 체크 여부와 정렬은 독립이다. 체크를 끈 후보도 순서 목록에 포함한다.
- 새 후보와 스냅샷에서 복사한 후보는 내 목록 맨 뒤에 추가한다.
- 그룹 보기에서는 현재 동작처럼 그룹 후보가 차지하던 자리만 바꾼다. 그룹별 별도 순서 테이블은 만들지 않는다.

예시:

```text
내 전체 순서       [A, B, C, D, E]
그룹에 속한 후보   [B, D]
그룹에서 D → B     [D, B]
저장할 전체 순서   [A, D, C, B, E]
```

여기서 A~E는 `dashboard_items.id`다. React 카드의 `item-1` 같은 로컬 ID나 `size_id`를 저장에 사용하지 않는다.

### 3.2 DB와 조회

| 대상 | 제안 |
|---|---|
| `dashboard_items.sort_order` | INTEGER, NOT NULL, 0 이상, 서버가 관리 |
| 기존 행 초기값 | 사용자별 `created_at ASC, id ASC`에 `row_number - 1`을 부여 |
| 새 후보 | 같은 사용자의 `max(sort_order) + 1`, 빈 목록은 0 |
| 조회 | `sort_order ASC, created_at ASC, id ASC`로 결정적인 순서 보장 |
| 인덱스 | `(user_id, sort_order, id)` 비고유 인덱스 |
| 기존 컬럼 | `checked`, 호가·동·호·향·수리·메모·status·created_at 및 ID 보존 |

후보 삭제 후 빈 순번은 허용한다. 다음 정렬 저장 시 0부터 다시 배정한다. 순번 자체에는 사용자 의미가 없으므로 `(user_id, sort_order)` UNIQUE 제약은 두지 않는다. 순번 교환 중 임시 충돌 없이 한 트랜잭션에서 전체 순서를 갱신한다.

`sort_order`는 기존 `DashboardItemResponse` 및 이를 상속하는 목록/집계 응답에 추가한다. 등록·details PATCH 입력에는 넣지 않아 개별 요청으로 임의의 순번을 쓰지 못하게 한다. 프론트는 서버 배열 순서를 그대로 복원한다. 원본 수정 시각 `updated_at`은 기존 모델 정책을 따르며 정렬 동시성 토큰으로 사용하지 않는다.

`GET /dashboard/items`, `GET /dashboard`, 스냅샷 생성에 같은 정렬을 적용한다. 정렬 구현 시점의 owner 전용 그룹 상세도 내 전체 후보 순서를 필터링한 결과와 맞춰 `item_ids`와 `items`를 반환한다. 기존 스냅샷의 JSON 배열 순서는 바꾸지 않는다.

### 3.3 API 계약 제안

기존 후보 router 아래 정렬 전용 **`PATCH /api/v1/dashboard/items/order`**를 추가한다. 기존 CRUD를 대체하지 않으며 정적 경로를 `/{item_id}` 경로보다 앞에 선언한다.

요청 예시:

```json
{
  "item_ids": [11, 14, 13, 12, 15],
  "expected_item_ids": [11, 12, 13, 14, 15]
}
```

- `item_ids`: 저장할 내 전체 후보의 순서.
- `expected_item_ids`: 드래그를 시작하기 전 마지막으로 서버에서 확인한 내 전체 순서.
- 두 배열은 필수, 중복 없는 양의 정수, 현재 개인 후보 상한 6개 이내다. 비어 있는 내 목록에 한해 두 배열 `[]`도 허용한다.
- 응답은 `200 {"item_ids": [11,14,13,12,15]}`. 후보 상세를 다시 덮어쓸 필요가 없도록 순서만 돌려준다.
- body에 사용자 ID, group ID, `checked`, 다른 detail 필드는 받지 않는다.

| 조건 | 결과 |
|---|---|
| 인증 없음/유효하지 않은 토큰 | 기존 401 |
| 중복 ID·잘못된 타입·상한 초과 | 기존 형식의 422 |
| 없는 ID/타인의 ID 포함 | 기존 방식의 404, 소유자 정보 노출 없음 |
| 내 후보 일부 누락 또는 다른 탭의 변경으로 기준 순서 불일치 | 409 `CONFLICT`, 재조회 안내, 전체 rollback |
| 전체 ID 집합·기준 순서 일치 | 전체 순서 원자적 저장 |

### 3.4 동시성 및 프론트 실패 처리

1. 인증된 사용자의 `profiles` 행을 `FOR UPDATE`로 잠근다. 같은 사용자의 **후보 등록·삭제·정렬 저장**이 이 잠금 순서를 공통으로 사용한다. 빈 목록에서 동시에 등록해도 순번과 6개 상한을 확인할 수 있어야 한다.
2. 현재 내 후보를 정렬해 읽고 요청의 ID 소유권·전체 집합·`expected_item_ids`를 검사한다.
3. 일치할 때만 `sort_order`를 갱신하고 commit한다. 그룹 테이블·임장 테이블은 쓰지 않는다.
4. 서로 다른 탭이 같은 기준으로 정렬하면 첫 요청만 성공하고 두 번째는 409다. 등록/삭제가 먼저 반영돼도 조용히 후보를 누락시키지 않는다.

프론트는 드래그 직후 순서를 표시하되, 저장 중에는 다음 드래그를 막아 요청을 직렬화한다. 실패나 409는 서버 목록을 재조회한다. 재조회까지 실패하면 이전에 확인한 ID 순서로 복원하고 저장 실패를 안내한다. 후보 객체 전체를 과거 스냅샷으로 덮어써서 최신 checked·메모가 되돌아가지 않도록 한다.

계정 변경/로그아웃 후 도착한 응답은 무시한다. 네트워크 실패는 commit 여부가 불명확할 수 있으므로 POST/등록 같은 부수 효과를 재실행하지 않고 정렬 결과부터 재조회한다. 비로그인 사용자의 기존 로컬 드래그는 유지하되 보호 API는 호출하지 않는다.

### 3.5 migration 및 수정 예상 파일

이미 DB에 적용된 `258caef7f856` checked migration을 고치지 않고 **새 revision**으로 추가한다. 과거 문서의 ‘checked와 같은 migration’ 계획은 현재 이미 적용된 이력 때문에 후속 revision으로 처리해야 한다.

- 배포 순서: PR #13 및 선행 migration 상태 확인 → 기존 옛 그룹 삭제 계획 처리 → 현재 단일 head 다음에 정렬 revision 작성·검토 → 지정 revision 적용 → 새 서버/프론트 배포.
- 설계 시점 코드 head revision은 `ff9db2ef90e4`, 기록상 공용 DB는 `16bbbf4cc3a5`다. 구현 시 다시 확인하고 부모 hash를 추측하지 않는다.
- migration은 컬럼 추가 → 기존 순서 backfill → NOT NULL/CHECK/인덱스 순서로 검토한다. 이전 앱 쓰기와의 호환을 위한 DB 기본값은 0으로 두되, 구버전 서버가 계속 후보를 등록하면 맨 뒤 배치가 보장되지 않으므로 서버 교체를 함께 진행한다.
- 이전 서버와 혼용 중에는 정렬 저장을 활성화하지 않는다. 기존 migration의 부모 변경·stamp·후보 삭제로 체인을 맞추지 않는다.
- downgrade는 정렬 정보만 제거하며 후보와 관계는 보존한다.

수정 예상: `backend/app/dashboard/{model,schema,service,router}.py`, 새 Alembic revision, `backend/app/group/service.py`, `frontend/lib/{api,dashboardItems}.js`, `NaejipsaApp.jsx`, 드래그 비활성 상태를 전달하는 Dashboard/Workspace 컴포넌트, 정렬 회귀 테스트.

### 3.6 정렬 완료 기준

- 전체 드래그 → 새로고침·로그아웃/재로그인 후 같은 순서.
- 위 B/D 예시처럼 그룹 밖 후보 위치 유지. 같은 후보가 속한 다른 그룹에도 같은 개인 순서 반영.
- 체크를 끈 후보 포함, 새 후보·공유 복사 후보 뒤에 추가, 삭제 후 남은 상대 순서 유지.
- 순서만 바꿔도 ID·checked·detail·임장·그룹 관계 보존.
- 다른 계정 ID·중복·누락·잘못된 타입 거부, 실패 시 부분 저장 없음.
- 두 탭 재정렬·동시 등록·삭제·빈 목록 등록, 응답 지연·계정 전환 검증.
- 실제 DB와 외부 API를 사용하지 않는 격리 테스트와 frontend lint/build 후 사용자 계정 수동 확인.

## 4. 공유/공동참여 — Phase 5

### 4.1 공유 흐름

| 진입 화면 | 공유 대상·방식 | 받는 사람의 동작 |
|---|---|---|
| 전체 후보 | 내 전체 후보를 기존 `dashboard_shares` JSON에 저장. 현재 `POST/GET /dashboard/shares`와 `?share=` 유지 | 기존 스냅샷 미리보기/복사. 공동 그룹 가입 아님 |
| 그룹 보기 | 해당 그룹 전체 관계를 조회하는 링크. 이후 그룹 추가·제거·허용된 원본 정보 변경이 다음 조회에 반영 | 공개 읽기 또는 로그인 후 명시적 공동 참여 |

공유 직전에 후보 선택 UI를 만들지 않는다. 기존 카드의 체크는 비교 대상일 뿐, 그룹 공개 범위를 줄이지 않는다. 그룹 링크 생성/회수와 `allow_join` 설정은 owner만 한다. 기본 `allow_join=false`; owner가 공동 참여를 허용한 링크만 true로 생성한다.

그룹 링크는 `?groupShare=<token>` 등 기존 `?share=`와 구분되는 진입점으로 처리한다. 링크 열기만으로 후보를 복사하거나 membership을 생성하지 않는다. 로그인 후 원래 링크 미리보기로 복귀하며 ‘공동 참여’ 클릭으로 join한다. OAuth의 기존 `redirectTo=origin` 때문에 링크 맥락은 현재 탭의 임시 저장소에 보존하고 완료/취소 시 지운다. 토큰 전체를 로그나 분석 이벤트에 남기지 않는다.

CTA는 지정 문구를 사용한다.

> 함께 비교하고 의견을 남기고 싶다면 회원가입하고 공동 참여해보세요.

별도의 댓글/의견 DB·API는 이번 요구에 정의되어 있지 않아 이 설계에서 신설하지 않는다. 임장 메모를 공동 댓글로 재사용하지 않는다.

### 4.2 DB 제안

| 테이블 | 컬럼·제약 |
|---|---|
| `groups` | 기존 구조 유지. owner의 기준은 `owner_user_id` 한 곳 |
| `group_items` | 기존 복합 PK 유지, `added_by_user_id UUID NOT NULL` 추가. 서버의 인증 사용자만 기록 |
| `group_members` | `(group_id, user_id)` 복합 PK, `role='editor'` CHECK, `joined_at`. group/profile 삭제 시 관계 CASCADE |
| `group_share_links` | `id`, `group_id`, `token_hash` UNIQUE, `allow_join` 기본 false, `created_at`, nullable `revoked_at`. group 삭제 시 CASCADE |

- owner는 membership 행을 중복 생성하지 않는다. 공개 viewer도 행을 만들지 않는다. 첫 버전은 editor만 join하며 role을 클라이언트가 지정할 수 없다.
- 기존 `group_items.added_by_user_id`는 실제 `dashboard_items.user_id`로 backfill한다. 원본 누락 여부를 먼저 점검한다. FK는 profiles를 참조하고 계정 삭제 시 관계 CASCADE로 정리한다.
- 새 토큰은 충분히 긴 난수로 만들고 DB에는 SHA-256 hash만 저장한다. 원문은 생성 응답 때 한 번 반환하며 생성 당시 복사/표시한다. 링크 목록은 metadata만 반환한다. 재복사가 필요하면 새 링크를 생성한다.
- 초기 버전의 링크는 명시적으로 회수할 때까지 유효하다. 자동 만료·비밀번호·추가 역할은 후속 범위로 둔다.
- 기존 `dashboard_shares`와 이미 발급한 스냅샷 링크는 보존한다. 스냅샷에 원본 ID가 없으므로 그룹이나 회원으로 자동 이관하지 않는다.

### 4.3 권한 계약

그룹 role과 원본 소유권은 각각 검사한다. **그룹 owner도 타인이 추가한 original item을 수정·삭제할 수 없다.**

| 동작 | 유효한 링크의 public viewer | owner | editor |
|---|---|---|---|
| 공개 그룹 내용 읽기 | 가능 | 가능 | 가능 |
| 인증된 그룹 상세 조회 | 불가 | 가능 | 가능 |
| 자신의 후보를 그룹에 추가 | 불가 | 가능 | 가능 |
| 그룹 item 관계 제거 | 불가 | 가능 | 가능: 다른 참여자가 추가한 관계도 포함 |
| 원본 후보 PATCH/DELETE/checked/순서 저장 | 불가 | 본인 소유만 | 본인 소유만 |
| 그룹 이름 변경·삭제 | 불가 | 가능 | 불가 |
| 공유 링크 생성·조회·회수 | 불가 | 가능 | 불가 |
| editor 제거 | 불가 | 가능 | 본인 탈퇴만 |
| owner 변경 | 불가 | 이번 범위에서 제공하지 않음 | 불가 |

editor의 관계 제거 범위는 사용자의 기존 ‘group item 관계 제거 가능’ 지시를 따른다. 이를 임의로 자기 추가분만 가능하도록 좁히지 않는다. 관계 제거는 원본 삭제 endpoint로 구현하지 않는다.

개인 후보 상한 6개, owner가 생성하는 그룹 상한 8개는 유지한다. **공동 그룹 후보 총수도 우선 6개로 제한하는 안**을 제안한다. 여러 사용자가 추가할 때는 그룹 행 잠금 후 합계를 검사한다. 원본 후보 6개 제한만으로 공동 그룹의 크기가 제한된다고 가정하지 않는다. 참여자는 각자 최대 6개를 모두 넣을 수 있다는 의미가 아니다.

참여한 그룹은 ‘내 그룹’ 목록에 함께 표시한다. 기존 `count`는 전체 표시 개수로 유지하고 `owned_count`를 추가하여 생성 상한 `max_count=8`은 내가 소유한 그룹에만 적용한다. 프론트가 단순히 `groups.length`로 생성 가능 여부를 판단하지 않도록 고친다. 참여자 수에 대한 임의의 제품 상한은 이번에 추가하지 않는다.

### 4.4 API 제안

| Method / 경로 (`/api/v1` 아래) | 인증·검사 | 결과 |
|---|---|---|
| `GET /groups` | 로그인, owner 또는 member | 소유/참여 그룹 목록·내 role·개수 |
| 기존 `GET /groups/{group_id}` | owner 또는 member | 그룹 후보 전체, `my_role`, 항목별 원본 조작 가능 여부 |
| 기존 `POST /groups/{group_id}/items` | owner/editor + 추가할 모든 원본의 owner 일치 | 관계만 추가, 추가자는 서버 기록 |
| 기존 `DELETE /groups/{group_id}/items/{item_id}` | owner/editor + 해당 group 관계 존재 | 관계만 제거 |
| `POST /groups/{group_id}/share-links` | owner | 201 `{id, token, allow_join, created_at}`; body는 `{allow_join:false}` 기본 |
| `GET /groups/{group_id}/share-links` | owner | 원문 토큰 없는 활성/회수 링크 metadata |
| `GET /groups/{group_id}/members` | owner | 제거할 editor 목록. 관리용 user_id·닉네임(있을 때)·role·joined_at만, 이메일 제외 |
| `DELETE /groups/{group_id}/share-links/{share_id}` | owner + group/share 일치 | 해당 링크 회수. 반복 요청은 같은 결과 |
| `GET /shared/groups/{token}` | 인증 불필요, 유효한 링크 | 제한된 공개 그룹 DTO와 `allow_join` |
| `POST /shared/groups/{token}/join` | 로그인 + 유효한 링크 + `allow_join=true` | 200 `{group_id, role}`. 중복 join도 동일한 회원 결과 |
| `DELETE /groups/{group_id}/members/{user_id}` | owner가 editor 제거, 또는 editor의 본인 탈퇴 | member와 그 회원의 기여 관계 제거, 원본 보존 |

기존 그룹 생성·이름 수정·삭제와 후보 CRUD 경로는 유지한다. 새 그룹 생성은 여전히 optional `item_ids`를 받는 기존 POST 하나이며, 타인 원본 ID로 새 그룹을 만드는 권한은 추가하지 않는다. 공동 그룹의 ‘새 그룹 만들기’는 선택한 모든 후보가 본인 원본일 때만 활성화한다. 타인 후보가 선택되어 있으면 이유를 안내하며, 조용히 제외한 일부 후보로 그룹을 생성하지 않는다. 체크가 0개인 빈 그룹 생성은 기존 동작을 유지한다.

**join / 회수 동시성:** join과 링크 회수는 같은 그룹 행 → 링크 행 순으로 잠근 뒤 상태를 다시 확인한다. 인증·링크 유효성·allow_join을 검증하고 membership을 원자적으로 생성한다. 검증을 통과한 caller가 이미 owner이면 `{group_id, role:"owner"}`만 반환하며 editor 행을 만들지 않는다. 중복 요청은 복합 PK로 최종 방어한다. 그룹 item 추가/제거와 회원 제거/탈퇴도 동일하게 그룹 잠금을 먼저 획득한다. 잠금 후 현재 membership을 재확인하고, 회원 제거 시 member와 기여 관계를 같은 트랜잭션에서 삭제하여 추방된 editor의 지연 요청을 거부한다.

| 실패 | 기존 오류 계약 |
|---|---|
| 비로그인 write | 401 `UNAUTHORIZED` |
| 없는 그룹/외부인 그룹 접근/무효·회수 token/잘못된 group-share 조합 | 404 `NOT_FOUND` |
| 유효한 그룹의 editor가 owner 전용 동작 / allow_join=false에서 join | 403 `FORBIDDEN` |
| 중복 관계 추가·후보 수 초과 | 409 `CONFLICT`, 부분 추가 없음 |
| 잘못된 입력 | 422 `VALIDATION_ERROR` |

### 4.5 조회와 공개 필드

공동 그룹 조회는 다음 순서로 처리한다.

1. 일반 그룹 endpoint는 owner/membership, public endpoint는 유효한 token을 검증한다.
2. **검증한 그 group_id의 `group_items`를 출발점으로** 원본 후보와 단지·지표를 JOIN한다.
3. 허용된 DTO만 조립해 반환한다. 임의의 item ID 배열을 넘겨 소유권 없는 조회를 하는 범용 함수를 만들지 않는다.

기존 `get_items_with_metrics(db, user_id)`와 `_get_owned_item()`의 조건은 그대로 유지한다. 그룹용 조회가 필요하다는 이유로 내 후보 API나 AI 조회의 `user_id` 필터를 제거하지 않는다. 조인·금액 변환은 기존 패턴을 재사용한다.

| 공개/타인에게 보여줄 필드 제안 | 기본적으로 제외할 필드 |
|---|---|
| 후보 id, size_id, 단지명, 법정동, 면적·평형, 준공연도, 호가, 층, 향, 인테리어, 시세 지표, 규제 정보 | 계정 이메일/사용자 UUID, 개인 메모, 임장 기록, 원본 checked, 개인 정렬, 개인 status, 상세 동·호 |

이 공개 필드 선택은 이번 설계 제안이다. 기존 전체 후보 스냅샷은 이미 동·호를 포함하므로 즉시 응답을 축소하지 않는다. 새 그룹 공개 DTO와 기존 Snapshot DTO를 구분하고, 기존 링크의 노출 정책을 바꿀지는 별도 결정한다.

인증된 그룹 상세는 공개용 후보 정보에 `can_edit_original`, `can_delete_original`, `can_toggle_checked` 같은 서버 계산 권한을 붙인다. 본인 원본의 편집창은 기존 owner 전용 상세 API로 개인 필드까지 읽은 후 연다. 제한된 공유 DTO의 빠진 동·호·메모를 빈 값으로 편집 폼에 넣어 원본을 지우지 않도록 한다. 응답 권한 flag는 UI용이며 서버의 소유권 검증을 대체하지 않는다.

### 4.6 링크 회수·탈퇴·원본 삭제

- 링크 회수는 해당 token의 공개 조회와 신규 join을 막는다. 이미 성립한 membership은 자동 제거하지 않는다.
- editor 제거/본인 탈퇴는 해당 member 행과 그 사용자가 추가한 그룹 관계를 제거한다. 원본 후보·다른 그룹의 관계는 유지한다. 다른 회원이 보는 화면은 다음 조회 때 반영한다.
- 회원 제거는 영구 차단과 다르다. 그 사람이 여전히 `allow_join=true`인 링크를 갖고 있으면 재가입할 수 있다. 접근을 종료하려면 owner가 해당 참여 링크를 회수하고 필요하면 새 링크를 발급한다. 별도 차단 명단은 후속 범위다.
- 공개 읽기 링크를 알고 있는 사람의 익명 접근까지 회원 제거만으로 막을 수는 없다. 공개 접근도 끝내려면 관련 링크를 회수한다.
- owner는 탈퇴 API로 소유권을 비워둘 수 없다. owner 변경 없이 끝내려면 기존 그룹 삭제를 사용한다.
- 원본 owner가 후보를 삭제하면 기존 FK CASCADE로 모든 그룹 관계가 사라진다. 임장 때문에 원본 삭제가 거부되면 관계도 남는다. 권한·검증을 우회하는 강제 삭제는 추가하지 않는다.
- 그룹 삭제는 member/link/item 관계를 제거하지만 다른 사용자의 원본을 삭제하지 않는다. 기존 스냅샷 링크는 독립된 복사본이라 별도 보존된다.
- 실시간 구독은 필수 범위가 아니다. 그룹 진입·재진입·창 focus 복귀·관계 변경 후 재조회한다. 권한 철회 뒤 다음 API 요청은 즉시 거부하며 공개 응답의 HTTP 캐시도 `no-store`로 처리한다.

### 4.7 프론트 · checked · 정렬 · AI 연결

- 내 원본 목록 `dashboardItems`와 조회한 공동 그룹의 `items`를 구분한다. 현재처럼 내 배열을 group item ID로 필터링하는 방식만으로는 타인의 후보가 나오지 않는다.
- 카드 X는 그룹 관계 제거로 연결한다. 본인 원본 편집만 기존 편집창을 열며, 타인 원본에 대한 편집/원본 삭제는 노출하지 않는다.
- 그룹 참여로 후보를 내 목록에 복사하지 않는다. 스냅샷 `handleImportShare`를 join 처리에 재사용하지 않는다.
- 공개 링크 미리보기는 로그인 여부와 관계없이 읽기 전용이며 비교 선택만 임시 `checked`로 관리한다. 일반 인증 그룹 화면에서는 현재 관람자가 표시된 모든 원본을 소유할 때 기존 개인 체크·정렬 저장을 유지한다. 타인 원본이 하나라도 있으면 관람자별 임시 `checked`만 사용하고 원본 PATCH를 호출하지 않는다. 타인 한 명의 후보만 있는 그룹도 이 제한에 포함한다. `on_compare` 컬럼/API를 만들지 않는다.
- 공동 그룹의 기본 비교 선택은 모두 켬으로 제안한다. 그룹 공개 범위는 이 체크와 무관하다.
- 공개 미리보기와 타인 원본이 포함된 그룹은 `group_items.created_at, dashboard_item_id`순으로 표시하고 **드래그는 초기 범위에서 비활성화**한다. 내 전체 후보 순서 컬럼으로 타인의 원본이나 공용 그룹 순서를 쓰지 않는다. 공동 그룹별/관람자별 순서 저장은 후속 설계다.
- AI는 기존 `/dashboard/insight`에 현재 로그인 사용자가 소유한 선택 후보 ID만 보낸다. 타인 후보가 섞이면 ‘내가 등록한 후보 N개만 분석합니다’로 범위를 표시한다. 내 후보가 0개면 호출하지 않는다. 현재 API는 빈 `item_ids`를 내 전체 후보로 해석하므로 빈 배열을 보내면 안 된다.
- 익명 AI 실행은 제공하지 않는다. 공동 그룹 전체 AI는 Phase 6 후속 범위이며 response schema 변경은 없다.
- 공유 중인 그룹의 추가 UI에는 추가한 후보가 공개 링크에서 보인다는 안내를 둔다. 추가 후보를 다시 고르는 별도 공유 UI는 만들지 않는다.

### 4.8 기존 스냅샷 공유와의 호환

기존 `POST /dashboard/shares`는 로그인 필수, `GET /dashboard/shares/{token}`은 공개 읽기로 유지한다. 비로그인 사용자에게 서버의 후보 생성·수정·삭제 권한을 주지 않는다. 기존 게스트 로컬 추가는 서버 저장이 아니다.

스냅샷 import는 현재 `Promise.all`로 여러 후보를 등록해 일부 성공 후 실패할 수 있다. 또한 개인 후보 상한 확인을 프론트에서만 믿을 수 없다. 정렬 구현의 owner 잠금을 등록에도 적용해 동시 등록 상한을 지키고, import 실패 시 실제 목록을 다시 읽어 부분 성공을 표시하는 보완을 별도 작업으로 기록한다. 전체 import를 무조건 재시도하여 중복 후보를 만들지 않는다. 원자적 일괄 import API 신설은 이번 그룹 join의 선행 조건으로 삼지 않는다.

### 4.9 migration 및 수정 예상 파일

Phase 4 수동 확인·병합 및 정렬 보완의 적용 여부를 먼저 확인한다. 실제 적용된 revision과 git 단일 head 다음에 **별도의 공유 revision**을 작성한다. 정렬과 공유 migration을 한 파일에 섞지 않는다.

- 추가: `group_members`, `group_share_links`, `group_items.added_by_user_id` backfill/NOT NULL/FK.
- 유지: `dashboard_items`, 기존 groups/group_items PK, `dashboard_shares`, profiles 및 임장 데이터.
- Alembic에서 새 모듈을 metadata에 등록하고, 손으로 관리하는 FK는 기존 `HAND_MANAGED_CONSTRAINTS` 패턴과 일치시킨다. 모델 밖 테이블까지 포함하는 autogenerate로 범위를 넓히지 않는다.
- 공유 revision의 downgrade는 새 링크·membership·추가자 기록을 잃을 수 있으므로 운영 rollback은 API/UI 비활성화를 우선 검토한다. 자동 downgrade를 배포 절차에 넣지 않는다.

수정 예상: `backend/app/group/{model,schema,service,router}.py`, 새 공유 router와 DTO(같은 group 모듈), `app/main.py`, `alembic/env.py`, 새 revision, `frontend/lib/api.js`, `NaejipsaApp.jsx`, Header/GroupBar, 공유 설정·public group 미리보기 컴포넌트, 원본별 권한을 받는 카드·편집 진입부, 공유/권한 회귀 테스트. 기존 dashboard 공유 및 원본 CRUD는 위에서 명시한 경계 외에는 바꾸지 않는다.

### 4.10 공유 완료 기준

- 기존 스냅샷 링크/복사 동작과 그룹 링크가 구분되고, 그룹 공유에 체크 해제 후보도 포함됨.
- 익명 GET 성공, 익명 write는 모든 관련 endpoint에서 401. public GET만으로 profile/member/후보 행이 생성되지 않음.
- allow_join=false 거부, true + 로그인 join 성공, 반복 join은 중복 생성·권한 상승 없음.
- 그룹 owner와 editor가 타인의 후보를 함께 조회하되 개인 메모·임장·계정 정보는 노출되지 않음.
- editor의 자기 후보 추가·그룹 관계 제거 성공. 타인 원본 details/status/checked/순서/DELETE는 직접 API 호출로도 거부.
- 타인 한 명의 후보만 있는 그룹에서도 임시 체크·드래그 제한 유지. 공동 그룹에서 타인 후보가 선택되면 새 그룹 만들기 차단, 본인 후보만 선택하면 원본 유지하며 새 그룹 생성.
- owner 역시 타인 원본 수정 불가. 외부 그룹/후보/share ID를 섞은 IDOR 차단.
- 링크 회수 후 GET/join 실패. 기존 member는 유지하며, member 제거 후 인증된 그룹 접근은 거부.
- join/회수, 추가/추방, 원본 삭제/관계 추가의 동시 요청에서 권한 우회·부분 변경 없음.
- 그룹·member 삭제/탈퇴가 타인의 원본과 다른 그룹 관계를 지우지 않음.
- 그룹 총수와 개인 원본 상한을 각각 검증하며, 참여 그룹 때문에 내 그룹 생성이 잘못 막히지 않음.
- 계정 전환 시 공개·공동 그룹의 늦은 응답을 잘못 반영하지 않음. 본인 편집 시 공유 DTO의 누락 필드로 원본을 초기화하지 않음.
- AI의 내 후보 검사·schema 유지, 내 선택 후보 0개/익명일 때 유료 API 호출 없음.
- 실제 사용자 데이터를 정리하는 기존 `auth` fixture를 피한 격리 테스트, frontend lint/build, owner·editor·익명 브라우저 수동 확인.

## 5. 구현 전 검토할 제안과 착수 순서

현재 사용자 결정으로 확정된 부분은 원본 보존, checked 사용, 정렬의 개인 전체 목록 반영, 그룹/전체 후보 화면별 공유 단위, viewer/editor의 기본 권한이다. 아래는 이번 문서의 제안이며 아직 제품 동작으로 구현되지 않았다.

| 검토 항목 | 이번 제안 |
|---|---|
| 정렬 충돌 | 전체 ID 순서와 기대 순서를 비교, 충돌은 409 후 재조회 |
| 새 그룹 공개 방식 | 스냅샷이 아니라 현재 그룹 내용 읽기 |
| 공동 그룹 크기 | 우선 총 후보 6개, 개인 후보/소유 그룹 상한은 기존 유지 |
| 공개 필드 | 호가·층 포함, 상세 동·호·개인 메모·임장·계정 정보 제외 |
| 탈퇴/추방 | 해당 회원의 기여 관계 제거, 원본 보존. 별도 영구 차단 없음 |
| 링크 수명 | 회수 전까지 유효, 자동 만료는 후속 |
| 공동 그룹 비교/순서 | 공개 화면 또는 타인 원본 포함 시 임시 checked·추가순 표시·드래그 미제공 |

착수 순서는 **Phase 4 수동 확인 및 PR #13 병합 → 정렬 저장을 별도 구현·검증 → 공유/공동참여를 별도 구현·검증**으로 제안한다. 옛 그룹 삭제 migration은 기존 사용자 결정의 순서대로 처리하고 이 문서를 DB 적용 승인으로 해석하지 않는다.

이번 작업은 이 설계 문서와 계획서의 연결만 작성했다. 코드·migration 파일·DB·Supabase 설정·Git branch/commit/push에는 변경을 가하지 않았다.
