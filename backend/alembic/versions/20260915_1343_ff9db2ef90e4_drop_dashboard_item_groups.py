"""drop dashboard_item_groups

Revision ID: ff9db2ef90e4
Revises: 16bbbf4cc3a5
Create Date: 2026-09-15 13:43:31.576563

PR #12의 스냅샷 그룹 테이블을 지운다. Phase 4에서 그룹이 groups/group_items(기존 후보를
가리키는 관계)로 바뀌어 앱이 더 이상 읽지 않는다. 남은 행은 사용자 결정(2026-09-15)에 따라
새 구조로 옮기지 않고 버린다. 스냅샷에는 원본 후보 id가 없어 자동으로 옮길 수 없다.

적용 시점: 이 테이블을 읽는 옛 그룹 코드가 main에서 빠진 뒤(PR #13 머지 후)에 적용한다.
그 전에 적용하면 main을 실행 중인 화면의 그룹 목록 조회가 500이 된다.

downgrade는 빈 테이블 구조만 되살린다. 지운 데이터는 돌아오지 않는다.
dashboard_shares(공유 링크)는 계속 쓰므로 건드리지 않는다.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'ff9db2ef90e4'
down_revision: Union[str, Sequence[str], None] = '16bbbf4cc3a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_index("ix_dashboard_item_groups_user_id", table_name="dashboard_item_groups")
    op.drop_table("dashboard_item_groups")


def downgrade() -> None:
    """Downgrade schema. 667be58b68d8과 같은 구조의 빈 테이블을 다시 만든다."""
    op.create_table(
        "dashboard_item_groups",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=30), nullable=False),
        sa.Column("items", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_dashboard_item_groups_user_id", "dashboard_item_groups", ["user_id"], unique=False
    )
