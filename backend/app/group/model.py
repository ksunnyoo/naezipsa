"""[A] group · model — 후보 매물 그룹 (Phase 4).

흐름   router ▶ service ▶ ★model
소유   A

그룹은 기존 dashboard_items를 "가리키기만" 한다. 후보를 복사하거나 지우고 다시
만들지 않으므로 후보 id가 바뀌지 않고, 임장 기록처럼 후보에 연결된 데이터가 끊기지 않는다.

  - 그룹 삭제        -> group_items만 지워진다. 후보는 그대로.
  - 그룹에서 빼기    -> group_items 한 행만 지운다. 후보는 그대로.
  - 후보 삭제        -> 그 후보가 들어 있던 group_items가 함께 지워진다(ON DELETE CASCADE).
  - 같은 후보는 여러 그룹에 들어갈 수 있고, 한 그룹에는 한 번만 들어간다(복합 PK).
  - 그룹 안에 그룹을 넣지 않는다(group_items는 dashboard_items만 참조한다).

후보는 그 후보의 주인만 그룹에 넣을 수 있으므로 "누가 넣었는지"는 dashboard_items.user_id로
알 수 있다. 그래서 group_items에 별도 컬럼을 두지 않는다.

groups.owner_user_id -> profiles.id 외래키는 dashboard_items.user_id와 같은 방식으로
모델에 선언하지 않고 마이그레이션에서 직접 만든다(alembic/env.py의 HAND_MANAGED_CONSTRAINTS 참고).

그룹 공유 링크(Phase 5, group_share_links)는 로그인 없이 그룹 하나를 읽기 전용으로 보여준다.

  - 링크를 열 때마다 그 그룹의 지금 후보를 읽는다(스냅샷 아님).
  - 토큰 원문은 저장하지 않고 SHA-256 hash만 저장한다. 원문은 만들 때 한 번만 응답한다.
  - 공유 중지는 행을 지우지 않고 revoked_at만 채운다. 그룹을 지우면 링크도 지워진다(CASCADE).
  - 링크를 열어도 후보를 복사하거나 그룹에 참여시키지 않는다. 공동 참여는 보류다.
"""
from sqlalchemy import (
    BigInteger, Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, Uuid, func,
)

from app.core.database import Base

# 한 사용자가 만들 수 있는 그룹 수. 기존 화면의 그룹 목록(한 줄 4개 x 2줄)과 같게 둔다.
MAX_GROUPS_PER_USER = 8
MAX_GROUP_NAME_LENGTH = 30
# 그룹 하나에 동시에 살아 있는 공유 링크 수. 공유할 때마다 새 링크를 만들므로 끝없이 쌓이지 않게 막는다.
MAX_ACTIVE_SHARE_LINKS_PER_GROUP = 20


class Group(Base):
    __tablename__ = "groups"
    __table_args__ = (
        Index("ix_groups_owner_user_id", "owner_user_id"),
    )

    # SQLite(테스트)는 INTEGER PRIMARY KEY만 자동 증가하므로 변형 타입을 둔다.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    owner_user_id = Column(Uuid(as_uuid=True), nullable=False)
    name = Column(String(MAX_GROUP_NAME_LENGTH), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class GroupItem(Base):
    __tablename__ = "group_items"
    __table_args__ = (
        # "이 후보가 어느 그룹에 들어 있나" 역조회용. (group_id, dashboard_item_id) 방향은 PK가 맡는다.
        Index("ix_group_items_dashboard_item_id", "dashboard_item_id"),
    )

    group_id = Column(
        BigInteger,
        ForeignKey("groups.id", name="fk_group_items_group", ondelete="CASCADE"),
        primary_key=True,
    )
    dashboard_item_id = Column(
        BigInteger,
        ForeignKey("dashboard_items.id", name="fk_group_items_dashboard_item", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class GroupShareLink(Base):
    """그룹 공유 링크 하나. 링크를 가진 사람은 로그인 없이 그 그룹을 읽기만 한다."""

    __tablename__ = "group_share_links"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_group_share_links_token_hash"),
        Index("ix_group_share_links_group_id", "group_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    group_id = Column(
        BigInteger,
        ForeignKey("groups.id", name="fk_group_share_links_group", ondelete="CASCADE"),
        nullable=False,
    )
    # 토큰 원문의 SHA-256 hex. DB 값이 새어도 이 값으로는 링크를 열 수 없다.
    token_hash = Column(String(64), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    # 공유를 중지한 시각. 값이 있으면 이 링크로는 더 이상 볼 수 없다.
    revoked_at = Column(DateTime(timezone=True), nullable=True)
