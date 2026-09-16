"""청약홈(한국부동산원) 분양정보 조회 서비스 연동.

odcloud 기반 API. Swagger 명세 + 실제 호출로 검증 완료 (2026-09-09).
공공데이터포털 데이터셋: https://www.data.go.kr/data/15098547/openapi.do
"""

import os
import re
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Dict, Iterable, List, Optional
from urllib.parse import unquote

import requests
from dotenv import load_dotenv

from app.subscription.regions import CATEGORIES, CATEGORY_BY_KEY

load_dotenv()

BASE_URL = "https://api.odcloud.kr/api"
OPERATION_PATH = "ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail"

SERVICE_KEY = unquote(os.getenv("APPLYHOME_API_KEY", ""))

FIELD_MAP = {
    "announcement_no": "HOUSE_MANAGE_NO",
    "house_name": "HOUSE_NM",
    "region": "SUBSCRPT_AREA_CODE_NM",
    "address": "HSSPLY_ADRES",
    "announced_at": "RCRIT_PBLANC_DE",
    "source_url": "PBLANC_URL",
}


class SubscriptionFetchError(Exception):
    """화면용 메시지와 프론트 분기용 사유를 가진 수집 오류."""

    def __init__(self, message, *, reason="UPSTREAM_ERROR", status_code=502, retryable=True):
        super().__init__(message)
        self.reason = reason
        self.status_code = status_code
        self.retryable = retryable


def _fetch_rows(operation_path, per_page):
    if not SERVICE_KEY:
        raise SubscriptionFetchError(
            "청약 정보 서비스 설정을 확인 중입니다. 관리자에게 문의해 주세요.",
            reason="CONFIGURATION_ERROR", retryable=False,
        )
    try:
        response = requests.get(
            f"{BASE_URL}/{operation_path}",
            params={"serviceKey": SERVICE_KEY, "page": 1, "perPage": per_page},
            timeout=7,
        )
    except requests.Timeout as exc:
        raise SubscriptionFetchError(
            "청약홈 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
            reason="UPSTREAM_TIMEOUT",
        ) from exc
    except requests.RequestException as exc:
        raise SubscriptionFetchError(
            "청약홈에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."
        ) from exc

    try:
        payload = response.json()
    except ValueError:
        payload = None

    # HTTP 200으로 내려오는 업무 오류도 판별한다. 공고 본문은 검사하지 않는다.
    messages = []
    if isinstance(payload, dict):
        for key in ("message", "msg", "resultMsg", "returnAuthMsg", "errMsg"):
            if isinstance(payload.get(key), str):
                messages.append(payload[key])
    if not isinstance(payload, dict) or "data" not in payload:
        raw_text = response.text
        if isinstance(raw_text, str):
            messages.append(raw_text[:10000])
    notice = re.sub(r"\s+", "", " ".join(messages)).lower()
    if any(phrase in notice for phrase in (
        "서비스가능시간이아", "서비스시간이아", "이용가능시간이아",
        "서비스시간외", "서비스가능시간외", "이용시간외",
    )):
        raise SubscriptionFetchError(
            "현재 청약홈 서비스 이용 가능 시간이 아닙니다. 이용 가능한 시간에 다시 시도해 주세요.",
            reason="OUTSIDE_SERVICE_HOURS", status_code=503,
        )
    if any(phrase in notice for phrase in ("서비스점검", "시스템점검", "점검중")):
        raise SubscriptionFetchError(
            "청약홈 서비스 점검 중입니다. 잠시 후 다시 시도해 주세요.",
            reason="MAINTENANCE", status_code=503,
        )
    try:
        response.raise_for_status()
    except requests.RequestException as exc:
        raise SubscriptionFetchError(
            "청약홈에서 정보를 받아오지 못했습니다. 잠시 후 다시 시도해 주세요."
        ) from exc
    if isinstance(payload, dict) and payload.get("code") not in (None, 0, "0", "00", 200, "200"):
        raise SubscriptionFetchError("청약홈에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.")
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise SubscriptionFetchError(
            "청약홈 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
            reason="INVALID_UPSTREAM_RESPONSE",
        )
    return rows


def _parse_date(raw: str) -> str:
    if raw is None:
        return ""
    text = str(raw).strip()
    if not text:
        return ""
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    if "T" in text:
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).strftime("%Y-%m-%d")
        except ValueError:
            pass
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    return text


def receipt_status(start, end, today=None):
    """마감일 당일까지 접수중으로 표시한다(한국 날짜, 시간 단위 마감은 제공되지 않음)."""
    today = today or datetime.now(ZoneInfo("Asia/Seoul")).date()
    try:
        first = datetime.strptime(start, "%Y-%m-%d").date()
        last = datetime.strptime(end, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return "unknown"
    if first > last:
        return "unknown"
    if last < today:
        return "closed"
    return "upcoming" if first > today else "open"


def fetch_recent_announcements(
    region: Optional[str] = None, limit: int = 3
) -> List[Dict[str, str]]:
    """최근 분양 공고를 모집공고일 최신순으로 가져온다.

    region: 공급지역명으로 필터링 (예: "충남", "서울"). None이면 전체.
    limit: 반환할 최대 개수.
    """
    items = _fetch_rows(OPERATION_PATH, 50)

    normalized = []
    for item in items:
        region_name = item.get(FIELD_MAP["region"]) or ""
        if region and region not in region_name:
            continue
        normalized.append(
            {
                "announcement_no": item.get(FIELD_MAP["announcement_no"], ""),
                "house_name": item.get(FIELD_MAP["house_name"], ""),
                "region": region_name,
                "address": item.get(FIELD_MAP["address"], ""),
                "announced_at": _parse_date(item.get(FIELD_MAP["announced_at"], "")),
                "source_url": item.get(FIELD_MAP["source_url"], ""),
            }
        )

    normalized.sort(key=lambda x: x["announced_at"], reverse=True)
    return normalized[:limit]

def _normalized_dates(dates: Iterable[Optional[str]]) -> List[str]:
    values = []
    for raw in dates or ():
        parsed = _parse_date(raw)
        if parsed:
            values.append(parsed)
    return sorted(set(values))


def _classify_other_category(row: Dict[str, str]) -> Optional[str]:
    candidates = []
    for key in ("HOUSE_DTL_SECD_NM", "HOUSE_SECD_NM", "HOUSE_DTL_SECD", "HOUSE_SECD", "HOUSE_SECD_NM"):
        value = row.get(key)
        if value:
            candidates.append(str(value))
    if not candidates:
        return None

    combined = " ".join(candidates)
    normalized = combined.strip()
    if not normalized:
        return None

    if "공공지원민간임대" in normalized or "공공지원" in normalized:
        return "public-supported-private-rental"
    if "도시형생활주택" in normalized or "도시형" in normalized:
        return "urban-living"
    if "생활숙박" in normalized or "숙박시설" in normalized:
        return "living-accommodation"
    if "민간임대" in normalized or "private rental" in normalized.lower():
        return "private-rental"
    if "오피스텔" in normalized or "officetel" in normalized.lower():
        return "officetel"
    return None


def fetch_categorized_announcements(region=None, limit=10):
    """공식 접수 일정으로 유형을 구분한다. 일반공급은 1순위와 2순위를 함께 포함한다."""
    from concurrent.futures import ThreadPoolExecutor

    operations = [
        "getAPTLttotPblancDetail",
        "getRemndrLttotPblancDetail",
        "getUrbtyOfctlLttotPblancDetail",
    ]

    def collect(operation):
        return _fetch_rows(f"ApplyhomeInfoDetailSvc/v1/{operation}", 100)

    with ThreadPoolExecutor(max_workers=3) as executor:
        apt, remainder, other = list(executor.map(collect, operations))
    groups = {key: [] for key, _ in CATEGORIES}

    def add(row, category, dates):
        dates = _normalized_dates(dates)
        if not dates or (region and region not in (row.get("SUBSCRPT_AREA_CODE_NM") or "")):
            return
        item = {name: row.get(field) or "" for name, field in FIELD_MAP.items()}
        item.update(
            category=category,
            label=CATEGORY_BY_KEY.get(category, category),
            receipt_dates=dates,
            receipt_start=dates[0],
            receipt_end=dates[-1],
            receipt_status=receipt_status(dates[0], dates[-1]),
        )
        groups[category].append(item)

    for row in apt:
        general_dates = []
        for rank in (1, 2):
            for area in ("CRSPAREA", "ETC_AREA", "ETC_GG"):
                general_dates.extend([
                    row.get(f"GNRL_RNK{rank}_{area}_RCPTDE"),
                    row.get(f"GNRL_RNK{rank}_{area}_ENDDE"),
                ])
        add(row, "general", general_dates)
        add(row, "special", [row.get("SPSPLY_RCEPT_BGNDE"), row.get("SPSPLY_RCEPT_ENDDE")])

    for row in remainder:
        add(row, "no-rank", [row.get("SUBSCRPT_RCEPT_BGNDE"), row.get("SUBSCRPT_RCEPT_ENDDE")])

    for row in other:
        category = _classify_other_category(row)
        if category is None:
            continue
        dates = [row.get("SUBSCRPT_RCEPT_BGNDE"), row.get("SUBSCRPT_RCEPT_ENDDE")]
        add(row, category, dates)

    for items in groups.values():
        items.sort(key=lambda item: item.get("announced_at") or "", reverse=True)

    result = []
    for category, _ in CATEGORIES:
        result.extend(groups.get(category, []))

    if limit is not None:
        return result[:limit]
    return result
