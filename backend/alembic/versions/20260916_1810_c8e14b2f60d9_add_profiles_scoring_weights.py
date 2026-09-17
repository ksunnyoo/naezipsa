"""내 기본 임장 점수 기준을 프로필에 저장한다.

2026-09-16 사용자 결정: 점수 산출 기준을 체크리스트 화면의 "?"에서 바로 고칠 수
있게 한다. 그런데 "?"는 전체 후보 화면에서도 열리는데 그때는 보고 있는 그룹이
없어서, 고친 값을 저장할 곳이 없었다.

그래서 기준을 두 층으로 둔다.

  - `profiles.scoring_weights` : 내 기본 기준(이 마이그레이션)
  - `groups.scoring_weights`   : 그 그룹만의 기준. 있으면 기본을 이긴다

NULL이면 "따로 정하지 않음"이고, 화면은 이용 목적(전세/매매)에서 고른 기본값을
쓴다. 기존 계정은 전부 NULL로 시작하므로 지금까지 보이던 점수가 달라지지 않는다.

`groups.scoring_weights`와 같은 이유로 JSONB가 아닌 JSON을 쓴다 - 5개 키를 통째로
읽고 쓰기만 하고 내부 키로 조회·색인하지 않으며, SQLite(테스트)에서도 같은 타입으로
동작해 픽스처에 예외를 두지 않아도 된다.
"""
from alembic import op
import sqlalchemy as sa

revision = "c8e14b2f60d9"
down_revision = "b7d3e5a19c42"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("profiles", sa.Column("scoring_weights", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("profiles", "scoring_weights")
