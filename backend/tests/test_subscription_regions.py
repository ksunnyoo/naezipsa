from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import UUID

from sqlalchemy.dialects import postgresql

from app.subscription.regions import group_announcements, preferred_regions_from_codes
from app.subscription.router import get_personalized_subscription


def announcement(region, date="2026-09-13"):
    return {"category": "priority-1", "region": region, "house_name": region, "announced_at": date}


def test_seoul_first_then_distance_and_labels():
    result = group_announcements([announcement(region) for region in ["부산", "인천", "경기도", "서울특별시"]], ["서울"])
    regions = result["data"][0]["regions"]
    assert [region["label"] for region in regions] == ["[서울]", "[인천]", "[경기]", "[부산]"]
    assert regions[0]["is_preferred"] is True
    assert [region["distance_km"] for region in regions] == sorted(region["distance_km"] for region in regions)


def test_multiple_preferred_regions_and_empty_group():
    result = group_announcements([announcement("경기")], ["서울", "부산", "서울"])
    regions = result["data"][0]["regions"]
    assert [region["region"] for region in regions] == ["서울", "부산", "경기"]
    assert regions[0]["items"] == []
    assert regions[0]["message"] == "조건에 맞는 데이터가 없습니다."
    assert len(result["data"]) == 4


def test_limit_is_applied_within_region_after_grouping():
    result = group_announcements([announcement("부산"), announcement("서울", "2026-09-01"), announcement("서울")], ["서울"], 1)
    regions = result["data"][0]["regions"]
    assert regions[0]["items"][0]["announced_at"] == "2026-09-13"
    assert regions[0]["total_count"] == 2
    assert result["count"] == 2


def test_no_favorites_and_unknown_region_are_supported():
    result = group_announcements([announcement("부산"), announcement(None)], [])
    assert result["sort_basis"] == "region_name"
    assert all(region["distance_km"] is None for region in result["data"][0]["regions"])
    assert preferred_regions_from_codes(["11680", "41110", "51110", "52111", "42110", None, "99999"]) == ["서울", "경기", "강원", "전북"]


def test_personalized_query_is_scoped_to_authenticated_user():
    db = Mock()
    db.execute.return_value.scalars.return_value.all.return_value = ["11680"]
    user = SimpleNamespace(id="00000000-0000-0000-0000-000000000001")
    with patch("app.subscription.router.fetch_categorized_announcements", return_value=[announcement("서울")]) as fetch:
        result = get_personalized_subscription(3, user, db)
    statement = db.execute.call_args.args[0].compile(dialect=postgresql.dialect())
    assert "dashboard_items.user_id =" in str(statement)
    assert UUID(user.id) in statement.params.values()
    fetch.assert_called_once_with(limit=None)
    assert result["preferred_regions"] == ["서울"]


def test_personalized_endpoint_requires_login(client):
    assert client.get("/api/v1/subscription/personalized").status_code == 401


def test_nearby_uses_only_selected_size_region():
    from app.subscription.router import get_nearby_subscription
    db = Mock()
    db.execute.return_value.scalar_one_or_none.return_value = "11680"
    with patch("app.subscription.router.fetch_categorized_announcements", return_value=[announcement("부산"), announcement("서울"), announcement("경기")]):
        result = get_nearby_subscription(123, 30, db)
    statement = db.execute.call_args.args[0].compile(dialect=postgresql.dialect())
    assert "size_master.id =" in str(statement)
    assert 123 in statement.params.values()
    assert "dashboard_items" not in str(statement)
    assert result["preferred_regions"] == ["서울"]
    assert result["reference_size_id"] == 123
    assert [region["region"] for region in result["data"][0]["regions"]] == ["서울", "경기", "부산"]


def test_nearby_missing_size_is_not_unrelated_region_fallback():
    import pytest
    from fastapi import HTTPException
    from app.subscription.router import get_nearby_subscription
    db = Mock()
    db.execute.return_value.scalar_one_or_none.return_value = None
    with pytest.raises(HTTPException) as error:
        get_nearby_subscription(999, 30, db)
    assert error.value.status_code == 404


def test_exclude_closed_happens_before_region_limit():
    from app.subscription.router import get_nearby_subscription
    db = Mock()
    db.execute.return_value.scalar_one_or_none.return_value = "11680"
    rows = [{**announcement("서울"), "receipt_status": "closed"} for _ in range(31)]
    rows += [{**announcement("서울", "2026-08-01"), "receipt_status": "upcoming"},
             {**announcement("경기"), "receipt_status": "open"},
             {**announcement("부산"), "receipt_status": "unknown"}]
    with patch("app.subscription.router.fetch_categorized_announcements", return_value=rows):
        result = get_nearby_subscription(123, 1, db, exclude_closed=True)
    regions = result["data"][0]["regions"]
    assert [group["region"] for group in regions] == ["서울", "경기"]
    assert regions[0]["items"][0]["receipt_status"] == "upcoming"


def test_nearby_closes_db_transaction_before_external_call():
    """청약홈 API를 기다리는 동안 DB 연결을 쥐고 있지 않도록 조회 직후 트랜잭션을 끝낸다."""
    from app.subscription.router import get_nearby_subscription
    db = Mock()
    db.execute.return_value.scalar_one_or_none.return_value = "11680"
    committed_before_fetch = []

    def fetch(**kwargs):
        committed_before_fetch.append(db.commit.called)
        return [announcement("서울")]

    with patch("app.subscription.router.fetch_categorized_announcements", side_effect=fetch):
        get_nearby_subscription(123, 30, db)
    assert committed_before_fetch == [True]
