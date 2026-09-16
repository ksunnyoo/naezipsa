"""[A] group · service — 그룹 DB 로직 (Phase 4).

흐름   router ▶ ★service ▶ model
소유   A

모든 조회·변경은 "내 그룹"과 "내 후보"로 한정한다(IDOR 방지). 남의 그룹이나 후보는
없는 것과 똑같이 취급해 존재 여부를 드러내지 않는다.

어떤 함수도 dashboard_items를 지우거나 새로 만들지 않는다. 그룹이 바뀌어도 후보 id는 그대로다.

공유 링크 열람(shared_group)만 로그인 없이 토큰으로 그룹을 찾는다. 이때도 그 토큰이 가리키는
그룹의 group_items에서만 출발하고, 아무것도 쓰지 않는다.
"""
import hashlib
import secrets

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dashboard.model import DashboardItem
from app.dashboard.service import get_items_with_metrics
from app.group.model import (
    MAX_ACTIVE_SHARE_LINKS_PER_GROUP,
    MAX_GROUPS_PER_USER,
    Group,
    GroupItem,
    GroupShareLink,
)

# 공유 토큰 원문 길이 상한. 이보다 긴 값은 hash를 계산하지 않고 없는 링크로 본다.
_MAX_SHARE_TOKEN_LENGTH = 128


class GroupNotFound(Exception):
    """없거나 남의 그룹."""


class CandidateNotFound(Exception):
    """없거나 남의 후보, 또는 그룹에 들어 있지 않은 후보."""


class GroupLimitReached(Exception):
    """그룹 수 상한."""


class DuplicateGroupItem(Exception):
    """이미 그 그룹에 들어 있는 후보."""


class ShareLinkLimitReached(Exception):
    """그룹 하나에 살아 있는 공유 링크 수 상한."""


class ShareLinkNotFound(Exception):
    """없거나 공유를 중지한 링크."""


def _owned_group(db: Session, user_id, group_id: int, *, lock: bool = False) -> Group:
    query = select(Group).where(Group.id == group_id, Group.owner_user_id == user_id)
    if lock:
        # 같은 그룹에 동시에 후보를 넣는 요청을 줄 세운다(중복 검사와 삽입 사이의 경쟁 방지).
        query = query.with_for_update()
    group = db.execute(query).scalar_one_or_none()
    if group is None:
        raise GroupNotFound()
    return group


def _require_owned_items(db: Session, user_id, item_ids: list[int]) -> None:
    if not item_ids:
        return
    owned = set(db.execute(
        select(DashboardItem.id).where(
            DashboardItem.user_id == user_id, DashboardItem.id.in_(item_ids)
        )
    ).scalars())
    if owned != set(item_ids):
        raise CandidateNotFound()


def _member_ids(db: Session, group_id: int) -> set[int]:
    return set(db.execute(
        select(GroupItem.dashboard_item_id).where(GroupItem.group_id == group_id)
    ).scalars())


def _add_members(db: Session, group: Group, item_ids: list[int]) -> None:
    db.add_all(GroupItem(group_id=group.id, dashboard_item_id=item_id) for item_id in item_ids)


def _active_link_count_query(group_id):
    return select(func.count()).select_from(GroupShareLink).where(
        GroupShareLink.group_id == group_id, GroupShareLink.revoked_at.is_(None)
    )


def list_groups(db: Session, user_id) -> list[tuple[Group, int, int]]:
    """(그룹, 후보 수, 살아 있는 공유 링크 수). 링크 수는 하위 쿼리로 세어 후보 수가 부풀지 않게 한다."""
    share_count = _active_link_count_query(Group.id).scalar_subquery()
    rows = db.execute(
        select(Group, func.count(GroupItem.dashboard_item_id), share_count)
        .outerjoin(GroupItem, GroupItem.group_id == Group.id)
        .where(Group.owner_user_id == user_id)
        .group_by(Group.id)
        .order_by(Group.created_at, Group.id)
    ).all()
    return [(group, count, links) for group, count, links in rows]


def active_share_link_count(db: Session, group_id: int) -> int:
    return db.execute(_active_link_count_query(group_id)).scalar_one()


def get_group(db: Session, user_id, group_id: int) -> Group:
    return _owned_group(db, user_id, group_id)


def group_detail(db: Session, user_id, group: Group) -> tuple[list[int], list]:
    """그룹 후보 id와 후보 정보(단지명·지표 포함)를 내 전체 후보 순서대로 돌려준다.

    그룹별 순서는 따로 두지 않는다. 전체 후보에서 저장한 순서(sort_order)에서 그룹 후보만
    남긴다(docs/ordering-and-sharing-design.md 3.1).
    """
    member_ids = _member_ids(db, group.id)
    items = [item for item in get_items_with_metrics(db, user_id) if item.id in member_ids]
    return [item.id for item in items], items


def create_group(db: Session, user_id, name: str, item_ids: list[int]) -> Group:
    # 후보 등록(최대 6개)과 같은 방식으로 세어 보고 막는다.
    count = db.execute(
        select(func.count()).select_from(Group).where(Group.owner_user_id == user_id)
    ).scalar_one()
    if count >= MAX_GROUPS_PER_USER:
        raise GroupLimitReached()
    _require_owned_items(db, user_id, item_ids)

    group = Group(owner_user_id=user_id, name=name)
    db.add(group)
    db.flush()  # group.id 확보
    _add_members(db, group, item_ids)
    db.commit()
    db.refresh(group)
    return group


def rename_group(db: Session, user_id, group_id: int, name: str) -> Group:
    group = _owned_group(db, user_id, group_id)
    group.name = name
    db.commit()
    db.refresh(group)
    return group


def delete_group(db: Session, user_id, group_id: int) -> None:
    group = _owned_group(db, user_id, group_id)
    # 외래키 CASCADE가 없는 환경에서도 관계가 남지 않게 먼저 지운다. 후보(dashboard_items)는 건드리지 않는다.
    db.execute(delete(GroupItem).where(GroupItem.group_id == group.id))
    db.execute(delete(GroupShareLink).where(GroupShareLink.group_id == group.id))
    db.delete(group)
    db.commit()


def add_items(db: Session, user_id, group_id: int, item_ids: list[int]) -> Group:
    group = _owned_group(db, user_id, group_id, lock=True)
    _require_owned_items(db, user_id, item_ids)

    already = db.execute(
        select(GroupItem.dashboard_item_id).where(
            GroupItem.group_id == group.id, GroupItem.dashboard_item_id.in_(item_ids)
        )
    ).first()
    if already is not None:
        raise DuplicateGroupItem()

    _add_members(db, group, item_ids)
    group.updated_at = func.now()
    try:
        db.commit()
    except IntegrityError:
        # 검사와 삽입 사이에 다른 요청이 같은 후보를 먼저 넣은 경우. 복합 PK가 최종적으로 막는다.
        db.rollback()
        raise DuplicateGroupItem()
    db.refresh(group)
    return group


def remove_item(db: Session, user_id, group_id: int, item_id: int) -> Group:
    group = _owned_group(db, user_id, group_id)
    result = db.execute(
        delete(GroupItem).where(
            GroupItem.group_id == group.id, GroupItem.dashboard_item_id == item_id
        )
    )
    if result.rowcount == 0:
        db.rollback()
        raise CandidateNotFound()
    group.updated_at = func.now()
    db.commit()
    db.refresh(group)
    return group


# --- 공유 링크 (Phase 5) ----------------------------------------------------


def hash_share_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_share_link(db: Session, user_id, group_id: int) -> tuple[GroupShareLink, str]:
    """그룹 공유 링크를 새로 만든다. 토큰 원문은 돌려주기만 하고 저장하지 않는다."""
    # 동시에 여러 번 눌러도 상한 검사와 삽입이 한 줄로 서게 그룹 행을 잠근다.
    group = _owned_group(db, user_id, group_id, lock=True)
    if active_share_link_count(db, group.id) >= MAX_ACTIVE_SHARE_LINKS_PER_GROUP:
        raise ShareLinkLimitReached()
    token = secrets.token_urlsafe(24)
    link = GroupShareLink(group_id=group.id, token_hash=hash_share_token(token))
    db.add(link)
    db.commit()
    db.refresh(link)
    return link, token


def revoke_share_links(db: Session, user_id, group_id: int) -> int:
    """이 그룹의 살아 있는 공유 링크를 모두 끊고, 끊은 수를 돌려준다."""
    group = _owned_group(db, user_id, group_id, lock=True)
    result = db.execute(
        update(GroupShareLink)
        .where(GroupShareLink.group_id == group.id, GroupShareLink.revoked_at.is_(None))
        .values(revoked_at=func.now())
        .execution_options(synchronize_session=False)
    )
    db.commit()
    return result.rowcount


def shared_group(db: Session, token: str) -> tuple[Group, list]:
    """공유 링크로 그룹과 그 후보를 찾는다(로그인 불필요, 읽기만 한다).

    후보는 그룹 주인의 전체 후보 순서에서 이 그룹 후보만 남긴 것이다(group_detail과 같다).
    """
    if not token or len(token) > _MAX_SHARE_TOKEN_LENGTH:
        raise ShareLinkNotFound()
    group = db.execute(
        select(Group)
        .join(GroupShareLink, GroupShareLink.group_id == Group.id)
        .where(
            GroupShareLink.token_hash == hash_share_token(token),
            GroupShareLink.revoked_at.is_(None),
        )
    ).scalar_one_or_none()
    if group is None:
        raise ShareLinkNotFound()
    _, items = group_detail(db, group.owner_user_id, group)
    return group, items
