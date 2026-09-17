"""같은 평형에 같은 동·호수 후보가 둘 생기지 않게 한다 — 단, 적었을 때만.

2026-09-17 결정: 동·호수를 **필수로 받지 않는다.** 등록 시점에는 모르는 경우가 많기
때문이다(매물을 보고 담을 때는 "12층대"까지만 아는 일이 흔하고, 동·호수는 임장을
다녀와야 안다). 실제로 이 마이그레이션 직전 공용 DB에서 동·호수가 둘 다 채워진 행은
0개였다 - 필수로 받았다면 그만큼 아무 값이나 적혔을 것이다.

그래서 전체 UNIQUE가 아니라 **둘 다 적었을 때만** 걸리는 부분 유니크 인덱스를 쓴다.

  - 동·호수를 안 적은 후보는 몇 개든 담을 수 있다(강제가 생기지 않는다).
  - 적은 후보끼리는 같은 집이 두 번 담기지 않는다.

`complex_id` 컬럼은 필요 없다 - 한 동·호수는 평형이 하나라 `size_id`로 충분하다.

화면에도 "이미 담은 집인가요?" 확인 창이 있지만 그건 탭 하나 안에서만 유효하다.
이 인덱스는 탭 두 개에서 동시에 담거나, 서로 다른 후보를 같은 동·호수로 고치는
경우를 막는 안전망이다.
"""
from alembic import op
import sqlalchemy as sa

revision = "d5c71e3f9a48"
down_revision = "c8e14b2f60d9"
branch_labels = None
depends_on = None

INDEX_NAME = "uq_dashboard_items_owner_unit"
# 둘 중 하나라도 비어 있으면 인덱스에 들어가지 않는다 = 중복 검사 대상이 아니다.
PARTIAL_WHERE = "dong IS NOT NULL AND ho IS NOT NULL"


def upgrade():
    op.create_index(
        INDEX_NAME,
        "dashboard_items",
        ["user_id", "size_id", "dong", "ho"],
        unique=True,
        postgresql_where=sa.text(PARTIAL_WHERE),
        sqlite_where=sa.text(PARTIAL_WHERE),
    )


def downgrade():
    op.drop_index(INDEX_NAME, table_name="dashboard_items")
