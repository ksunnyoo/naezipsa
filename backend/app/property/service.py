"""아이템(단지+평형) 분석 함수 모음.
raw_trades_sale/raw_trades_rent에서 데이터를 뽑아 계산하는 로직을 한 곳에 모았다.

주의: item_metrics_cache 배치가 아직 없어서, 지금은 요청 시점에 즉석 계산한다.
데이터가 많아지면 이 계산 결과를 item_metrics_cache에 미리 저장해두는 배치로
전환해야 한다 (다음 단계 작업).
"""
import statistics
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.property.model import RawTradeSale, RawTradeRent, ComplexMaster, SizeMaster, RegulationZone


def to_won(manwon_value):
    """만원 단위(DB 원본, 국토부 API 기준) -> 원 단위(팀 API 응답 규칙, 2026-09-08 확정)로 변환.
    DB에는 계속 만원으로 저장하고, API로 나가는 응답에서만 이 함수로 변환해서 내보낸다.
    """
    if manwon_value is None:
        return None
    return int(manwon_value) * 10000


def exclude_incomplete_recent(trades: list[RawTradeSale], months: int = 2) -> list[RawTradeSale]:
    """국토부 신고기한(30일) 때문에 최근 N개월 데이터는 신고가 덜 채워진 상태일 수 있다.
    실거래 추이·가격분포처럼 '정확한 시세'가 중요한 계산에서는 이 구간을 제외한다.
    (거래량 유동성은 '지금 활발한지'를 보는 지표라 여기 적용 안 함 — 팀 규칙표 기준)
    """
    today = date.today()
    cutoff = today.year * 12 + today.month - months
    return [t for t in trades if t.deal_year and t.deal_month and (t.deal_year * 12 + t.deal_month) <= cutoff]


def compute_price_per_pyeong(trades: list[RawTradeSale], pyeong: int | None) -> int | None:
    """평단가 = 최근 10건 실거래가 중앙값 ÷ 평수.
    2026-09-09 팀 확정: "아이템의 평단가 (최근 10건 실거래의 중앙값) / (아이템의 평형)"
    (기존엔 전체기간 중앙값을 썼으나, recent_median_price와 같은 기준으로 통일)
    B-03(아이템 기본지표)과 B-09(생활권 랭킹)가 같은 방식을 쓰도록 통일한 함수.
    """
    if not pyeong:
        return None
    recent_median = compute_recent_median_price(trades)
    if recent_median is None:
        return None
    return round(recent_median / pyeong)


def get_item_full_metrics(db: Session, size_id: int) -> dict:
    """AI 인사이트(AI-01)용 아이템 종합 지표. A가 /dashboard/insight에서 직접 호출.
    원본 거래 수백 건이 아니라, 이미 계산된 지표만 담아서 LLM에 넘기기 위한 재료.
    2026-09-09 프론트 요구사항 반영 통합.

    ⚠️ 이 함수가 반환하는 값은 전부 만원 단위(DB 원본)이다.
       원 단위 변환(to_won)은 이 함수를 호출하는 쪽(라우터/A)에서 필요에 맞게 적용할 것.
    """
    size, complex_ = _get_size_and_complex(db, size_id)
    if not size or not complex_:
        return {"error": "not_found", "size_id": size_id}

    sale_trades = get_trades_for_size(db, size_id)
    rents = get_rents_for_size(db, size_id, pure_jeonse_only=True)
    sale_trades_recent = exclude_incomplete_recent(sale_trades, months=2)
    rents_recent = exclude_incomplete_recent(rents, months=2)

    # 기본정보
    price_per_pyeong = compute_price_per_pyeong(sale_trades, size.pyeong)

    # 시세추이 (매매/전세) — 둘 다 최근 2개월(신고지연) 제외해서 /trend, /rent-trend 공개 API와 기준 통일
    sale_trend = compute_trend(sale_trades_recent) if sale_trades_recent else {"monthly_prices": [], "trend_direction": "표본 부족"}
    rent_trend = compute_rent_trend(rents_recent)

    # 거래량 (3/12/36개월)
    liquidity_by_period = {
        p: compute_liquidity(sale_trades, rents, p) for p in (3, 12, 36)
    }

    # 전세매매갭
    jeonse_gap = compute_jeonse_gap(sale_trades, rents)

    # 생활권랭킹
    ranking = compute_ranking(db, size_id)

    return {
        "size_id": size_id,
        "basic": {
            "complex_name": complex_.apt_nm,
            "address": f"{complex_.umd_nm} {complex_.jibun}" if complex_.jibun else complex_.umd_nm,
            "build_year": complex_.build_year,
            "area": float(size.representative_area) if size.representative_area else None,
            "pyeong": size.pyeong,
            "recent_median_price": compute_recent_median_price(sale_trades),
            "price_per_pyeong": price_per_pyeong,
        },
        "trend": {
            "sale_monthly": sale_trend["monthly_prices"],
            "sale_direction": sale_trend["trend_direction"],
            "rent_monthly": rent_trend["monthly_prices"],
        },
        "liquidity": liquidity_by_period,
        "jeonse_gap": jeonse_gap,
        "ranking": ranking,
    }


def compute_recent_median_price(trades, n: int = 10, amount_attr: str = "deal_amount") -> int | None:
    """최근 N건(기본 10건)의 중앙값. B-03/B-04/B-09에서 공통으로 쓰는 'recent_median_price' 정의.
    ✅ 2026-09-09 팀 확정: 평균이 아니라 중앙값. (예전엔 두 표가 서로 달라 모호했으나 확정됨)

    amount_attr: 기본은 매매(RawTradeSale.deal_amount). 2026-09에 전세-매매 갭
    분석 차트에서 "전세도 동일하게 최근 10건 중앙값"으로 써야 해서, 전월세
    (RawTradeRent.deposit) 같은 다른 금액 필드에도 재사용할 수 있도록 인자로
    뺐다 — 기존 호출부(인자 안 넘김)는 그대로 deal_amount를 쓰므로 동작 그대로.
    RawTradeRent에는 deal_day가 없어서 getattr(..., None)으로 안전하게 처리.
    """
    valid = [
        t for t in trades
        if getattr(t, amount_attr, None) and t.deal_year and t.deal_month
    ]
    if not valid:
        return None
    valid.sort(
        key=lambda t: (t.deal_year, t.deal_month, getattr(t, "deal_day", None) or 0),
        reverse=True,
    )
    recent = valid[:n]
    return round(statistics.median([getattr(t, amount_attr) for t in recent]))


def compute_jeonse_gap(sale_trades: list[RawTradeSale], rents: list[RawTradeRent]) -> dict:
    """전세·매매 갭 (B-08).
    ✅ 2026-09-10 팀 확정 기준 (3단계 완화 방식):
       1순위: 최근 3개월 내 매매·전세 각각 10건 이상 → 그 데이터로 계산
       2순위: (1순위 실패 시) 최근 6개월 내 각각 10건 이상 → 그 데이터로 계산
       3순위: (2순위 실패 시) 최근 6개월 내 각각 5건 이상 → 그 데이터로 계산
       전부 실패 → sample_insufficient=True, "기간 내 자료 부족"

    매매·전세 중 하나라도 그 단계 기준(건수)을 못 채우면 다음 단계로 넘어감.
    """
    today = date.today()

    def prices_within(items, months, amount_attr):
        cutoff_ordinal = today.year * 12 + today.month - months
        result = []
        for item in items:
            year, month = getattr(item, "deal_year", None), getattr(item, "deal_month", None)
            amount = getattr(item, amount_attr, None)
            if year is None or month is None or amount is None:
                continue
            if year * 12 + month >= cutoff_ordinal:
                result.append(amount)
        return result

    # (기간개월, 최소건수) 순서대로 시도 — 앞 단계가 우선순위 높음
    TIERS = [(3, 10), (6, 10), (6, 5)]

    for months, min_count in TIERS:
        sale_prices = prices_within(sale_trades, months, "deal_amount")
        jeonse_prices = prices_within(rents, months, "deposit")

        if len(sale_prices) >= min_count and len(jeonse_prices) >= min_count:
            sale_median = round(statistics.median(sale_prices))
            jeonse_median = round(statistics.median(jeonse_prices))
            gap_amount = sale_median - jeonse_median
            gap_ratio = round(jeonse_median / sale_median * 100, 1)

            return {
                "sale_median": sale_median, "jeonse_median": jeonse_median,
                "gap_amount": gap_amount, "gap_ratio": gap_ratio,
                "sample_insufficient": False,
                "period_months_used": months, "min_count_used": min_count,
            }

    # 3단계 전부 실패
    return {
        "sale_median": None, "jeonse_median": None,
        "gap_amount": None, "gap_ratio": None, "sample_insufficient": True,
        "period_months_used": None, "min_count_used": None,
        "note": "기간 내 자료 부족",
    }


def get_regulation_status(db: Session, complex_id: int) -> dict:
    """B-12: 투기과열지구/조정대상지역 지정 여부.
    complex_master.sgg_cd로 regulation_zones를 조회. 테이블에 없으면 = 대상 아님.
    """
    complex_ = db.get(ComplexMaster, complex_id)
    if not complex_:
        return {"error": "not_found", "complex_id": complex_id}

    zone = db.get(RegulationZone, complex_.sgg_cd)
    if zone is None:
        return {
            "complex_id": complex_id,
            "is_speculation_overheated": False,
            "is_adjustment_target": False,
        }

    return {
        "complex_id": complex_id,
        "is_speculation_overheated": bool(zone.is_speculation_overheated),
        "is_adjustment_target": bool(zone.is_adjustment_target),
    }


def _get_size_and_complex(db: Session, size_id: int):
    size = db.get(SizeMaster, size_id)
    if not size:
        return None, None
    complex_ = db.get(ComplexMaster, size.complex_id)
    return size, complex_


def _trades_for_size_complex(db: Session, size, complex_, exclude_canceled: bool = True):
    """size/complex를 이미 갖고 있을 때 쓰는 내부 버전 — size_id로부터 다시
    조회하지 않는다. get_trades_for_size와 compute_ranking이 공유해서 쓴다
    (2026-09 랭킹 조회 속도 개선: compute_ranking은 peer 단지 목록을 join으로
    이미 가져온 상태라, peer마다 size/complex를 재조회할 필요가 없었음).
    """
    lo, hi = float(size.representative_area) - 1.0, float(size.representative_area) + 1.0
    query = select(RawTradeSale).where(
        RawTradeSale.sgg_cd == complex_.sgg_cd,
        RawTradeSale.umd_nm == complex_.umd_nm,
        RawTradeSale.jibun == complex_.jibun,
        RawTradeSale.apt_nm == complex_.apt_nm,
        RawTradeSale.exclu_use_ar >= lo,
        RawTradeSale.exclu_use_ar <= hi,
    )
    if exclude_canceled:
        query = query.where(RawTradeSale.cdeal_type.is_(None))
    return db.execute(query).scalars().all()


def get_trades_for_size(db: Session, size_id: int, exclude_canceled: bool = True):
    """이 평형(size_id)에 해당하는 매매 거래 목록.
    같은 단지 + 대표면적 ±1㎡ 이내로 매칭 (평형 그룹핑 때와 같은 기준).
    """
    size, complex_ = _get_size_and_complex(db, size_id)
    if not size or not complex_:
        return []
    return _trades_for_size_complex(db, size, complex_, exclude_canceled)


def get_rents_for_size(db: Session, size_id: int, pure_jeonse_only: bool = True):
    """이 평형(size_id)에 해당하는 전월세 거래 목록."""
    size, complex_ = _get_size_and_complex(db, size_id)
    if not size or not complex_:
        return []

    lo, hi = float(size.representative_area) - 1.0, float(size.representative_area) + 1.0
    query = select(RawTradeRent).where(
        RawTradeRent.sgg_cd == complex_.sgg_cd,
        RawTradeRent.umd_nm == complex_.umd_nm,
        RawTradeRent.jibun == complex_.jibun,
        RawTradeRent.apt_nm == complex_.apt_nm,
        RawTradeRent.exclu_use_ar >= lo,
        RawTradeRent.exclu_use_ar <= hi,
    )
    rows = db.execute(query).scalars().all()
    if pure_jeonse_only:
        rows = [r for r in rows if r.monthly_rent == 0]
    return rows


def compute_trend(trades: list[RawTradeSale]) -> dict:
    """월별 중앙값 시세 + 추세(모멘텀) 계산. 선형회귀 slope를 직접 계산(numpy 없이)."""
    by_month: dict[tuple, list[int]] = {}
    for t in trades:
        if t.deal_year is None or t.deal_month is None or t.deal_amount is None:
            continue
        key = (t.deal_year, t.deal_month)
        by_month.setdefault(key, []).append(t.deal_amount)

    monthly = sorted(by_month.items())
    series = [
        {"year_month": f"{y}-{m:02d}", "median_price": round(statistics.median(prices))}
        for (y, m), prices in monthly
    ]

    if len(series) < 2:
        return {"monthly_prices": series, "momentum_score": None, "trend_direction": "표본 부족"}

    xs = list(range(len(series)))
    ys = [s["median_price"] for s in series]
    n = len(xs)
    x_mean = sum(xs) / n
    y_mean = sum(ys) / n
    numerator = sum((xs[i] - x_mean) * (ys[i] - y_mean) for i in range(n))
    denominator = sum((xs[i] - x_mean) ** 2 for i in range(n))
    slope = numerator / denominator if denominator else 0

    direction = "상승" if slope > 0 else ("하락" if slope < 0 else "보합")
    return {"monthly_prices": series, "momentum_score": round(slope, 1), "trend_direction": direction}


def compute_rent_trend(rents: list[RawTradeRent]) -> dict:
    """전세 시세 추이(월별 중앙값). 2026-09-09 프론트 요구사항 신규 반영.
    매매용 compute_trend와 로직은 같으나, 순수 전세(pure_jeonse_only)만 들어온다고 가정.
    """
    by_month: dict[tuple, list[int]] = {}
    for r in rents:
        if r.deal_year is None or r.deal_month is None or r.deposit is None:
            continue
        key = (r.deal_year, r.deal_month)
        by_month.setdefault(key, []).append(r.deposit)

    monthly = sorted(by_month.items())
    series = [
        {"year_month": f"{y}-{m:02d}", "median_price": round(statistics.median(prices))}
        for (y, m), prices in monthly
    ]
    return {"monthly_prices": series}


def compute_liquidity(sale_trades: list[RawTradeSale], rents: list[RawTradeRent], period_months: int) -> dict:
    """최근 N개월 기준 매매/전세 거래 건수.
    rents는 호출부(items.py)에서 이미 순수 전세(monthly_rent=0)만 필터링해서 넘겨준다고 가정.
    """
    today = date.today()
    cutoff_ordinal = today.year * 12 + today.month - period_months

    def in_period_sale(t):
        if t.deal_year is None or t.deal_month is None:
            return False
        return t.deal_year * 12 + t.deal_month >= cutoff_ordinal

    def in_period_rent(r):
        if r.deal_year is None or r.deal_month is None:
            return False
        return r.deal_year * 12 + r.deal_month >= cutoff_ordinal

    sale_count = sum(1 for t in sale_trades if in_period_sale(t))
    jeonse_count = sum(1 for r in rents if in_period_rent(r))
    return {"period_months": period_months, "sale_count": sale_count, "jeonse_count": jeonse_count}


def compute_price_distribution(trades: list[RawTradeSale]) -> dict:
    """층별 가격 분포 (B-07 명세: floor_groups + price_points 구조).
    건물 총 층수 데이터가 없어서, 해당 단지 거래 중 관측된 최고층을 근사값(프록시)으로 사용.
    ⚠️ 이 근사는 실제 건물 총 층수와 다를 수 있음 — 팀 논의 필요.
    """
    valid = [t for t in trades if t.floor is not None and t.deal_amount is not None and t.floor > 0]
    if not valid:
        return {"floor_groups": {}, "price_points": [], "note": "표본 없음"}

    max_floor_observed = max(t.floor for t in valid)  # 총 층수 근사값(프록시)

    # 저층 건물 예외: 관측 최고층이 5층 이하면 3단계로 나누는 게 무의미함 (빌라/저층 단지)
    if max_floor_observed <= 5:
        return {
            "floor_groups": {},
            "price_points": [
                {"floor": t.floor, "deal_amount": t.deal_amount,
                 "exclu_use_ar": float(t.exclu_use_ar) if t.exclu_use_ar is not None else None}
                for t in valid
            ],
            "note": f"저층 건물(관측 최고층 {max_floor_observed}층)이라 저/중/고층 분류를 적용하지 않음",
        }

    low_cut = max_floor_observed / 3
    mid_cut = max_floor_observed * 2 / 3

    def group_of(floor):
        if floor <= low_cut:
            return "저층"
        elif floor <= mid_cut:
            return "중층"
        return "고층"

    price_points = [
        {
            "floor": t.floor,
            "deal_amount": t.deal_amount,
            "exclu_use_ar": float(t.exclu_use_ar) if t.exclu_use_ar is not None else None,
            "group": group_of(t.floor),
        }
        for t in valid
    ]

    floor_groups: dict[str, dict] = {}
    for group_name in ["저층", "중층", "고층"]:
        group_prices = [p["deal_amount"] for p in price_points if p["group"] == group_name]
        floor_groups[group_name] = {
            "count": len(group_prices),
            "median_price": round(statistics.median(group_prices)) if group_prices else None,
        }

    return {
        "floor_groups": floor_groups,
        "price_points": price_points,
        "max_floor_observed_proxy": max_floor_observed,
        "note": "총 층수 실데이터가 없어 관측 최고층을 근사값으로 사용함",
    }


def compute_trade_points(records, months: int, amount_attr: str = "deal_amount") -> dict:
    """실거래 분포도 차트(2026-09 프론트 요구사항) 전용 — /trend·/rent-trend(월별
    중앙값)와 달리 점 하나하나의 위치가 필요해서 개별 거래를 그대로 반환한다.

    필터링 규칙은 다른 실데이터 API들과 동일하게 맞춘다:
    1) exclude_incomplete_recent로 신고지연 최근 2개월 제외 (recent_median_price·
       trend·price-distribution과 동일 규칙)
    2) months(3/12/36) 하한 적용 — /trend가 라우터 단에서 하는 것과 동일한 방식

    amount_attr로 매매(deal_amount)/전세(deposit) 둘 다 처리한다(구조가 같아서
    RawTradeSale·RawTradeRent 모두 이 함수 하나로 충분함).
    """
    filtered = exclude_incomplete_recent(records, months=2)
    if months < 60:
        today = date.today()
        cutoff_start = today.year * 12 + today.month - months
        filtered = [
            r for r in filtered
            if r.deal_year and r.deal_month and (r.deal_year * 12 + r.deal_month) >= cutoff_start
        ]

    points = []
    for r in filtered:
        amount = getattr(r, amount_attr, None)
        if amount is None:
            continue
        points.append({
            "deal_amount": amount,
            "deal_year": r.deal_year,
            "deal_month": r.deal_month,
            "floor": getattr(r, "floor", None),
        })

    amounts = [p["deal_amount"] for p in points]
    average_price = round(statistics.mean(amounts)) if amounts else None

    return {"count": len(points), "average_price": average_price, "points": points}


def compute_ranking(db: Session, size_id: int) -> dict:
    """같은 구 + 같은 평형(±5㎡) 내 평단가 랭킹."""
    size, complex_ = _get_size_and_complex(db, size_id)
    if not size or not complex_:
        return {"error": "not_found"}

    target_area = float(size.representative_area)
    lo, hi = target_area - 5, target_area + 5

    peer_sizes = db.execute(
        select(SizeMaster, ComplexMaster)
        .join(ComplexMaster, SizeMaster.complex_id == ComplexMaster.id)
        .where(
            ComplexMaster.sgg_cd == complex_.sgg_cd,
            SizeMaster.representative_area >= lo,
            SizeMaster.representative_area <= hi,
        )
    ).all()

    if not peer_sizes:
        return {"error": "no_data"}

    # b) 거래 내역 쿼리 통합 (2026-09 속도 개선): peer마다 따로 쿼리를 날리는
    # 대신, 이 구 안에서 나올 수 있는 가장 넓은 면적 범위(각 peer의 ±1㎡ 여유를
    # 포함)로 한 번만 조회한 뒤, (동, 지번, 단지명)별로 묶어 파이썬에서 다시
    # peer별 ±1㎡ 범위로 골라 쓴다. 최종적으로 각 peer가 받는 거래 목록은
    # 기존 방식(peer마다 개별 쿼리)과 완전히 동일 — 필터 조건만 그대로 옮긴
    # 것이라 결과값 차이는 없다.
    peer_areas = [float(peer_size.representative_area) for peer_size, _ in peer_sizes]
    broad_lo, broad_hi = min(peer_areas) - 1.0, max(peer_areas) + 1.0

    all_trades = db.execute(
        select(RawTradeSale).where(
            RawTradeSale.sgg_cd == complex_.sgg_cd,
            RawTradeSale.exclu_use_ar >= broad_lo,
            RawTradeSale.exclu_use_ar <= broad_hi,
            RawTradeSale.cdeal_type.is_(None),
        )
    ).scalars().all()

    trades_by_complex: dict[tuple, list] = {}
    for trade in all_trades:
        key = (trade.umd_nm, trade.jibun, trade.apt_nm)
        trades_by_complex.setdefault(key, []).append(trade)

    ranked = []
    for peer_size, peer_complex in peer_sizes:
        key = (peer_complex.umd_nm, peer_complex.jibun, peer_complex.apt_nm)
        p_lo = float(peer_size.representative_area) - 1.0
        p_hi = float(peer_size.representative_area) + 1.0
        trades = [
            t for t in trades_by_complex.get(key, [])
            if p_lo <= t.exclu_use_ar <= p_hi
        ]
        price_per_pyeong = compute_price_per_pyeong(trades, peer_size.pyeong)
        if price_per_pyeong is None:
            continue
        ranked.append({
            "size_id": peer_size.id,
            "apt_nm": peer_complex.apt_nm,
            "price_per_pyeong": price_per_pyeong,
        })

    if not ranked:
        return {"error": "no_data"}

    ranked.sort(key=lambda x: x["price_per_pyeong"], reverse=True)
    total = len(ranked)
    my_rank = next((i + 1 for i, r in enumerate(ranked) if r["size_id"] == size_id), None)
    top = ranked[0]
    my_entry = next((r for r in ranked if r["size_id"] == size_id), None)

    return {
        "my_rank": my_rank,
        "total": total,
        "my_price_per_pyeong": my_entry["price_per_pyeong"] if my_entry else None,
        "top_complex": top["apt_nm"],
        "top_price_per_pyeong": top["price_per_pyeong"],
        # 2026-09-09 프론트 요구사항 신규: 같은 구 전체 단지의 평단가 배열
        "all_price_per_pyeong": [r["price_per_pyeong"] for r in ranked],
    }
