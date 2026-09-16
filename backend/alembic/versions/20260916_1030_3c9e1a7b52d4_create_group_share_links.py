"""create group_share_links

Revision ID: 3c9e1a7b52d4
Revises: d755235ab9bc
Create Date: 2026-09-16 10:30:00.000000

Phase 5 그룹 공유 링크(읽기 전용). app/group/model.py의 GroupShareLink 참고.

- group_share_links: 그룹 하나를 로그인 없이 보는 링크. 열 때마다 그 그룹의 지금 후보를 보여준다(스냅샷 아님).
- 토큰 원문은 저장하지 않고 SHA-256 hash(64자)만 UNIQUE로 저장한다. 원문은 만들 때 한 번만 응답한다.
- revoked_at이 있으면 공유를 중지한 링크다. 행은 지우지 않는다.
- group_id -> groups.id (ON DELETE CASCADE): 그룹을 지우면 링크도 지워진다.
- 공동 참여(allow_join, group_members)는 보류라 만들지 않는다.
- 기존 테이블은 건드리지 않는다. downgrade는 공유 링크만 지운다(이미 보낸 링크는 모두 끊긴다).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3c9e1a7b52d4'
down_revision: Union[str, Sequence[str], None] = 'd755235ab9bc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "group_share_links",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("group_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["group_id"], ["groups.id"],
            name="fk_group_share_links_group", ondelete="CASCADE",
        ),
        sa.UniqueConstraint("token_hash", name="uq_group_share_links_token_hash"),
    )
    op.create_index("ix_group_share_links_group_id", "group_share_links", ["group_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_group_share_links_group_id", table_name="group_share_links")
    op.drop_table("group_share_links")
