"""그룹별 임장 점수 가중치를 저장한다.

2026-09-16 사용자 결정: 점수 산출 규칙을 그룹 단위로만 다르게 둔다.
같은 그룹 안의 후보는 모두 같은 자로 재야 비교가 공정하기 때문이다.
체크하는 항목 18개는 모든 그룹이 공통이고, 가중치(카테고리 5개 비중)만 다르다.

값이 NULL이면 "이 그룹은 따로 정하지 않았다"는 뜻이고, 화면은 프로필의
이용 목적(전세/매매)에서 고른 기본 가중치를 쓴다. 기존 그룹은 전부 NULL로
시작하므로 지금까지 보이던 점수가 달라지지 않는다.

JSONB가 아니라 JSON을 쓰는 이유: 이 값은 5개 키를 통째로 읽고 통째로 쓰기만
하고 내부 키로 조회·색인하지 않는다. JSON이면 SQLite(테스트)에서도 같은
타입으로 동작해 그룹 테스트 픽스처에 예외 처리를 넣지 않아도 된다.
"""
from alembic import op
import sqlalchemy as sa

revision = "b7d3e5a19c42"
down_revision = "a4f2c8e91b07"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("groups", sa.Column("scoring_weights", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("groups", "scoring_weights")
