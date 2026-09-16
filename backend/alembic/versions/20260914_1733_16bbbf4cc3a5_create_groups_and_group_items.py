"""create groups and group_items

Revision ID: 16bbbf4cc3a5
Revises: b449723601b1
Create Date: 2026-09-14 17:33:34.620674

Phase 4 후보 그룹. 그룹은 기존 dashboard_items를 가리키기만 한다(app/group/model.py 참고).

- groups.owner_user_id -> profiles.id (ON DELETE CASCADE)
  탈퇴하면 그룹도 지워진다. dashboard_items.user_id와 같은 방식으로 여기서 직접 만들고
  alembic/env.py의 HAND_MANAGED_CONSTRAINTS에 등록했다.
- group_items -> groups.id, dashboard_items.id (둘 다 ON DELETE CASCADE)
  그룹이나 후보가 지워지면 관계만 사라진다. 관계를 지운다고 후보가 지워지지는 않는다.
- 기존 dashboard_item_groups(JSON 스냅샷, 667be58b68d8)는 지우지 않는다.
  데이터가 남아 있어 되돌릴 수 있게 두고, 앱에서만 더 이상 쓰지 않는다.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '16bbbf4cc3a5'
down_revision: Union[str, Sequence[str], None] = 'b449723601b1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "groups",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_groups_owner_user_id", "groups", ["owner_user_id"])
    op.create_foreign_key(
        "fk_groups_owner", "groups", "profiles",
        ["owner_user_id"], ["id"],
        ondelete="CASCADE",
    )

    op.create_table(
        "group_items",
        sa.Column("group_id", sa.BigInteger(), nullable=False),
        sa.Column("dashboard_item_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("group_id", "dashboard_item_id"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], name="fk_group_items_group", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["dashboard_item_id"], ["dashboard_items.id"],
            name="fk_group_items_dashboard_item", ondelete="CASCADE",
        ),
    )
    op.create_index("ix_group_items_dashboard_item_id", "group_items", ["dashboard_item_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_group_items_dashboard_item_id", table_name="group_items")
    op.drop_table("group_items")
    op.drop_constraint("fk_groups_owner", "groups", type_="foreignkey")
    op.drop_index("ix_groups_owner_user_id", table_name="groups")
    op.drop_table("groups")
