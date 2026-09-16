"""[A] group · router — 후보 매물 그룹 API (Phase 4, 공유 링크 Phase 5).

흐름   main ▶ ★router ▶ service ▶ model
소유   A

그룹은 기존 후보(dashboard_items)를 가리키기만 한다. 어떤 요청도 후보를 지우거나 다시
만들지 않으므로 후보 id가 유지된다(app/group/model.py 참고).

    GET    /api/v1/groups                           내 그룹 목록
    POST   /api/v1/groups                           그룹 만들기 (item_ids 선택)
    GET    /api/v1/groups/{group_id}                그룹 상세
    PATCH  /api/v1/groups/{group_id}                이름 변경
    DELETE /api/v1/groups/{group_id}                그룹 삭제 (후보는 그대로)
    POST   /api/v1/groups/{group_id}/items          기존 그룹에 내 후보 추가
    DELETE /api/v1/groups/{group_id}/items/{item_id}  그룹에서 빼기 (후보는 그대로)
    POST   /api/v1/groups/{group_id}/share-links    공유 링크 만들기 (그룹 주인만)
    DELETE /api/v1/groups/{group_id}/share-links    공유 중지 (이 그룹 링크 모두 끊기)
    GET    /api/v1/shared/groups/{token}            공유 링크 열람 (로그인 불필요, 읽기 전용)

"기존 그룹의 후보로 새 그룹 만들기"는 전용 API 없이, 그룹 상세의 item_ids를 POST에 넘긴다.
"""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_profile
from app.group import service
from app.group.model import MAX_ACTIVE_SHARE_LINKS_PER_GROUP, MAX_GROUPS_PER_USER, Group
from app.group.schema import (
    GroupCreateRequest,
    GroupDeletedResponse,
    GroupDetailResponse,
    GroupItemsAddRequest,
    GroupListResponse,
    GroupRenameRequest,
    GroupShareLinkCreatedResponse,
    GroupShareLinksRevokedResponse,
    GroupSummary,
    SharedGroupItem,
    SharedGroupResponse,
)
from app.user.model import Profile

router = APIRouter(prefix="/groups", tags=["groups"])
# 공유 링크 열람은 로그인 없이 쓰므로 경로와 라우터를 따로 둔다.
shared_router = APIRouter(prefix="/shared/groups", tags=["shared"])

_GROUP_NOT_FOUND = "해당 그룹을 찾을 수 없습니다."
_CANDIDATE_NOT_FOUND = "해당 후보 매물을 찾을 수 없습니다."
_SHARE_LINK_NOT_FOUND = "존재하지 않거나 공유가 중지된 링크입니다."


def _not_found(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def _detail(db: Session, profile: Profile, group: Group) -> GroupDetailResponse:
    item_ids, items = service.group_detail(db, profile.id, group)
    return GroupDetailResponse(
        id=group.id,
        name=group.name,
        item_count=len(item_ids),
        created_at=group.created_at,
        updated_at=group.updated_at,
        share_link_count=service.active_share_link_count(db, group.id),
        item_ids=item_ids,
        items=items,
    )


@router.get("", response_model=GroupListResponse)
def list_groups(
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    rows = service.list_groups(db, profile.id)
    groups = [
        GroupSummary(
            id=group.id, name=group.name, item_count=count,
            created_at=group.created_at, updated_at=group.updated_at,
            share_link_count=share_count,
        )
        for group, count, share_count in rows
    ]
    return GroupListResponse(groups=groups, count=len(groups), max_count=MAX_GROUPS_PER_USER)


@router.post("", response_model=GroupDetailResponse, status_code=status.HTTP_201_CREATED)
def create_group(
    payload: GroupCreateRequest,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    try:
        group = service.create_group(db, profile.id, payload.name, payload.item_ids)
    except service.GroupLimitReached:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"그룹은 최대 {MAX_GROUPS_PER_USER}개까지 만들 수 있습니다. 기존 그룹을 삭제한 뒤 다시 시도해 주세요.",
        )
    except service.CandidateNotFound:
        raise _not_found(_CANDIDATE_NOT_FOUND)
    return _detail(db, profile, group)


@router.get("/{group_id}", response_model=GroupDetailResponse)
def get_group(
    group_id: int,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    try:
        group = service.get_group(db, profile.id, group_id)
    except service.GroupNotFound:
        raise _not_found(_GROUP_NOT_FOUND)
    return _detail(db, profile, group)


@router.patch("/{group_id}", response_model=GroupDetailResponse)
def rename_group(
    group_id: int,
    payload: GroupRenameRequest,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    try:
        group = service.rename_group(db, profile.id, group_id, payload.name)
    except service.GroupNotFound:
        raise _not_found(_GROUP_NOT_FOUND)
    return _detail(db, profile, group)


@router.delete("/{group_id}", response_model=GroupDeletedResponse)
def delete_group(
    group_id: int,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    try:
        service.delete_group(db, profile.id, group_id)
    except service.GroupNotFound:
        raise _not_found(_GROUP_NOT_FOUND)
    return GroupDeletedResponse(deleted_id=group_id)


@router.post("/{group_id}/items", response_model=GroupDetailResponse)
def add_group_items(
    group_id: int,
    payload: GroupItemsAddRequest,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    try:
        group = service.add_items(db, profile.id, group_id, payload.item_ids)
    except service.GroupNotFound:
        raise _not_found(_GROUP_NOT_FOUND)
    except service.CandidateNotFound:
        raise _not_found(_CANDIDATE_NOT_FOUND)
    except service.DuplicateGroupItem:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="이미 이 그룹에 있는 후보가 포함되어 있습니다.",
        )
    return _detail(db, profile, group)


@router.delete("/{group_id}/items/{item_id}", response_model=GroupDetailResponse)
def remove_group_item(
    group_id: int,
    item_id: int,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    try:
        group = service.remove_item(db, profile.id, group_id, item_id)
    except service.GroupNotFound:
        raise _not_found(_GROUP_NOT_FOUND)
    except service.CandidateNotFound:
        raise _not_found(_CANDIDATE_NOT_FOUND)
    return _detail(db, profile, group)


# --- 공유 링크 (Phase 5) ----------------------------------------------------
#
# 링크는 그룹 주인만 만들고 끊는다. 받은 사람은 로그인 없이 그 그룹의 지금 후보를 본다(shared_router).
# 링크를 열어도 후보를 복사하거나 그룹에 참여시키지 않는다. 공동 참여는 보류다.


@router.post(
    "/{group_id}/share-links",
    response_model=GroupShareLinkCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_share_link(
    group_id: int,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """공유 링크 만들기. token은 이 응답에서만 받을 수 있다(서버에는 hash만 남는다)."""
    try:
        link, token = service.create_share_link(db, profile.id, group_id)
    except service.GroupNotFound:
        raise _not_found(_GROUP_NOT_FOUND)
    except service.ShareLinkLimitReached:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"이 그룹의 공유 링크가 너무 많습니다(최대 {MAX_ACTIVE_SHARE_LINKS_PER_GROUP}개). 공유를 중지한 뒤 다시 만들어 주세요.",
        )
    return GroupShareLinkCreatedResponse(id=link.id, token=token, created_at=link.created_at)


@router.delete("/{group_id}/share-links", response_model=GroupShareLinksRevokedResponse)
def revoke_share_links(
    group_id: int,
    profile: Profile = Depends(get_current_profile),
    db: Session = Depends(get_db),
):
    """공유 중지. 이 그룹으로 만든 링크를 모두 끊는다. 여러 번 보내도 결과가 같다."""
    try:
        revoked = service.revoke_share_links(db, profile.id, group_id)
    except service.GroupNotFound:
        raise _not_found(_GROUP_NOT_FOUND)
    return GroupShareLinksRevokedResponse(revoked_count=revoked)


@shared_router.get("/{token}", response_model=SharedGroupResponse)
def get_shared_group(token: str, response: Response, db: Session = Depends(get_db)):
    """공유 링크 열람. 로그인 불필요.

    get_current_profile을 걸지 않으므로 링크를 열어도 프로필이 만들어지지 않는다.
    공개 필드는 SharedGroupItem에 적힌 것뿐이다(메모·상태·체크·계정 정보 제외).
    """
    # 공유를 중지하면 바로 보이지 않아야 하므로 브라우저·중간 캐시에 남기지 않는다.
    response.headers["Cache-Control"] = "no-store"
    try:
        group, items = service.shared_group(db, token)
    except service.ShareLinkNotFound:
        raise _not_found(_SHARE_LINK_NOT_FOUND)
    public_fields = set(SharedGroupItem.model_fields)
    shared = [SharedGroupItem.model_validate(item.model_dump(include=public_fields)) for item in items]
    return SharedGroupResponse(name=group.name, items=shared, count=len(shared))
