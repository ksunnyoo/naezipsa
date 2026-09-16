"""아이템(단지+평형) 관련 엔드포인트. 팀 API 명세(B-03~B-09) 기준.

구현 완료: B-03(기본지표), B-04(호가괴리율), B-05(추이), B-06(유동성),
           B-07(층별분포), B-09(생활권랭킹)
API 연결됨(로직 검증 완료): B-08(전세매매갭)
미구현: B-10(거시뷰) — macro.py 참고

⚠️ 2026-09-08 확정: 모든 금액 필드는 원(₩) 단위로 응답한다.
   DB(raw_trades_sale.deal_amount 등)는 국토부 원본 그대로 만원 단위로 저장하고,
   API 응답을 만드는 이 파일에서만 to_won()으로 변환해서 내보낸다.
   (list_price는 A가 이미 원 단위로 저장하므로 변환 없이 그대로 사용)
"""
import statistics
import time
from datetime import date
from fastapi import APIRouter, Depends, Query, Body
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.property.service import (
    get_trades_for_size,
    get_rents_for_size,
    compute_trend,
    compute_rent_trend,
    compute_liquidity,
    compute_price_distribution,
    compute_ranking,
    compute_recent_median_price,
    compute_price_per_pyeong,
    compute_jeonse_gap,
    compute_trade_points,
    exclude_incomplete_recent,
    to_won,
    _get_size_and_complex,
)

router = APIRouter(prefix="/items", tags=["items"])

# c) 랭킹 결과 캐싱 (2026-09 속도 개선): 랭킹은 구 전체 실거래를 다시
# 계산해야 하는 무거운 연산이라, 같은 size_id를 반복 조회할 때마다(체크박스를
# 껐다 켜는 경우 등) 매번 다시 계산할 필요가 없다. 거시데이터 캐싱과 동일한
# 방식(프로세스 메모리 + TTL)을 size_id 기준으로 적용한다.
RANKING_CACHE_TTL_SECONDS = 6 * 60 * 60  # 6시간
_ranking_cache: dict[int, tuple[float, dict]] = {}


def _get_cached_ranking(size_id: int) -> dict | None:
    entry = _ranking_cache.get(size_id)
    if entry is None:
        return None
    cached_at, data = entry
    if time.time() - cached_at > RANKING_CACHE_TTL_SECONDS:
        return None
    return data


def _set_cached_ranking(size_id: int, data: dict) -> None:
    _ranking_cache[size_id] = (time.time(), data)


@router.get("/jeonse-gap")
def get_jeonse_gap(ids: str, db: Session = Depends(get_db)):
    """B-08: 전세·매매 갭. ids는 콤마 구분 size_id 목록.
    ✅ 2026-09-10 확정 기준(3단계 완화): 3개월×10건 → 6개월×10건 → 6개월×5건 → 표본부족
    ⚠️ 검증 스크립트(jeonse_gap_full_validation.py)에서 썼던 IQR 이상치 제거는
       아직 이 API엔 반영 안 됨(단순화 버전) — 필요시 다음 단계에서 추가.
    """
    size_ids = [int(x) for x in ids.split(",")]
    items = []
    for size_id in size_ids:
        sale_trades = get_trades_for_size(db, size_id)
        rents = get_rents_for_size(db, size_id, pure_jeonse_only=True)

        result = compute_jeonse_gap(sale_trades, rents)

        if result["sample_insufficient"]:
            # 부족할 땐 불필요한 null 필드 없이, 사유만 간결하게 반환
            items.append({
                "size_id": size_id,
                "sample_insufficient": True,
                "message": "기간 내 데이터 부족",
            })
        else:
            items.append({
                "size_id": size_id,
                "sample_insufficient": False,
                "sale_median": to_won(result["sale_median"]),
                "jeonse_median": to_won(result["jeonse_median"]),
                "gap_amount": to_won(result["gap_amount"]),
                "gap_ratio": result["gap_ratio"],
                "period_months_used": result["period_months_used"],
            })

    return {"items": items}


@router.get("/jeonse-gap-recent")
def get_jeonse_gap_recent(ids: str, db: Session = Depends(get_db)):
    """전세-매매 갭 분석 차트 전용(2026-09 프론트 요구사항). ids는 콤마 구분
    size_id 목록(위 /jeonse-gap과 동일 규칙).

    ⚠️ 위 /jeonse-gap(B-08)과 다른 점: B-08은 팀이 확정한 3단계 기간 완화
    로직(compute_jeonse_gap)을 쓰지만, 이 엔드포인트는 그 로직을 건드리지
    않고 별도로 추가했다 — 매매/전세 각각 "최근 실거래 10건의 중앙값"만 단순
    비교한다(B-03/B-04/B-09의 recent_median_price와 동일한 정의,
    compute_recent_median_price 재사용). 두 정의가 달라서 결과 gap_amount가
    /jeonse-gap과 다르게 나올 수 있다.
    """
    size_ids = [int(x) for x in ids.split(",")]
    items = []
    for size_id in size_ids:
        sale_trades = get_trades_for_size(db, size_id)
        rents = get_rents_for_size(db, size_id, pure_jeonse_only=True)

        sale_median = compute_recent_median_price(sale_trades)
        jeonse_median = compute_recent_median_price(rents, amount_attr="deposit")

        if sale_median is None or jeonse_median is None:
            items.append({
                "size_id": size_id,
                "sample_insufficient": True,
                "message": "실거래 데이터 부족",
            })
        else:
            gap_amount = sale_median - jeonse_median
            gap_ratio = round(jeonse_median / sale_median * 100, 1)
            items.append({
                "size_id": size_id,
                "sample_insufficient": False,
                "sale_median": to_won(sale_median),
                "jeonse_median": to_won(jeonse_median),
                "gap_amount": to_won(gap_amount),
                "gap_ratio": gap_ratio,
            })

    return {"items": items}


@router.get("/{size_id}")
def get_item_basic(size_id: int, db: Session = Depends(get_db)):
    """B-03: 평형 기본 지표.
    ⚠️ item_metrics_cache 배치가 아직 없어서 즉석 계산함(다음 단계에서 캐시로 전환 예정).
    ⚠️ recent_avg_price라는 이름은 쓰지 않음(팀 규칙) — recent_median_price만 사용.
    """
    size, complex_ = _get_size_and_complex(db, size_id)
    if not size or not complex_:
        return {"error": "not_found", "size_id": size_id}

    trades = get_trades_for_size(db, size_id)
    prices = [t.deal_amount for t in trades if t.deal_amount]

    last_trade = None
    if trades:
        dated = [t for t in trades if t.deal_year and t.deal_month]
        if dated:
            dated.sort(key=lambda t: (t.deal_year, t.deal_month, t.deal_day or 0), reverse=True)
            last = dated[0]
            last_trade = f"{last.deal_year}-{last.deal_month:02d}"

    price_per_pyeong = compute_price_per_pyeong(trades, size.pyeong)

    return {
        "size_id": size_id,
        "complex_name": complex_.apt_nm,
        "address": f"{complex_.umd_nm} {complex_.jibun}" if complex_.jibun else complex_.umd_nm,
        "build_year": complex_.build_year,
        "area": float(size.representative_area) if size.representative_area else None,
        "pyeong": size.pyeong,
        "recent_median_price": to_won(compute_recent_median_price(trades)),
        "min_price": to_won(min(prices)) if prices else None,
        "max_price": to_won(max(prices)) if prices else None,
        "price_per_pyeong": to_won(price_per_pyeong),
        "last_trade_date": last_trade,
        "trade_count_3y": len(trades),
        "sample_insufficient": len(trades) < 3,
    }


@router.post("/{size_id}/price-check")
def price_check(size_id: int, list_price: int = Body(..., embed=True), db: Session = Depends(get_db)):
    """B-04: 호가-실거래가 괴리율.
    list_price는 A가 원 단위로 저장한 값 그대로 받음. recent_median_price도
    원 단위로 변환한 뒤 비교하므로 단위가 일치함.
    ⚠️ recent_median_price 산출 기준에 시트 내 두 표가 서로 다름(평균 vs 중앙값) —
       여기서는 '최근 10건의 중앙값'으로 절충함. 팀 확인 필요.
    """
    trades = get_trades_for_size(db, size_id)
    recent_median_price = to_won(compute_recent_median_price(trades))

    if recent_median_price is None:
        return {
            "size_id": size_id, "list_price": list_price,
            "recent_median_price": None, "gap_amount": None, "gap_pct": None,
            "sample_insufficient": True,
        }

    gap_amount = list_price - recent_median_price
    gap_pct = round(gap_amount / recent_median_price * 100, 2)

    return {
        "size_id": size_id,
        "list_price": list_price,
        "recent_median_price": recent_median_price,
        "gap_amount": gap_amount,
        "gap_pct": gap_pct,
    }


@router.get("/{size_id}/trend")
def get_trend(size_id: int, months: int = Query(60, description="조회 기간(개월), 기본 60개월"), db: Session = Depends(get_db)):
    """B-05: 실거래 추이.
    거래유형: 매매만 / 대표값: 중앙값 / 제외: 최근 2개월(신고지연) + 계약해제건
    """
    trades = get_trades_for_size(db, size_id)  # get_trades_for_size가 이미 계약해제 건 제외함
    trades = exclude_incomplete_recent(trades, months=2)

    if months < 60:
        today = date.today()
        cutoff = today.year * 12 + today.month - months
        trades = [t for t in trades if t.deal_year and t.deal_month and (t.deal_year * 12 + t.deal_month) >= cutoff]

    if not trades:
        return {"size_id": size_id, "monthly_median_prices": [], "trend_direction": "표본 부족"}

    computed = compute_trend(trades)
    monthly_prices_won = [
        {"year_month": m["year_month"], "median_price": to_won(m["median_price"])}
        for m in computed["monthly_prices"]
    ]
    return {
        "size_id": size_id,
        "monthly_median_prices": monthly_prices_won,
        "trend_direction": computed["trend_direction"],
    }


@router.get("/{size_id}/rent-trend")
def get_rent_trend(size_id: int, months: int = Query(60, description="조회 기간(개월), 기본 60개월"), db: Session = Depends(get_db)):
    """전세 시세 추이 (2026-09-09 프론트 요구사항 신규).
    매매용 /trend와 동일한 방식(월별 중앙값), 순수 전세만 사용, 최근 2개월 신고지연 구간 제외.
    """
    rents = get_rents_for_size(db, size_id, pure_jeonse_only=True)

    valid_rents = [r for r in rents if r.deal_year and r.deal_month]
    today_year, today_month = date.today().year, date.today().month
    cutoff = today_year * 12 + today_month - 2
    rents = [r for r in valid_rents if (r.deal_year * 12 + r.deal_month) <= cutoff]

    if months < 60:
        cutoff_start = today_year * 12 + today_month - months
        rents = [r for r in rents if (r.deal_year * 12 + r.deal_month) >= cutoff_start]

    if not rents:
        return {"size_id": size_id, "monthly_median_prices": []}

    computed = compute_rent_trend(rents)
    monthly_prices_won = [
        {"year_month": m["year_month"], "median_price": to_won(m["median_price"])}
        for m in computed["monthly_prices"]
    ]
    return {"size_id": size_id, "monthly_median_prices": monthly_prices_won}


@router.get("/{size_id}/liquidity")
def get_liquidity(
    size_id: int,
    period: int = Query(12, description="3, 12, 36 중 선택 (2026-09-09 프론트 확정)"),
    db: Session = Depends(get_db),
):
    """B-06: 거래량 유동성. 모호한 ratio는 반환하지 않음(팀 규칙). 금액 필드 없음."""
    sale_trades = get_trades_for_size(db, size_id)
    rents = get_rents_for_size(db, size_id, pure_jeonse_only=True)  # 순수 전세만
    result = compute_liquidity(sale_trades, rents, period)
    return {
        "size_id": size_id,
        "period_months": result["period_months"],
        "sale_count": result["sale_count"],
        "jeonse_count": result["jeonse_count"],
    }


@router.get("/{size_id}/trade-points")
def get_trade_points(
    size_id: int,
    months: int = Query(12, description="3, 12, 36 중 선택 (실거래 분포도 차트, 2026-09 프론트 요구사항)"),
    type: str = Query("sale", description="sale(매매) 또는 jeonse(전세)"),
    db: Session = Depends(get_db),
):
    """실거래 분포도 차트 전용 — 개별 거래가 포인트 + 기간 내 평균가.

    /price-distribution(B-07)은 층별 분포용이라 기간 선택이 없고 매매만 다루는데,
    이 차트는 3/12/36개월 기간 선택과 매매/전세 전환이 둘 다 필요해서 별도로 뒀다.
    금액 단위는 팀 규칙대로 원(₩) — to_won()으로 여기서 변환해서 내보낸다.
    """
    if type == "jeonse":
        records = get_rents_for_size(db, size_id, pure_jeonse_only=True)
        amount_attr = "deposit"
    else:
        records = get_trades_for_size(db, size_id)
        amount_attr = "deal_amount"

    result = compute_trade_points(records, months, amount_attr=amount_attr)

    return {
        "size_id": size_id,
        "months": months,
        "type": type,
        "count": result["count"],
        "average_price": to_won(result["average_price"]),
        "points": [
            {
                "deal_amount": to_won(p["deal_amount"]),
                "deal_year": p["deal_year"],
                "deal_month": p["deal_month"],
                "floor": p["floor"],
            }
            for p in result["points"]
        ],
    }


@router.get("/{size_id}/price-distribution")
def get_price_distribution(size_id: int, db: Session = Depends(get_db)):
    """B-07: 층별 가격분포. 최근 2개월 제외, 저층 건물 예외 처리 포함."""
    trades = get_trades_for_size(db, size_id)
    trades = exclude_incomplete_recent(trades, months=2)
    result = compute_price_distribution(trades)
    result["size_id"] = size_id

    for point in result.get("price_points", []):
        point["deal_amount"] = to_won(point["deal_amount"])
    for group in result.get("floor_groups", {}).values():
        if group.get("median_price") is not None:
            group["median_price"] = to_won(group["median_price"])

    return result


@router.get("/{size_id}/ranking")
def get_ranking(size_id: int, area_scope: str = Query("sgg", description="생활권 기준: sgg(구, 동간 비교) — 확정됨"), db: Session = Depends(get_db)):
    """B-09: 생활권 랭킹.
    확정된 기준: 같은 구(sgg_cd) 안에서, 동(umd_nm)이 다른 단지들도 함께 비교.
    """
    cached = _get_cached_ranking(size_id)
    if cached is not None:
        return cached

    result = compute_ranking(db, size_id)
    result["size_id"] = size_id
    result["area_scope"] = "sgg(구 내 동간 비교)"

    if result.get("my_price_per_pyeong") is not None:
        result["my_price_per_pyeong"] = to_won(result["my_price_per_pyeong"])
    if result.get("top_price_per_pyeong") is not None:
        result["top_price_per_pyeong"] = to_won(result["top_price_per_pyeong"])
    if result.get("all_price_per_pyeong") is not None:
        result["all_price_per_pyeong"] = [to_won(v) for v in result["all_price_per_pyeong"]]

    # 에러 응답은 캐싱하지 않는다 — 일시적인 문제까지 6시간 동안 계속
    # 에러만 반환하게 되는 걸 막기 위함 (거시데이터 캐싱과 동일한 원칙)
    if "error" not in result:
        _set_cached_ranking(size_id, result)

    return result
