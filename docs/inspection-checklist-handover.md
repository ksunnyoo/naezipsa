# 임장 체크리스트 저장 연결 — 전달용 명세

작성: 2026-09-16 (민준, 백엔드 A)
대상: 체크리스트 화면 담당(진수님, `b3b14aa`), 임장 백엔드 담당(PR #11 `b6c4b11` 작성자)

> 이 문서는 **현황과 선택지만** 정리한다. 연결 방식은 담당자가 정한다(2026-09-16 사용자 결정).
> 이 문서를 쓰면서 코드·DB는 바꾸지 않았다.

## 1. 요약

- DB와 저장 API가 있고, 웹 체크리스트 화면도 있다. **그런데 둘이 연결되어 있지 않아 체크리스트는 저장되지 않는다.**
- 항목 이름 18개와 점수 규칙은 이미 양쪽이 같다. 연결 자체는 어렵지 않지만 5장의 결정이 먼저 필요하다.

## 2. 현재 상태

기준: main + `feat/phase5-group-share`(2026-09-16).

| 구분 | 있는 것 | 없는 것 |
|---|---|---|
| DB `property_inspections` | 후보(`dashboard_items.id`)별 기록. 18개 항목 점수(항목마다 컬럼), 종합 평점, 메모, 작성 시각. 공용 DB 적용됨(리비전 `c71f9a2d830e`), 확인 시점 0행 | 수정 시각 |
| 백엔드 API | `GET /api/v1/properties/{id}`(후보 표시 정보), `POST /api/v1/properties/{id}/inspection`(새 기록 저장). 격리 테스트 `tests/test_inspection.py` | 저장한 기록 조회(최근 1건·목록), 수정, 삭제 |
| 웹 화면 | 매물 수정 창 → "체크리스트 작성"(`EditListingDialog` → `InspectionChecklist`). 항목 정의 `frontend/lib/checklist.js` | 서버 호출(`lib/api.js`에 임장 함수 없음), 종합 평점·임장 메모 입력, 모바일 임장 페이지(`/visit/{id}`) |

지금 "저장"을 누르면 매물 정보는 서버에 저장하고, 체크리스트는 `NaejipsaApp`의 `itemChecklists`(화면 메모리)에만 넣는다. 새로고침하거나 다시 로그인하면 사라진다.

## 3. 항목 대응표 (이미 일치)

값이 클수록 좋다(1~3). 유해시설만 0=없음, 1=있음이다. null이나 생략은 "미확인"이다.

| 묶음 | 키 (DB 컬럼 = 화면 key) | 화면 선택지 (1 / 2 / 3) |
|---|---|---|
| 교통 | `transport` | 나쁨 / 보통 / 좋음 |
| 교통 | `commute_road` | 나쁨 / 보통 / 좋음 |
| 교육·생활 | `school` | 나쁨 / 보통 / 좋음 |
| 교육·생활 | `academy` | 나쁨 / 보통 / 좋음 |
| 교육·생활 | `convenience` | 나쁨 / 보통 / 좋음 |
| 교육·생활 | `noise` | 시끄러움 / 보통 / 조용 |
| 교육·생활 | `harmful_facility` | 있음 = 1, 없음 = 0 |
| 단지 | `parking` | 나쁨 / 보통 / 좋음 |
| 단지 | `sunlight` | 나쁨 / 보통 / 좋음 |
| 단지 | `natural_light` | 나쁨 / 보통 / 좋음 |
| 내부 상태 | `leak_mold` | 있음 / 의심 / 없음 |
| 내부 상태 | `wallpaper` | 교체 필요 / 보통 / 양호 |
| 내부 상태 | `water_pressure` | 약함 / 보통 / 좋음 |
| 내부 상태 | `toilet_drain` | 나쁨 / 보통 / 좋음 |
| 내부 상태 | `drain_smell` | 심함 / 약간 / 없음 |
| 설비 | `window_condition` | 교체 필요 / 보통 / 양호 |
| 설비 | `heating` | 문제 있음 / 보통 / 양호 |
| 설비 | `floor_noise` | 심함 / 보통 / 거의 없음 |

화면의 체크리스트 값(18개 key → 숫자 또는 null)을 그대로 요청 body에 넣을 수 있다.

## 4. 현재 저장 API 계약 (바꾸지 않고 쓸 경우)

`POST /api/v1/properties/{id}/inspection`

- `Authorization: Bearer <Supabase access token>` 필요.
- `{id}`는 `dashboard_items.id`(화면의 `backendId`)다. `size_id`나 화면용 id(`item-1`)가 아니다.

요청 예:

```json
{ "transport": 3, "commute_road": 2, "harmful_facility": 0, "noise": null, "overall_rating": 4, "memo": "" }
```

규칙:

- 18개 항목은 정수만 받는다(문자열 `"3"`, `3.0`, `true`는 거부). 생략·null은 미확인이다.
- `overall_rating`은 **필수** 정수 1~5다. 항목 점수와 무관한 별도 값이다.
- `memo`는 생략하면 빈 문자열, 최대 2,000자, null은 거부한다. 후보 자체의 메모(`dashboard_items.memo`)와 다른 값이다.
- 정의되지 않은 키(`property_id`, `user_id`, 화면 전용 키 등)가 있으면 422다.
- 저장할 때마다 **새 기록**이 생긴다(덮어쓰지 않는다). 같은 요청을 두 번 보내면 기록이 두 개가 된다.

응답 201: `{ "id": 1, "property_id": 1, "created_at": "2026-09-16T05:00:00Z" }`

| 상태 | 뜻 |
|---|---|
| 401 | 로그인 필요 |
| 404 | 없는 후보, 다른 사람 후보 |
| 422 | 입력 오류(`error.details`에 필드별 사유) |
| 500 | 저장 실패(전체 롤백) |

오류 형식은 공통 `{"error": {"code", "message", "details"}}`다.

**기록이 생긴 뒤의 영향:** 그 후보는 `DELETE /api/v1/dashboard/items/{id}`가 409("임장 기록이 있는 후보 매물은 삭제할 수 없습니다. 제외 상태로 변경해 주세요.")가 된다. 기록을 지키려는 설계(외래키 RESTRICT)다.

## 5. 담당자가 정할 것

항목끼리 서로 영향을 준다. 선택지와 영향만 적는다.

### 5.1 종합 평점(`overall_rating`)

API는 필수인데 웹 체크리스트에는 입력칸이 없다.

| 선택지 | 필요한 변경 | 영향 |
|---|---|---|
| A. 화면에 1~5 입력 추가 | 프론트만 | 사용자가 한 번 더 고른다 |
| B. 백엔드에서 선택값으로 변경 | migration(NOT NULL 해제) + 스키마·테스트 | 평점 없는 기록이 생긴다 |
| C. 항목 점수로 자동 계산 | 계산 규칙 정의(미확인 항목, 유해시설 0/1 방향 처리) | 사용자 판단과 다를 수 있다 |

### 5.2 저장 방식

| 선택지 | 필요한 변경 | 영향 |
|---|---|---|
| A. 저장할 때마다 새 기록(현재 API) | 없음 | 방문 이력이 남는다. 수정 창 "저장"마다 기록이 쌓이지 않게 **바뀐 경우에만** 보내는 처리가 필요하다 |
| B. 후보당 기록 1개를 고침 | 수정 API + 후보당 1개 제약 migration | 이력이 남지 않는다. 기존 "기록 보존" 설계와 다르다 |

### 5.3 다시 열었을 때 이어서 보기

저장한 기록을 읽는 API가 없다. 5.2에 따라 모양이 달라진다.

- A를 고르면 최근 1건 조회(예: `GET /api/v1/properties/{id}/inspections/latest`) 또는 목록 조회.
- B를 고르면 그 1건 조회.
- 어느 쪽이든 기존 API처럼 후보 주인만 허용한다(다른 사람 후보는 404).

### 5.4 저장 시점과 버튼

지금은 수정 창의 "저장" 한 버튼이 매물 정보와 체크리스트를 같이 처리한다.

- 체크리스트 전용 저장 버튼을 둘지, 한 버튼에서 둘 다 보낼지 정한다.
- 한쪽만 실패했을 때 보여줄 내용을 정한다. 지금은 매물 정보 저장이 실패해도 체크리스트 캐시는 갱신된다.

### 5.5 삭제가 막힌 후보

- 기록이 생기면 삭제가 409가 되는데, **웹에는 후보 상태(제외)를 바꾸는 화면이 없다.**
- 지금 화면은 409의 서버 안내 대신 "관심 매물을 삭제하지 못했어요"만 보여준다.
- 선택지: 제외 상태 UI 추가 / 삭제할 때 기록도 함께 지우는 정책 / 409 안내 문구만 표시.
- 후보 목록 코드(백엔드 `app/dashboard`, 프론트 `NaejipsaApp.jsx`)와 겹치므로, 정해지면 민준에게 알려주면 맞춰 반영한다.

### 5.6 이번 연결의 범위

- 모바일 임장 페이지(`/visit/{id}`, 임장 백엔드 README의 프런트 계약): 웹 체크리스트와 같은 API를 쓸지, 함께 만들지.
- 회원 탈퇴 시 임장 기록 처리(임장 백엔드 README에 후속으로 적혀 있음).
- 임장 체크리스트 공유: **하지 않는다(2026-09-16 사용자 결정).** 그룹 공유 링크에도 임장 기록은 싣지 않는다.

## 6. 연결할 때 주의할 현재 코드

1. **체크리스트 캐시 키가 화면용 id(`item-1`)다.** 공유받은 매물을 가져오면 목록을 다시 불러와 순번으로 id를 새로 매긴다(`NaejipsaApp.jsx`의 `` `item-${index + 1}` ``). 그 전에 후보를 지운 적이 있으면 **다른 매물의 체크리스트가 보일 수 있다.** 서버에 연결할 때는 `backendId` 기준으로 둔다.
2. 비로그인(게스트) 매물은 `backendId`가 없어 서버에 저장할 수 없다. 로그인 안내를 할지 정한다.
3. 저장 요청을 자동으로 다시 보내면 기록이 중복된다(5.2 A일 때).
4. 저장 중에는 버튼을 잠그고, 201일 때만 성공으로 표시하고, 실패하면 입력값을 유지한다(임장 백엔드 README 권장).

## 7. 연결 완료 확인 목록

정한 방식에 맞춰 고쳐 쓴다.

- 체크리스트를 저장한 뒤 새로고침·재로그인해도 같은 값이 보인다.
- 미확인(null)과 유해시설 "없음"(0)이 구분되어 저장된다.
- 다른 사람 후보 id로 저장·조회하면 404다.
- 매물 정보만 고쳐 저장해도 임장 기록이 불필요하게 늘지 않는다.
- 저장이 실패하면 입력값이 남고 안내가 뜬다.
- 기록이 있는 후보를 삭제하려 하면 정한 정책대로 안내·처리된다.
- 목록을 다시 불러와도 체크리스트가 다른 매물에 붙지 않는다.
- 백엔드 격리 테스트(`tests/test_inspection.py`)와 프론트 테스트·lint·build가 통과한다. 실제 DB 후보를 비우는 `auth` 픽스처 테스트는 쓰지 않는다.

## 8. 참고 파일

| 파일 | 내용 |
|---|---|
| [backend/app/inspection/model.py](../backend/app/inspection/model.py) | 테이블·제약 |
| [backend/app/inspection/schema.py](../backend/app/inspection/schema.py), [router.py](../backend/app/inspection/router.py), [service.py](../backend/app/inspection/service.py) | 입력 규칙·API·소유권 확인 |
| [backend/app/inspection/README.md](../backend/app/inspection/README.md) | 임장 백엔드 원래 계약(모바일 링크 포함) |
| [backend/tests/test_inspection.py](../backend/tests/test_inspection.py) | 격리 테스트 |
| [backend/app/dashboard/router.py](../backend/app/dashboard/router.py) | 기록이 있는 후보 삭제 409 |
| [frontend/lib/checklist.js](../frontend/lib/checklist.js) | 화면 항목·선택지 |
| [frontend/components/EditListingDialog.jsx](../frontend/components/EditListingDialog.jsx), [InspectionChecklist.jsx](../frontend/components/InspectionChecklist.jsx) | 체크리스트 화면 |
| [frontend/components/NaejipsaApp.jsx](../frontend/components/NaejipsaApp.jsx) | `itemChecklists` 캐시, 저장·삭제 처리 |
