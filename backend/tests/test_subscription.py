from unittest.mock import Mock, patch

from app.subscription.cheongyak_home import fetch_categorized_announcements


def test_categories_use_receipt_dates_and_exclude_non_officetel():
    common = {"HOUSE_MANAGE_NO": "1", "HOUSE_NM": "테스트", "RCRIT_PBLANC_DE": "2026-09-11", "SUBSCRPT_AREA_CODE_NM": "서울"}
    def response(url, **kwargs):
        if "getAPTLttot" in url:
            rows = [dict(common, GNRL_RNK1_CRSPAREA_RCPTDE="2026-09-22", GNRL_RNK1_ETC_AREA_ENDDE="2026-09-23", SPSPLY_RCEPT_BGNDE="2026-09-21", SPSPLY_RCEPT_ENDDE="2026-09-21")]
        elif "getRemndr" in url:
            rows = [dict(common, SUBSCRPT_RCEPT_BGNDE="2026-09-15", SUBSCRPT_RCEPT_ENDDE="2026-09-15")]
        else:
            rows = [dict(common, HOUSE_DTL_SECD_NM=kind, SUBSCRPT_RCEPT_BGNDE="2026-09-16", SUBSCRPT_RCEPT_ENDDE="2026-09-17") for kind in ("오피스텔", "도시형생활주택")]
        return Mock(json=lambda: {"data": rows})
    with patch("app.subscription.cheongyak_home.SERVICE_KEY", "test"), patch("app.subscription.cheongyak_home.requests.get", side_effect=response):
        items = fetch_categorized_announcements(limit=10)
        assert [item["category"] for item in items] == ["general", "special", "no-rank", "officetel", "urban-living"]
        assert items[0]["receipt_start"] == "2026-09-22"
        assert items[0]["receipt_end"] == "2026-09-23"
        assert fetch_categorized_announcements(region="부산") == []
        assert len(fetch_categorized_announcements(limit=2)) == 2


import pytest
from requests import HTTPError, Timeout


@pytest.mark.parametrize("categorized", [False, True])
@pytest.mark.parametrize("rows,region", [([], None), ([{"SUBSCRPT_AREA_CODE_NM": "서울"}], "부산")])
def test_empty_subscription_response_is_success(client, categorized, rows, region):
    response = Mock(json=lambda: {"data": rows})
    params = {"categorized": str(categorized).lower()}
    if region:
        params["region"] = region
    with patch("app.subscription.cheongyak_home.SERVICE_KEY", "test"), patch("app.subscription.cheongyak_home.requests.get", return_value=response):
        result = client.get("/api/v1/subscription", params=params)
    assert result.status_code == 200
    assert result.json() == {"status": "success", "count": 0, "data": []}


@pytest.mark.parametrize("categorized", [False, True])
@pytest.mark.parametrize("body", [{}, {"data": None}, {"data": {}}, {"data": [None]}])
def test_invalid_upstream_response_is_not_empty_success(client, categorized, body):
    response = Mock(json=lambda: body)
    with patch("app.subscription.cheongyak_home.SERVICE_KEY", "test"), patch("app.subscription.cheongyak_home.requests.get", return_value=response):
        result = client.get("/api/v1/subscription", params={"categorized": str(categorized).lower()})
    assert result.status_code == 502


@pytest.mark.parametrize("categorized", [False, True])
@pytest.mark.parametrize("error", [Timeout("timeout"), HTTPError("404 Not Found")])
def test_upstream_failure_is_not_empty_success(client, categorized, error):
    with patch("app.subscription.cheongyak_home.SERVICE_KEY", "test"), patch("app.subscription.cheongyak_home.requests.get", side_effect=error):
        result = client.get("/api/v1/subscription", params={"categorized": str(categorized).lower()})
    assert result.status_code == 502


@pytest.mark.parametrize("categorized", [False, True])
@pytest.mark.parametrize("notice,reason", [
    ("서비스 가능시간이 아닙니다.", "OUTSIDE_SERVICE_HOURS"),
    ("서비스 가능 시간 외입니다.", "OUTSIDE_SERVICE_HOURS"),
    ("시스템 점검 중입니다.", "MAINTENANCE"),
])
def test_service_notice_with_http_200_is_actionable_error(client, categorized, notice, reason):
    response = Mock(json=lambda: {"code": -1, "message": notice, "data": []})
    with patch("app.subscription.cheongyak_home.SERVICE_KEY", "test"), patch("app.subscription.cheongyak_home.requests.get", return_value=response):
        result = client.get("/api/v1/subscription", params={"categorized": str(categorized).lower()})
    assert result.status_code == 503
    error = result.json()["error"]
    assert error["code"] == "HTTP_503"
    assert error["details"] == {"source": "applyhome", "reason": reason, "retryable": True}
    assert "청약홈" in error["message"]


def test_xml_service_notice_is_detected_before_http_error(client):
    response = Mock(text="<returnAuthMsg>서비스 가능시간이 아닙니다.</returnAuthMsg>")
    response.json.side_effect = ValueError("not JSON")
    response.raise_for_status.side_effect = HTTPError("503")
    with patch("app.subscription.cheongyak_home.SERVICE_KEY", "test"), patch("app.subscription.cheongyak_home.requests.get", return_value=response):
        result = client.get("/api/v1/subscription")
    assert result.status_code == 503
    assert result.json()["error"]["details"]["reason"] == "OUTSIDE_SERVICE_HOURS"


def test_request_error_never_exposes_service_key(client):
    with patch("app.subscription.cheongyak_home.SERVICE_KEY", "secret-key"), patch("app.subscription.cheongyak_home.requests.get", side_effect=HTTPError("url?serviceKey=secret-key")):
        result = client.get("/api/v1/subscription")
    assert result.status_code == 502
    assert "secret-key" not in result.text


def test_timeout_has_separate_reason(client):
    with patch("app.subscription.cheongyak_home.SERVICE_KEY", "test"), patch("app.subscription.cheongyak_home.requests.get", side_effect=Timeout("timeout")):
        result = client.get("/api/v1/subscription")
    assert result.json()["error"]["details"]["reason"] == "UPSTREAM_TIMEOUT"


def test_business_error_with_empty_data_is_not_success(client):
    response = Mock(json=lambda: {"code": -1, "message": "처리 오류", "data": []})
    with patch("app.subscription.cheongyak_home.SERVICE_KEY", "test"), patch("app.subscription.cheongyak_home.requests.get", return_value=response):
        result = client.get("/api/v1/subscription")
    assert result.status_code == 502


@pytest.mark.parametrize("start,end,expected", [
    ("2026-09-01", "2026-09-12", "closed"),
    ("2026-09-01", "2026-09-13", "open"),
    ("2026-09-14", "2026-09-15", "upcoming"),
    ("", "", "unknown"),
])
def test_receipt_status_dates(start, end, expected):
    from datetime import date
    from app.subscription.cheongyak_home import receipt_status
    assert receipt_status(start, end, date(2026, 9, 13)) == expected


def test_closed_announcements_keep_published_date():
    row = {"HOUSE_MANAGE_NO": "old", "RCRIT_PBLANC_DE": "2020-01-01",
           "GNRL_RNK1_CRSPAREA_RCPTDE": "2020-01-10", "GNRL_RNK1_CRSPAREA_ENDDE": "2020-01-10"}
    with patch("app.subscription.cheongyak_home._fetch_rows", return_value=[row]):
        items = fetch_categorized_announcements(limit=None)
    assert items[0]["receipt_status"] == "closed"
    assert items[0]["announced_at"] == "2020-01-01"
