"""A-01~A-09 사용자 API 테스트.

기획 규칙이 실제로 강제되는지를 본다.
  - 후보 최대 6개
  - 등록 필수값은 size_id 하나뿐
  - 같은 평형을 동/호만 달리해 여러 번 담을 수 있음
  - 남의 후보는 보이지도 지워지지도 않음
"""
from tests.conftest import DASHBOARD_URL, ITEMS_URL, PROFILE_URL

MAX_ITEMS = 6


# --- A-01, A-02: 프로필 ----------------------------------------------------

def test_profile_is_created_on_first_call(client, auth, test_user):
    """A-01: 첫 호출에 profiles 행이 자동으로 만들어진다.

    Supabase Auth는 auth.users에만 기록하므로, 우리 테이블은 이 시점에 채워진다.
    """
    res = client.get(PROFILE_URL, headers=auth)
    assert res.status_code == 200
    body = res.json()
    assert body["user_id"] == test_user["id"]
    # 응답 키는 명세("변수명 통일" 표) 그대로여야 한다.
    assert set(body) == {
        "user_id", "nickname", "age_group", "service_purposes", "created_at", "updated_at",
    }


def test_profile_fields_are_all_optional(client, auth):
    """온보딩을 건너뛴 사용자도 서비스를 쓸 수 있어야 한다."""
    body = client.get(PROFILE_URL, headers=auth).json()
    assert body["nickname"]                      # 닉네임은 랜덤으로 채워져 시작한다
    assert body["age_group"] is None
    assert body["service_purposes"] is None


def test_profile_update(client, auth):
    """A-02: 닉네임·나이대·이용목적을 한 번에 저장."""
    res = client.patch(
        PROFILE_URL,
        headers=auth,
        json={"nickname": "홍길동", "age_group": "30s", "service_purposes": ["move", "buy"]},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["nickname"] == "홍길동"
    assert body["age_group"] == "30s"
    assert body["service_purposes"] == ["move", "buy"]


def test_profile_partial_update_keeps_other_fields(client, auth):
    """PATCH는 보낸 필드만 바꾼다. 안 보낸 필드는 그대로 남는다."""
    client.patch(PROFILE_URL, headers=auth, json={"nickname": "홍길동", "age_group": "30s"})
    res = client.patch(PROFILE_URL, headers=auth, json={"nickname": "김철수"})
    assert res.json()["nickname"] == "김철수"
    assert res.json()["age_group"] == "30s"      # 안 보냈으므로 유지


def test_profile_explicit_null_clears_field(client, auth):
    """null을 명시적으로 보내면 지운다. '안 보냄'과 구분된다.

    닉네임은 비워 두지 않고 새 랜덤 닉네임으로 바뀐다.
    """
    client.patch(PROFILE_URL, headers=auth, json={"nickname": "홍길동", "age_group": "30s"})
    res = client.patch(PROFILE_URL, headers=auth, json={"nickname": None, "age_group": None})
    assert res.json()["age_group"] is None
    assert res.json()["nickname"] not in (None, "홍길동")


def test_profile_rejects_invalid_enum(client, auth):
    """허용값이 아닌 age_group / service_purposes 는 422."""
    assert client.patch(PROFILE_URL, headers=auth, json={"age_group": "99s"}).status_code == 422
    res = client.patch(PROFILE_URL, headers=auth, json={"service_purposes": ["로또당첨"]})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "VALIDATION_ERROR"
    # 어느 필드가 틀렸는지 프론트가 바로 알 수 있어야 한다.
    assert res.json()["error"]["details"][0]["field"].startswith("body.service_purposes")


# --- A-03: 등록 -----------------------------------------------------------

def test_create_item_with_size_id_only(client, auth, real_size_ids):
    """A-03: 필수값은 size_id 하나뿐. 선택정보는 전부 생략 가능."""
    res = client.post(ITEMS_URL, headers=auth, json={"size_id": real_size_ids[0]})
    assert res.status_code == 201
    body = res.json()
    assert body["size_id"] == real_size_ids[0]
    assert body["status"] == "considering"        # 서버가 기본값을 정한다
    for optional in ("list_price", "floor", "dong", "ho", "direction", "interior_state", "memo"):
        assert body[optional] is None


def test_create_item_with_all_details(client, auth, real_size_ids):
    res = client.post(ITEMS_URL, headers=auth, json={
        "size_id": real_size_ids[0], "list_price": 1320000000, "floor": 12,
        "dong": "105", "ho": "1203", "direction": "south",
        "interior_state": "partial", "memo": "남향, 재건축 기대",
    })
    assert res.status_code == 201
    assert res.json()["dong"] == "105"
    # 동/호는 문자열로 저장한다. 숫자로 두면 "0105" 같은 선행 0이 사라진다.
    assert isinstance(res.json()["ho"], str)


def test_same_size_id_can_be_added_twice(client, auth, real_size_ids):
    """같은 단지·같은 평형이라도 동/호가 다르면 다른 후보다.

    (user_id, size_id) 유니크 제약을 걸지 않은 이유가 이것이다.
    """
    first = client.post(ITEMS_URL, headers=auth, json={"size_id": real_size_ids[0], "dong": "101"})
    second = client.post(ITEMS_URL, headers=auth, json={"size_id": real_size_ids[0], "dong": "105"})
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] != second.json()["id"]


def test_create_requires_size_id(client, auth):
    res = client.post(ITEMS_URL, headers=auth, json={})
    assert res.status_code == 422
    assert res.json()["error"]["details"][0]["field"] == "body.size_id"


def test_list_price_is_in_won(client, auth, real_size_ids):
    """호가 단위는 원. 13.2억은 1320000000으로 보낸다.

    팀 규칙(2026-09-09): DB는 만원, API 응답은 원.
    list_price는 사용자 입력값이라 DB에도 원으로 저장한다.
    """
    res = client.post(ITEMS_URL, headers=auth, json={"size_id": real_size_ids[0], "list_price": 1320000000})
    assert res.status_code == 201
    assert res.json()["list_price"] == 1320000000


def test_list_price_rejects_manwon_unit_mistake(client, auth, real_size_ids):
    """만원 단위로 보내면 422로 막는다.

    132000을 원으로 해석하면 13.2만원이다. 아파트 호가일 수 없으므로
    하한(100만원)으로 이런 실수를 입력 시점에 잡는다.
    """
    res = client.post(ITEMS_URL, headers=auth, json={"size_id": real_size_ids[0], "list_price": 13200000000000})
    assert res.status_code == 422
    assert res.json()["error"]["details"][0]["field"] == "body.list_price"


def test_create_rejects_invalid_direction(client, auth, real_size_ids):
    """향은 영문 enum으로 받는다. 한글 표시는 프론트 몫."""
    res = client.post(ITEMS_URL, headers=auth, json={"size_id": real_size_ids[0], "direction": "남향"})
    assert res.status_code == 422


def test_max_items_limit(client, auth, real_size_ids):
    """A-03: 7번째 등록은 409로 막힌다.

    같은 평형을 동만 바꿔 6번 담는다. size_id에 외래키가 걸려 있어 아무 숫자나
    쓸 수 없고, (user_id, size_id) 유니크 제약은 없으므로 이렇게 채울 수 있다.
    """
    size_id = real_size_ids[0]
    for i in range(MAX_ITEMS):
        res = client.post(ITEMS_URL, headers=auth,
                          json={"size_id": size_id, "dong": f"10{i}"})
        assert res.status_code == 201

    res = client.post(ITEMS_URL, headers=auth, json={"size_id": size_id, "dong": "999"})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "CONFLICT"
    assert str(MAX_ITEMS) in res.json()["error"]["message"]


# --- A-04, A-05: 목록 / 상세 -----------------------------------------------

def test_list_items(client, auth, real_size_ids):
    """A-04: 프론트가 상한값을 하드코딩하지 않도록 count/max_count를 함께 준다."""
    client.post(ITEMS_URL, headers=auth, json={"size_id": real_size_ids[0]})
    client.post(ITEMS_URL, headers=auth, json={"size_id": real_size_ids[1]})

    body = client.get(ITEMS_URL, headers=auth).json()
    assert body["count"] == 2
    assert body["max_count"] == MAX_ITEMS
    assert len(body["items"]) == 2


def test_get_item_detail(client, auth, real_size_ids):
    """A-05: 선택정보가 없으면 null로 나간다."""
    item_id = client.post(ITEMS_URL, headers=auth, json={"size_id": real_size_ids[0]}).json()["id"]
    res = client.get(f"{ITEMS_URL}/{item_id}", headers=auth)
    assert res.status_code == 200
    assert res.json()["list_price"] is None


def test_get_missing_item_returns_404(client, auth):
    res = client.get(f"{ITEMS_URL}/99999999", headers=auth)
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"


# --- A-06, A-07: 수정 ------------------------------------------------------

def test_update_details_partially(client, auth, real_size_ids):
    """A-06: 보낸 필드만 바뀐다."""
    item_id = client.post(ITEMS_URL, headers=auth, json={
        "size_id": real_size_ids[0], "dong": "105", "list_price": 1320000000}).json()["id"]

    res = client.patch(f"{ITEMS_URL}/{item_id}/details", headers=auth,
                       json={"list_price": 1400000000})
    assert res.status_code == 200
    assert res.json()["list_price"] == 1400000000
    assert res.json()["dong"] == "105"           # 안 보냈으므로 유지


def test_update_details_null_clears(client, auth, real_size_ids):
    """null을 보내면 선택정보를 지운다."""
    item_id = client.post(ITEMS_URL, headers=auth,
                          json={"size_id": real_size_ids[0], "memo": "지울 메모"}).json()["id"]
    res = client.patch(f"{ITEMS_URL}/{item_id}/details", headers=auth, json={"memo": None})
    assert res.json()["memo"] is None


def test_update_details_cannot_change_size_id(client, auth, real_size_ids):
    """size_id 변경은 수정이 아니라 '지우고 새로 담기'다. 보내도 무시된다."""
    item_id = client.post(ITEMS_URL, headers=auth, json={"size_id": real_size_ids[0]}).json()["id"]
    res = client.patch(f"{ITEMS_URL}/{item_id}/details", headers=auth, json={"size_id": 9999})
    assert res.json()["size_id"] == real_size_ids[0]


def test_update_status(client, auth, real_size_ids):
    """A-07: 상태만 바꾸는 전용 엔드포인트."""
    item_id = client.post(ITEMS_URL, headers=auth, json={"size_id": real_size_ids[0]}).json()["id"]
    res = client.patch(f"{ITEMS_URL}/{item_id}/status", headers=auth,
                       json={"status": "interested"})
    assert res.status_code == 200
    assert res.json()["status"] == "interested"


def test_update_status_rejects_invalid_value(client, auth, real_size_ids):
    item_id = client.post(ITEMS_URL, headers=auth, json={"size_id": real_size_ids[0]}).json()["id"]
    res = client.patch(f"{ITEMS_URL}/{item_id}/status", headers=auth, json={"status": "보류"})
    assert res.status_code == 422


# --- A-08: 삭제 -----------------------------------------------------------

def test_delete_item(client, auth, real_size_ids):
    """A-08: 삭제하면 deleted_id를 돌려준다."""
    item_id = client.post(ITEMS_URL, headers=auth, json={"size_id": real_size_ids[0]}).json()["id"]

    res = client.delete(f"{ITEMS_URL}/{item_id}", headers=auth)
    assert res.status_code == 200
    assert res.json() == {"deleted_id": item_id}

    # 같은 id로 다시 지우면 404
    assert client.delete(f"{ITEMS_URL}/{item_id}", headers=auth).status_code == 404


# --- A-09: 대시보드 집계 ---------------------------------------------------

def test_create_rejects_unknown_size_id(client, auth):
    """A-03: 존재하지 않는 평형은 404로 막는다.

    dashboard_items.size_id -> size_master.id 외래키가 걸려 있어서
    DB 차원에서도 막히지만, 그대로 두면 500이 나가 원인을 알 수 없다.
    """
    res = client.post(ITEMS_URL, headers=auth, json={"size_id": 99999999})
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "NOT_FOUND"


def test_items_include_complex_and_metrics(client, auth, real_size_ids):
    """A-04: 후보 목록에 단지명·평형·시세 지표가 함께 나온다.

    프론트가 후보마다 B의 API를 따로 부르지 않아도 되게 하는 것이 목적이다.
    """
    size_id = real_size_ids[0]
    client.post(ITEMS_URL, headers=auth, json={"size_id": size_id})

    item = client.get(ITEMS_URL, headers=auth).json()["items"][0]
    assert item["complex_name"]                 # 단지명이 채워져 있어야 한다
    assert item["pyeong"] is not None
    assert item["representative_area"] is not None

    m = item["metrics"]
    assert m is not None, "지표가 계산된 평형을 골랐으므로 metrics가 있어야 한다"
    # 금액 단위는 원. 아파트 대표가라면 최소 수천만원은 된다.
    # 만원 단위로 새어 나왔다면 이 하한에 걸린다.
    assert m["recent_median_price"] > 10_000_000


def test_dashboard_includes_metrics(client, auth, real_size_ids):
    """A-09: 대시보드 집계에도 같은 지표가 실린다."""
    client.post(ITEMS_URL, headers=auth, json={"size_id": real_size_ids[0]})

    body = client.get(DASHBOARD_URL, headers=auth).json()
    assert body["items"][0]["complex_name"]
    assert body["items"][0]["metrics"]["recent_median_price"] > 0


def test_dashboard_aggregates_profile_and_items(client, auth, real_size_ids):
    """A-09: 첫 화면을 한 번의 호출로 구성한다.

    ⚠️ 아직 B의 지표(단지명·평수·최근 대표가)는 포함되지 않는다.
       size_master가 이 DB로 이관된 뒤에 붙인다.
    """
    client.patch(PROFILE_URL, headers=auth, json={"nickname": "홍길동"})
    client.post(ITEMS_URL, headers=auth, json={"size_id": real_size_ids[0]})

    res = client.get(DASHBOARD_URL, headers=auth)
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"profile", "items", "count", "max_count"}
    assert body["profile"]["nickname"] == "홍길동"
    assert body["count"] == 1
