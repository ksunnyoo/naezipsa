"""[dashboard] service — 후보에 단지 정보와 실거래 지표를 붙인다.

흐름   router ▶ ★service ▶ model / property.model
참조   app/property/model.py (B 소유 · 읽기 전용. 수정하려면 B에게 요청)
소유   A

후보 매물에 실거래 지표를 붙이는 로직 (A 담당).

A-09(GET /dashboard)와 A-04(후보 목록)가 이 함수를 쓴다.

--- B의 데이터를 어떻게 가져오는가 -----------------------------------------

B가 `ingest/compute_metrics.py`로 미리 계산해 둔 item_metrics_cache를 읽는다.
후보마다 B의 계산 함수(app/property/service.py)를 호출하지 않는 이유:

  - 대시보드는 후보를 최대 6개까지 보여준다. 후보마다 거래 수백 건을 조회해
    중앙값을 다시 계산하면 첫 화면이 눈에 띄게 느려진다.
  - 캐시는 바로 이 용도로 만들어졌고, B-03(평형 기본지표)도 같은 캐시를 읽는다.
    같은 출처를 쓰므로 대시보드와 상세 화면의 숫자가 어긋나지 않는다.

따라서 후보가 몇 개든 조회는 한 번이다(JOIN 한 방).

⚠️ B의 코드는 읽기만 하고 수정하지 않는다(팀 규칙 1).
   지표 계산 기준을 바꿔야 하면 B에게 요청한다.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dashboard.model import DashboardItem
from app.dashboard.schema import (
    DashboardItemWithMetrics,
    ItemMetrics,
    RegulationStatus,
    SnapshotItemWithInfo,
)
from app.property.model import ComplexMaster, ItemMetricsCache, RegulationZone, SizeMaster
from app.property.service import to_won

# 내 후보를 읽는 순서. 사용자가 저장한 순서(sort_order)가 먼저고, 같으면 등록순·id순이다.
# 후보 목록·대시보드·그룹 상세·공유 스냅샷·순서 저장이 모두 이 순서를 쓴다.
ITEM_ORDER = (DashboardItem.sort_order, DashboardItem.created_at, DashboardItem.id)


def get_items_with_metrics(db: Session, user_id) -> list[DashboardItemWithMetrics]:
    """내 후보 목록에 단지명·평형·시세 지표를 붙여서 돌려준다.

    outerjoin을 쓰는 이유: 아직 지표가 계산되지 않은 평형(캐시에 행이 없는 경우)도
    후보 목록에서 사라지면 안 된다. 그런 후보는 metrics가 null로 나가고,
    프론트는 "지표 준비 중"으로 표시하면 된다.

    size_master는 외래키가 걸려 있어 항상 존재하지만, 방어적으로 outerjoin을 쓴다.
    순서는 ITEM_ORDER(저장한 순서 → 등록순)다.
    """
    rows = db.execute(
        select(DashboardItem, SizeMaster, ComplexMaster, ItemMetricsCache, RegulationZone)
        .outerjoin(SizeMaster, SizeMaster.id == DashboardItem.size_id)
        .outerjoin(ComplexMaster, ComplexMaster.id == SizeMaster.complex_id)
        .outerjoin(ItemMetricsCache, ItemMetricsCache.size_id == DashboardItem.size_id)
        # B-12: 단지의 시군구코드로 규제 지정 현황 조회. 해당 코드가
        # regulation_zones에 없으면(= 규제 대상 아님) zone은 None으로 오고,
        # _build에서 두 값 다 False로 채운다(B의 get_regulation_status와
        # 동일한 규칙).
        .outerjoin(RegulationZone, RegulationZone.sgg_cd == ComplexMaster.sgg_cd)
        .where(DashboardItem.user_id == user_id)
        .order_by(*ITEM_ORDER)
    ).all()

    return [
        _build(item, size, complex_, cache, zone)
        for item, size, complex_, cache, zone in rows
    ]


def _build(item, size, complex_, cache, zone=None) -> DashboardItemWithMetrics:
    """조인 결과 한 줄을 응답 형태로 조립한다."""
    metrics = None
    if cache is not None:
        # 캐시에는 만원으로 저장돼 있다. API 응답은 원 단위이므로 변환한다.
        # (팀 규칙 2026-09-09: DB는 만원, API 응답은 원)
        # to_won은 B가 만든 함수를 그대로 쓴다. 변환 규칙이 한 곳에만 있어야
        # A와 B의 응답이 어긋나지 않는다.
        metrics = ItemMetrics(
            recent_median_price=to_won(cache.recent_median_price),
            min_price=to_won(cache.min_price),
            max_price=to_won(cache.max_price),
            price_per_pyeong=to_won(cache.price_per_pyeong),
            trade_count_3y=cache.trade_count_3y,
            last_trade_date=cache.last_trade_date,
            # Numeric(5,2)는 Decimal로 오므로 JSON에 싣기 좋게 float으로 바꾼다.
            jeonse_ratio=float(cache.jeonse_ratio) if cache.jeonse_ratio is not None else None,
        )

    return DashboardItemWithMetrics(
        # 후보 자체의 정보 (A가 저장한 것)
        id=item.id,
        size_id=item.size_id,
        status=item.status,
        list_price=item.list_price,
        floor=item.floor,
        dong=item.dong,
        ho=item.ho,
        direction=item.direction,
        interior_state=item.interior_state,
        memo=item.memo,
        checked=item.checked,
        sort_order=item.sort_order,
        created_at=item.created_at,
        updated_at=item.updated_at,
        # 단지·평형 정보 (B의 master 테이블)
        complex_name=complex_.apt_nm if complex_ else None,
        legal_dong_name=complex_.umd_nm if complex_ else None,
        build_year=complex_.build_year if complex_ else None,
        representative_area=float(size.representative_area)
        if size is not None and size.representative_area is not None
        else None,
        pyeong=size.pyeong if size else None,
        # 시세 지표 (B가 미리 계산해 둔 캐시)
        metrics=metrics,
        # 규제 지정 여부 (B의 regulation_zones)
        regulation=RegulationStatus(
            is_speculation_overheated=bool(zone.is_speculation_overheated) if zone else False,
            is_adjustment_target=bool(zone.is_adjustment_target) if zone else False,
        ),
    )


def size_exists(db: Session, size_id: int) -> bool:
    """등록하려는 평형이 실제로 있는지 확인한다.

    DB에 외래키가 걸려 있어서 없는 size_id는 어차피 저장되지 않지만,
    그대로 두면 IntegrityError가 500으로 나가 사용자가 원인을 알 수 없다.
    미리 확인해서 404로 알려주기 위한 함수다.
    """
    return db.get(SizeMaster, size_id) is not None


# --- 공유 링크가 쓰는 스냅샷 헬퍼 -----------------------------------------
#
# 공유 링크는 "지금 내 관심 매물"을 통째로 떠서 담아두고(snapshot_current_items),
# 링크를 열면 그 스냅샷에 단지명·시세를 다시 붙여 보여준다(enrich_snapshot_items).
# 그룹은 스냅샷이 아니라 기존 후보를 가리키는 관계다(app/group 참고).


def snapshot_current_items(db: Session, user_id) -> list[dict]:
    """지금 dashboard_items에 있는 내 관심 매물을 JSON 스냅샷으로 뜬다.

    공유 링크를 만들 때 이 스냅샷을 그대로 JSONB 컬럼에 저장한다. 순서는 저장한 순서다.
    """
    items = db.execute(
        select(DashboardItem).where(DashboardItem.user_id == user_id).order_by(*ITEM_ORDER)
    ).scalars().all()
    return [
        {
            "size_id": it.size_id,
            "list_price": it.list_price,
            "floor": it.floor,
            "dong": it.dong,
            "ho": it.ho,
            "direction": it.direction,
            "interior_state": it.interior_state,
            "checked": it.checked,
        }
        for it in items
    ]


def enrich_snapshot_items(db: Session, items: list[dict]) -> list[SnapshotItemWithInfo]:
    """공유 스냅샷 항목에 단지명·평형·시세 지표를 붙인다.

    get_items_with_metrics와 같은 조인이지만 출발점이 DashboardItem 행이
    아니라 JSON 스냅샷이라, size_id 목록으로 SizeMaster부터 직접 조인한다.
    (공유 링크는 만든 뒤에도 계속 남아 있는데, 그 사이 단지가
    size_master에서 사라졌을 수도 있어 outerjoin + 딕셔너리 조회로
    "정보 없음"도 자연스럽게 처리한다.)
    """
    size_ids = [it["size_id"] for it in items]
    if not size_ids:
        return []

    rows = db.execute(
        select(SizeMaster, ComplexMaster, ItemMetricsCache, RegulationZone)
        .outerjoin(ComplexMaster, ComplexMaster.id == SizeMaster.complex_id)
        .outerjoin(ItemMetricsCache, ItemMetricsCache.size_id == SizeMaster.id)
        .outerjoin(RegulationZone, RegulationZone.sgg_cd == ComplexMaster.sgg_cd)
        .where(SizeMaster.id.in_(size_ids))
    ).all()
    by_size_id = {
        size.id: (size, complex_, cache, zone) for size, complex_, cache, zone in rows
    }

    result = []
    for it in items:
        size, complex_, cache, zone = by_size_id.get(it["size_id"], (None, None, None, None))
        metrics = None
        if cache is not None:
            metrics = ItemMetrics(
                recent_median_price=to_won(cache.recent_median_price),
                min_price=to_won(cache.min_price),
                max_price=to_won(cache.max_price),
                price_per_pyeong=to_won(cache.price_per_pyeong),
                trade_count_3y=cache.trade_count_3y,
                last_trade_date=cache.last_trade_date,
                jeonse_ratio=float(cache.jeonse_ratio) if cache.jeonse_ratio is not None else None,
            )
        result.append(
            SnapshotItemWithInfo(
                **it,
                complex_name=complex_.apt_nm if complex_ else None,
                legal_dong_name=complex_.umd_nm if complex_ else None,
                build_year=complex_.build_year if complex_ else None,
                representative_area=float(size.representative_area)
                if size is not None and size.representative_area is not None
                else None,
                pyeong=size.pyeong if size else None,
                metrics=metrics,
                regulation=RegulationStatus(
                    is_speculation_overheated=bool(zone.is_speculation_overheated) if zone else False,
                    is_adjustment_target=bool(zone.is_adjustment_target) if zone else False,
                ),
            )
        )
    return result
