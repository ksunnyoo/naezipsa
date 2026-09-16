"""후보당 임장 기록 1건으로 바꾸고, 후보를 지우면 기록도 함께 지운다.

2026-09-16 사용자 결정 두 가지를 반영한다.

1. 저장 방식: 저장할 때마다 새 기록을 쌓지 않고 후보당 1건을 고쳐 쓴다.
   -> property_id에 UNIQUE를 건다. 고쳐 쓰는 구조라 updated_at이 필요하다.
2. 삭제 정책: 임장 기록이 있어도 후보를 지울 수 있게 한다.
   -> 외래키를 RESTRICT에서 CASCADE로 바꾼다.

SQLite(테스트)는 제약을 ALTER로 바꿀 수 없어 batch_alter_table로 테이블을
다시 만든다. 반사(reflection)가 CHECK 제약을 흘리지 않도록 copy_from에
현재 스키마를 명시한다. PostgreSQL은 일반 ALTER로 처리한다.
"""
from alembic import op
import sqlalchemy as sa

revision = "a4f2c8e91b07"
down_revision = "3c9e1a7b52d4"
branch_labels = None
depends_on = None

TABLE = "property_inspections"

# 1~3 점수 항목 17개. harmful_facility만 0/1이라 따로 둔다.
SCORES = (
    "transport", "commute_road", "school", "academy", "convenience", "noise",
    "parking", "sunlight", "natural_light", "leak_mold", "wallpaper",
    "water_pressure", "toilet_drain", "drain_smell", "window_condition",
    "heating", "floor_noise",
)


def _current_table(ondelete):
    """이 마이그레이션 직전(또는 직후) 스키마. SQLite batch의 copy_from용."""
    columns = [
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("property_id", sa.BigInteger(), nullable=False),
    ]
    columns += [sa.Column(name, sa.Integer(), nullable=True) for name in SCORES]
    columns += [
        sa.Column("harmful_facility", sa.Integer(), nullable=True),
        sa.Column("overall_rating", sa.Integer(), nullable=False),
        sa.Column("memo", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    ]
    checks = [
        sa.CheckConstraint(f"{name} IN (1, 2, 3)", name=f"ck_inspections_{name}")
        for name in SCORES
    ]
    checks += [
        sa.CheckConstraint("harmful_facility IN (0, 1)", name="ck_inspections_harmful_facility"),
        sa.CheckConstraint("overall_rating BETWEEN 1 AND 5", name="ck_inspections_rating"),
        sa.CheckConstraint("length(memo) <= 2000", name="ck_inspections_memo"),
    ]
    return sa.Table(
        TABLE, sa.MetaData(), *columns,
        sa.ForeignKeyConstraint(
            ["property_id"], ["dashboard_items.id"],
            name="fk_inspections_property", ondelete=ondelete,
        ),
        *checks,
    )


def _updated_at_column():
    return sa.Column(
        "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def upgrade():
    # 후보당 여러 건이 남아 있으면 UNIQUE를 걸 수 없다. 가장 최근 1건만 남긴다.
    # (공용 DB는 0행이지만 각자 로컬에는 기록이 있을 수 있다.)
    op.execute(
        f"DELETE FROM {TABLE} WHERE id NOT IN "
        f"(SELECT MAX(id) FROM {TABLE} GROUP BY property_id)"
    )
    # 후보당 1건이 되면 (property_id, created_at) 복합 인덱스는 UNIQUE와 겹친다.
    op.drop_index("ix_inspections_property_created", table_name=TABLE)

    if op.get_context().dialect.name == "sqlite":
        with op.batch_alter_table(
            TABLE, copy_from=_current_table("RESTRICT"), recreate="always"
        ) as batch:
            batch.add_column(_updated_at_column())
            batch.drop_constraint("fk_inspections_property", type_="foreignkey")
            batch.create_foreign_key(
                "fk_inspections_property", "dashboard_items",
                ["property_id"], ["id"], ondelete="CASCADE",
            )
            batch.create_unique_constraint("uq_inspections_property", ["property_id"])
    else:
        op.add_column(TABLE, _updated_at_column())
        op.drop_constraint("fk_inspections_property", TABLE, type_="foreignkey")
        op.create_foreign_key(
            "fk_inspections_property", TABLE, "dashboard_items",
            ["property_id"], ["id"], ondelete="CASCADE",
        )
        op.create_unique_constraint("uq_inspections_property", TABLE, ["property_id"])


def downgrade():
    """되돌리면 기록 보존(RESTRICT)으로 돌아간다. 지워진 중복 기록은 복구되지 않는다."""
    if op.get_context().dialect.name == "sqlite":
        after = _current_table("CASCADE")
        after.append_column(_updated_at_column())
        after.append_constraint(
            sa.UniqueConstraint("property_id", name="uq_inspections_property")
        )
        with op.batch_alter_table(TABLE, copy_from=after, recreate="always") as batch:
            batch.drop_constraint("uq_inspections_property", type_="unique")
            batch.drop_constraint("fk_inspections_property", type_="foreignkey")
            batch.create_foreign_key(
                "fk_inspections_property", "dashboard_items",
                ["property_id"], ["id"], ondelete="RESTRICT",
            )
            batch.drop_column("updated_at")
    else:
        op.drop_constraint("uq_inspections_property", TABLE, type_="unique")
        op.drop_constraint("fk_inspections_property", TABLE, type_="foreignkey")
        op.create_foreign_key(
            "fk_inspections_property", TABLE, "dashboard_items",
            ["property_id"], ["id"], ondelete="RESTRICT",
        )
        op.drop_column(TABLE, "updated_at")

    op.create_index("ix_inspections_property_created", TABLE, ["property_id", "created_at"])
