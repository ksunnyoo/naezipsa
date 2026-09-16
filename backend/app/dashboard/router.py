"""[dashboard] router — 후보 매물·대시보드 엔드포인트 (A-03~A-09).

흐름   main ▶ security ▶ deps ▶ ★router ▶ service ▶ model / schema
경로   /api/v1/dashboard, /api/v1/dashboard/items[/order|/{id}[/details|/status]]
소유   A

A-03~A-09: 후보 매물 CRUD와 대시보드 집계.

기획 규칙 세 가지를 서비스 계층에서 강제한다.

  1. 한 사용자당 최대 6개              -> 7번째 등록은 409로 차단
  2. 등록 필수값은 size_id 하나뿐      -> 나머지는 나중에 채울 수 있음
  3. 남의 후보는 조회·수정·삭제 불가   -> 모든 쿼리에 user_id 조건을 함께 건다
  4. 표시 순서는 사용자가 저장한 순서 -> 등록·삭제·순서 저장은 profiles 행 잠금으로 한 줄로 세운다

⚠️ user_id를 요청 body나 query로 절대 받지 않는다.
   받는 순간 "남의 id를 적어 보내면 남의 데이터가 보이는" 구멍이 된다.
   사용자 식별은 오직 검증된 토큰(get_current_profile)에서만 나온다.
   status도 마찬가지로 서버가 기본값을 정한다.

⚠️ 같은 단지·같은 평형이라도 동·호가 다르면 다른 후보이므로
   (user_id, size_id) 중복은 막지 않는다. 상한은 개수(6개)로만 건다.
"""
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.deps import get_current_profile
from app.core.database import get_db
from app.dashboard.model import MAX_DASHBOARD_ITEMS, DashboardItem, DashboardShare
from app.inspection.model import PropertyInspection
from app.dashboard.service import (
    ITEM_ORDER,
    enrich_snapshot_items,
    get_items_with_metrics,
    size_exists,
    snapshot_current_items,
)
from app.user.model import Profile
from app.dashboard.schema import (

    DashboardItemCreateRequest,
    DashboardItemListResponse,
    DashboardItemResponse,
    DashboardResponse,
    DashboardShareCreateResponse,
    DashboardShareResponse,
    ItemDeletedResponse,
    ItemDetailsRequest,
    ItemOrderRequest,
    ItemOrderResponse,
    ItemStatusRequest,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _my_items(db: Session, user_id):
    """내 후보 전체를 저장한 순서(sort_order, 같으면 등록순)로, 단지명·시세 지표까지 붙여서.

    지표를 붙이는 방법은 app/dashboard/service.py 참고.
    """
    return get_items_with_metrics(db, user_id)


def _get_owned_item(db: Session, user_id, item_id: int, *, lock: bool = False) -> DashboardItem:
    """내 후보 한 건. 없거나 남의 것이면 404.

    "없음"과 "남의 것"을 구분하지 않고 똑같이 404를 준다.
    구분해서 알려주면 "그 id는 존재한다"는 정보가 새어 나간다.
    """
    query = select(DashboardItem).where(
        DashboardItem.id == item_id,
        DashboardItem.user_id == user_id,
    )
    if lock:
        query = query.with_for_update()
    item = db.execute(query).scalar_one_or_none()

    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="해당 후보 매물을 찾을 수 없습니다.",
        )
    return item


def _lock_owner(db: Session, user_id) -> None:
    """같은 사용자의 후보 등록·삭제·순서 저장을 한 줄로 세운다.

    profiles 행을 FOR UPDATE로 잠가, 동시에 들어온 요청이 서로의 결과(후보 수·순번)를
    보지 못한 채 쓰는 일을 막는다. 잠금은 commit/rollback 때 풀린다.
    잠그는 순서는 항상 profiles → dashboard_items다.
    """
    db.execute(select(Profile.id).where(Profile.id == user_id).with_for_update())


# --- A-09: 첫 화면 집계 ----------------------------------------------------

@router.get("", response_model=DashboardResponse)
def get_dashboard(
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """A-09: 대시보드 첫 화면을 한 번의 호출로 구성.

    프로필 + 내 후보 + 각 후보의 단지명·평형·시세 지표를 한 번에 돌려준다.
    프론트가 후보마다 B의 API를 따로 부르지 않아도 되도록 만든 것이다.

    지표는 B가 미리 계산해 둔 item_metrics_cache에서 읽는다.
    B-03(평형 기본지표)과 같은 출처라 화면 간 숫자가 어긋나지 않는다.
    """
    items = _my_items(db, profile.id)
    return DashboardResponse(
        profile=profile,
        items=items,
        count=len(items),
        max_count=MAX_DASHBOARD_ITEMS,
    )


# --- A-03, A-04: 후보 등록 / 목록 ------------------------------------------

@router.get("/items", response_model=DashboardItemListResponse)
def list_items(
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """A-04: 내 후보 목록. 현재 로그인 사용자의 것만 나온다.

    각 후보에 단지명·평형·시세 지표가 함께 담긴다.
    아직 지표가 계산되지 않은 평형은 metrics가 null로 나간다.
    """
    items = _my_items(db, profile.id)
    return DashboardItemListResponse(
        items=items,
        count=len(items),
        max_count=MAX_DASHBOARD_ITEMS,
    )


@router.post("/items", response_model=DashboardItemResponse, status_code=status.HTTP_201_CREATED)
def create_item(
    payload: DashboardItemCreateRequest,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """A-03: 후보 등록. 필수값은 size_id 하나뿐이다.

    최대 6개 규칙은 DB 제약으로 표현할 수 없어서(개수 상한은 CHECK로 못 건다)
    여기서 세어 보고 막는다. 새 후보는 내 목록 맨 뒤 순번을 받는다.
    """
    # 같은 사용자의 등록이 동시에 들어와도 개수 상한과 순번이 어긋나지 않게 한 줄로 세운다.
    _lock_owner(db, profile.id)
    count = db.execute(
        select(func.count())
        .select_from(DashboardItem)
        .where(DashboardItem.user_id == profile.id)
    ).scalar_one()

    # DB에 외래키가 있어 없는 평형은 어차피 저장되지 않지만,
    # 그대로 두면 IntegrityError가 500으로 나가 원인을 알 수 없다.
    # 미리 확인해서 404로 알려준다.
    if not size_exists(db, payload.size_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"존재하지 않는 평형입니다. (size_id={payload.size_id})",
        )

    if count >= MAX_DASHBOARD_ITEMS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"후보 매물은 최대 {MAX_DASHBOARD_ITEMS}개까지 등록할 수 있습니다. "
                   "기존 후보를 삭제한 뒤 다시 시도해 주세요.",
        )

    # 새 후보는 내 목록 맨 뒤에 둔다. 빈 목록이면 0부터 시작한다.
    next_order = db.execute(
        select(func.coalesce(func.max(DashboardItem.sort_order) + 1, 0))
        .where(DashboardItem.user_id == profile.id)
    ).scalar_one()

    # status는 받지 않고 DB 기본값(considering)에 맡긴다.
    item = DashboardItem(user_id=profile.id, sort_order=next_order, **payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


# --- 정렬 순서 저장 (Phase 3 보완) ------------------------------------------
# 정적 경로라 /items/{item_id} 계열보다 먼저 선언한다.

@router.patch("/items/order", response_model=ItemOrderResponse)
def save_item_order(
    payload: ItemOrderRequest,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """내 전체 후보의 표시 순서를 한 번에 저장한다.

        {"item_ids": [11, 14, 13, 12], "expected_item_ids": [11, 12, 13, 14]}

    - 남의 후보나 없는 id가 item_ids에 섞이면 404(존재 여부를 드러내지 않는다).
    - 내 후보 일부가 빠졌거나 expected_item_ids가 지금 서버 순서와 다르면(다른 탭·기기에서
      목록이 바뀜) 아무것도 저장하지 않고 409. 프론트는 목록을 새로 불러온다.
    - 순번만 바꾼다. checked·호가·메모·그룹 관계·임장 기록은 건드리지 않는다.
    """
    _lock_owner(db, profile.id)
    current = db.execute(
        select(DashboardItem.id, DashboardItem.sort_order)
        .where(DashboardItem.user_id == profile.id)
        .order_by(*ITEM_ORDER)
    ).all()
    current_ids = [item_id for item_id, _ in current]

    if not set(payload.item_ids) <= set(current_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="해당 후보 매물을 찾을 수 없습니다.",
        )
    if len(payload.item_ids) != len(current_ids) or payload.expected_item_ids != current_ids:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="다른 곳에서 관심 매물 목록이 바뀌었습니다. 목록을 새로 불러온 뒤 다시 시도해 주세요.",
        )

    saved_order = dict(current)
    for position, item_id in enumerate(payload.item_ids):
        if saved_order[item_id] != position:
            db.execute(
                update(DashboardItem)
                .where(DashboardItem.id == item_id, DashboardItem.user_id == profile.id)
                .values(sort_order=position)
            )
    db.commit()
    return ItemOrderResponse(item_ids=payload.item_ids)


# --- A-05: 상세 -----------------------------------------------------------

@router.get("/items/{item_id}", response_model=DashboardItemResponse)
def get_item(
    item_id: int,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """A-05: 후보 상세. 선택정보가 비어 있으면 null로 나간다."""
    return _get_owned_item(db, profile.id, item_id)


# --- A-06: 선택 매물정보 수정 ----------------------------------------------

@router.patch("/items/{item_id}/details", response_model=DashboardItemResponse)
def update_item_details(
    item_id: int,
    payload: ItemDetailsRequest,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """A-06: 선택 매물정보 수정. 보낸 필드만 바꾼다.

        {"list_price": 1320000000}   -> 호가만 입력 (단위: 원)
        {"dong": "105", "ho": "1203"} -> 동/호만 입력
        {"memo": null}               -> 메모 삭제

    size_id와 status는 여기서 바꿀 수 없다.
    size_id를 바꾸는 것은 수정이 아니라 "지우고 새로 담기"이고,
    status는 A-07 전용 엔드포인트에서 다룬다.
    """
    item = _get_owned_item(db, profile.id, item_id)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)

    db.commit()
    db.refresh(item)
    return item


# --- A-07: 상태 변경 -------------------------------------------------------

@router.patch("/items/{item_id}/status", response_model=DashboardItemResponse)
def update_item_status(
    item_id: int,
    payload: ItemStatusRequest,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """A-07: 후보 상태 변경 (considering / interested / excluded).

    상태만 바꾼다. 표시 순서는 PATCH /dashboard/items/order 에서 저장한다.
    """
    item = _get_owned_item(db, profile.id, item_id)
    item.status = payload.status
    db.commit()
    db.refresh(item)
    return item


# --- A-08: 삭제 -----------------------------------------------------------

@router.delete("/items/{item_id}", response_model=ItemDeletedResponse)
def delete_item(
    item_id: int,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """A-08: 후보 삭제. 남의 후보 id를 찍어 보내도 404가 나고 지워지지 않는다.

    삭제로 생긴 빈 순번은 그대로 둔다(남은 후보의 상대 순서는 유지된다).
    """
    _lock_owner(db, profile.id)
    item = _get_owned_item(db, profile.id, item_id, lock=True)
    if db.scalar(select(PropertyInspection.id).where(
        PropertyInspection.property_id == item.id
    ).limit(1)) is not None:
        raise HTTPException(
            status_code=409,
            detail="임장 기록이 있는 후보 매물은 삭제할 수 없습니다. 제외 상태로 변경해 주세요.",
        )
    db.delete(item)
    db.commit()
    return ItemDeletedResponse(deleted_id=item_id)


# --- 공유 --------------------------------------------------------------
#
# 공유 링크는 "그 시점의 관심 매물"을 로그인 없이도 볼 수 있게 토큰 하나로
# 공개하는 스냅샷이다. 만든 사람만 만들 수 있지만(로그인 필요), 열람은
# 누구나 가능해야 링크 전달이라는 목적에 맞으므로 조회 엔드포인트에는
# get_current_profile을 걸지 않는다.

@router.post("/shares", response_model=DashboardShareCreateResponse, status_code=status.HTTP_201_CREATED)
def create_share(
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """지금 관심 매물로 공유 링크(토큰)를 만든다. URL 조립은 프론트가 한다."""
    items = snapshot_current_items(db, profile.id)
    if not items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="공유할 관심 매물이 없습니다. 먼저 매물을 추가해 주세요.",
        )

    # 추측 불가능한 랜덤 토큰. 순차 id를 그대로 노출하면 1,2,3... 순회로
    # 남의 공유를 엿볼 수 있어서 별도 컬럼으로 둔다.
    token = secrets.token_urlsafe(12)
    share = DashboardShare(token=token, owner_user_id=profile.id, items=items)
    db.add(share)
    db.commit()
    return DashboardShareCreateResponse(token=token)


@router.get("/shares/{token}", response_model=DashboardShareResponse)
def get_share(token: str, db: Session = Depends(get_db)):
    """공유 링크 미리보기. 로그인 불필요 - 링크만 있으면 누구나 조회 가능."""
    share = db.execute(
        select(DashboardShare).where(DashboardShare.token == token)
    ).scalar_one_or_none()
    if share is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="존재하지 않거나 만료된 공유 링크입니다.",
        )

    items = enrich_snapshot_items(db, share.items)
    return DashboardShareResponse(items=items, count=len(items))
