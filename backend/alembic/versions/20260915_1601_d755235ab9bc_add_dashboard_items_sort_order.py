"""add dashboard_items sort_order

Revision ID: d755235ab9bc
Revises: ff9db2ef90e4
Create Date: 2026-09-15 16:01:47.632231

정렬 순서 저장(Phase 3 보완, docs/ordering-and-sharing-design.md 3장).

- dashboard_items.sort_order: 사용자가 드래그로 정한 표시 순서(0부터). 서버만 쓴다.
- 기존 후보는 사용자별 등록순(created_at, id)으로 0부터 번호를 매긴다.
- NOT NULL + CHECK(sort_order >= 0) + (user_id, sort_order, id) 인덱스.
  순번을 서로 바꾸는 중 잠깐 겹칠 수 있어 (user_id, sort_order) UNIQUE는 두지 않는다.
- DB 기본값 0: 이 컬럼을 모르는 이전 서버가 후보를 등록해도 실패하지 않게 한다.
  다만 그 후보는 맨 앞(0)에 놓이므로, 적용 후에는 새 서버로 함께 교체한다.
- downgrade는 정렬 정보만 지운다. 후보·그룹 관계·임장 기록은 그대로다.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd755235ab9bc'
down_revision: Union[str, Sequence[str], None] = 'ff9db2ef90e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# 기존 후보에 사용자별 등록순으로 0부터 번호를 매긴다(PostgreSQL과 테스트용 SQLite 모두 동작).
BACKFILL_SQL = """
UPDATE dashboard_items
SET sort_order = ranked.position
FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, id) - 1 AS position
    FROM dashboard_items
) AS ranked
WHERE dashboard_items.id = ranked.id
"""


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("dashboard_items", sa.Column("sort_order", sa.Integer(), nullable=True))
    op.execute(BACKFILL_SQL)
    op.alter_column(
        "dashboard_items", "sort_order",
        existing_type=sa.Integer(), nullable=False, server_default=sa.text("0"),
    )
    op.create_check_constraint("ck_dashboard_items_sort_order", "dashboard_items", "sort_order >= 0")
    op.create_index("ix_dashboard_items_user_sort", "dashboard_items", ["user_id", "sort_order", "id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_dashboard_items_user_sort", table_name="dashboard_items")
    op.drop_constraint("ck_dashboard_items_sort_order", "dashboard_items", type_="check")
    op.drop_column("dashboard_items", "sort_order")
