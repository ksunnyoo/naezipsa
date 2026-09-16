from fastapi import APIRouter, Query
from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.database import get_db
from app.core.security import CurrentUser, get_current_user
from app.dashboard.model import DashboardItem
from app.property.model import ComplexMaster, SizeMaster
from app.subscription.regions import group_announcements, preferred_regions_from_codes


from app.core.errors import error_response

from app.subscription import fetch_recent_announcements, SubscriptionFetchError

from app.subscription.cheongyak_home import fetch_categorized_announcements

router = APIRouter(prefix="/subscription", tags=["subscription"])


@router.get("", summary="청약 소식 목록 조회")
def get_subscription_news(
    categorized: bool = Query(default=False),
    region: str | None = Query(default=None, max_length=20),
    limit: int = Query(default=4, ge=1, le=400),
):
    try:
        fetcher = fetch_categorized_announcements if categorized else fetch_recent_announcements
        items = fetcher(region=region, limit=limit)
    except SubscriptionFetchError as exc:
        return error_response(
            exc.status_code,
            str(exc),
            details={
                "source": "applyhome",
                "reason": exc.reason,
                "retryable": exc.retryable,
            },
        )

    # 정상 조회 결과가 없으면 404가 아닌 200 + 빈 목록을 반환한다.
    # 외부 API 장애/잘못된 응답은 위에서 오류 상태와 사유로 전달한다.
    return {"status": "success", "count": len(items), "data": items}


# 기존 공개 목록은 유지하고 관심 매물 정렬은 인증된 별도 경로로 제공한다.


@router.get("/personalized", summary="내 관심 지역 우선 청약 유형·지역별 목록")
def get_personalized_subscription(
    limit_per_region: int = Query(default=3, ge=1, le=30),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        user_id = UUID(user.id)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="사용자 식별자가 올바르지 않습니다.") from exc
    codes = db.execute(
        select(ComplexMaster.sgg_cd)
        .select_from(DashboardItem)
        .join(SizeMaster, SizeMaster.id == DashboardItem.size_id)
        .join(ComplexMaster, ComplexMaster.id == SizeMaster.complex_id)
        .where(DashboardItem.user_id == user_id)
        .order_by(DashboardItem.created_at, DashboardItem.id)
    ).scalars().all()
    preferred = preferred_regions_from_codes(codes)
    try:
        # 지역 정렬 전에 전체 limit으로 자르면 관심 지역이 누락될 수 있다.
        items = fetch_categorized_announcements(limit=None)
    except SubscriptionFetchError as exc:
        return error_response(exc.status_code, str(exc), details={
            "source": "applyhome", "reason": exc.reason, "retryable": exc.retryable,
        })
    return group_announcements(items, preferred, limit_per_region)


@router.get("/nearby", summary="화면 최상위 매물의 지역 기준 청약 목록")
def get_nearby_subscription(
    size_id: int = Query(ge=1),
    limit_per_region: int = Query(default=30, ge=1, le=30),
    db: Session = Depends(get_db),
    exclude_closed: bool = False,
):
    # 공개 단지·평형 정보만 조회한다. 사용자나 비공개 관심 매물 정보는 조회하지 않는다.
    code = db.execute(
        select(ComplexMaster.sgg_cd)
        .select_from(SizeMaster)
        .join(ComplexMaster, ComplexMaster.id == SizeMaster.complex_id)
        .where(SizeMaster.id == size_id)
    ).scalar_one_or_none()
    if code is None:
        raise HTTPException(status_code=404, detail="기준 매물의 지역 정보를 찾을 수 없습니다.")
    preferred = preferred_regions_from_codes([code])
    if not preferred:
        raise HTTPException(status_code=422, detail="기준 매물의 지역 코드를 확인할 수 없습니다.")
    # DB 조회는 여기서 끝난다. 아래 청약홈 API를 기다리는 동안 트랜잭션을 열어두면
    # DB 연결을 쥔 채 기다리게 되므로 먼저 끝낸다.
    db.commit()
    try:
        items = fetch_categorized_announcements(limit=None)
    except SubscriptionFetchError as exc:
        return error_response(exc.status_code, str(exc), details={
            "source": "applyhome", "reason": exc.reason, "retryable": exc.retryable,
        })
    if exclude_closed:
        items = [item for item in items if item.get("receipt_status") in ("upcoming", "open")]
    result = group_announcements(items, preferred, limit_per_region)
    result["reference_size_id"] = size_id
    return result
