"""Alembic 실행 환경 설정.

⚠️ 이 파일에서 가장 중요한 것은 아래 include_object() 필터입니다.
   이 프로젝트의 Supabase DB에는 두 종류의 테이블이 섞여 있습니다.

     - B가 관리하는 실거래 데이터 테이블 (raw_trades_sale, complex_master, ...)
       -> app/db_models.py 에 정의. Alembic으로 관리하지 않음.
     - A가 관리하는 회원 관련 테이블 (users, favorites, ...)
       -> app/db_models_user.py 에 정의. Alembic으로 관리함.

   Alembic의 autogenerate는 "코드에 정의된 테이블"과 "실제 DB의 테이블"을
   비교해서 차이를 마이그레이션으로 만듭니다. 필터가 없으면 B의 테이블을 보고
   "코드에 없으니 지워야 한다"고 판단해 DROP TABLE 을 생성합니다.
   그러면 수집해 둔 서울 5년치 실거래 데이터가 통째로 사라집니다.
"""
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# app 패키지를 import 할 수 있도록 (alembic.ini의 prepend_sys_path = . 와 함께 동작)
from app.core.config import DATABASE_URL, MIGRATION_DATABASE_URL
from app.core.database import Base

# ⚠️ 모델 모듈을 import해야 테이블이 Base.metadata에 등록된다.
#    빠뜨리면 Alembic 눈에 그 테이블이 안 보여서, 이미 있는 테이블을
#    비교 대상에서 놓치거나 새 테이블을 만들지 못한다.
#    (import만 하고 쓰지 않으므로 noqa로 린터 경고를 끈다)
from app.dashboard import model as _dashboard_model  # noqa: F401
from app.inspection import model as _inspection_model  # noqa: F401
from app.user import model as _user_model  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 접속 주소는 alembic.ini가 아니라 .env에서 가져온다.
# MIGRATION_DATABASE_URL(세션 풀러 5432 또는 직접 연결)이 있으면 그것을, 없으면
# DATABASE_URL을 쓴다. 앱이 쓰는 트랜잭션 풀러(6543)는 DDL 실행에 권장되지 않는다.
_migration_url = MIGRATION_DATABASE_URL or DATABASE_URL
if not _migration_url:
    raise RuntimeError(
        ".env에 MIGRATION_DATABASE_URL 또는 DATABASE_URL이 없습니다. Alembic은 이 값 없이는 실행할 수 없습니다.\n"
        "Supabase 대시보드 -> Project Settings -> Database -> Connection string(URI)에서 확인하세요."
    )
# ini 파일 문법상 '%'는 특수문자라 비밀번호에 %가 있으면 깨진다. 이스케이프 처리.
config.set_main_option("sqlalchemy.url", _migration_url.replace("%", "%%"))

# A가 관리하는 테이블만 담긴 metadata. 여기 없는 테이블은 Alembic이 건드리지 않는다.
target_metadata = Base.metadata

# 모델(app/db_models_user.py)에 ForeignKey로 선언하지 않고,
# 마이그레이션 파일에서 op.create_foreign_key()로 직접 건 제약들의 이름.
#
# 참조 대상이 우리 metadata 밖에 있어서 모델에 선언할 수 없다.
#   - auth.users  : Supabase가 관리하는 다른 스키마
#   - size_master : B의 metadata(app/db_models.py)
#
# 문제는 autogenerate가 이것들을 "DB엔 있는데 코드엔 없는 제약"으로 보고
# drop_constraint를 만들어낸다는 점이다. 그대로 적용하면 외래키가 조용히 사라져서
# 탈퇴한 회원의 데이터가 남거나, 없는 평형을 후보로 담을 수 있게 된다.
# 그래서 아래 목록에 있는 제약은 비교 대상에서 아예 제외한다.
HAND_MANAGED_CONSTRAINTS = {
    "fk_profiles_auth_users",       # profiles.id -> auth.users.id
    "fk_dashboard_items_user",      # dashboard_items.user_id -> profiles.id
    "fk_dashboard_items_size",      # dashboard_items.size_id -> size_master.id (B 데이터 이관 후 추가 예정)
    "fk_groups_owner",              # groups.owner_user_id -> profiles.id
}


def include_object(object, name, type_, reflected, compare_to):
    """이 객체를 autogenerate 비교 대상에 포함할지 결정한다.

    판단 기준은 단 하나: "app/db_models_user.py 에 정의된 테이블인가?"

      - DB에는 있지만 target_metadata에 없는 테이블(= B의 테이블)  -> False (무시)
      - target_metadata에 있는 테이블(= A의 테이블)                -> True  (관리)

    인덱스·제약조건·컬럼은 소속 테이블을 기준으로 같이 판단한다.
    (B의 테이블에 걸린 인덱스를 실수로 DROP 하지 않기 위함)

    부작용 하나: A의 테이블을 정말로 삭제하고 싶을 때도 모델에서 지우면
    Alembic 눈에 안 보이게 되므로 DROP이 생성되지 않는다. 의도적인 삭제는
    마이그레이션 파일에 op.drop_table()을 직접 손으로 적어야 한다.
    데이터를 날리는 방향으로는 절대 자동 생성되지 않는다는 뜻이므로 이대로 둔다.
    """
    if type_ == "table":
        return name in target_metadata.tables

    # 손으로 건 외래키는 모델에 없는 게 정상이므로 비교하지 않는다.
    # (테이블 소속 검사보다 먼저 걸러야 한다. A의 테이블에 걸린 제약이라
    #  아래 parent_table 검사는 True를 돌려주기 때문이다)
    if type_ == "foreign_key_constraint" and name in HAND_MANAGED_CONSTRAINTS:
        return False

    parent_table = getattr(object, "table", None)
    if parent_table is not None:
        return parent_table.name in target_metadata.tables

    return True


def run_migrations_offline() -> None:
    """DB에 접속하지 않고 SQL 스크립트만 출력 (alembic upgrade head --sql)."""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """실제 DB에 접속해서 마이그레이션 실행."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_object,
            compare_type=True,      # 컬럼 타입 변경도 감지
            include_schemas=False,  # public 스키마만. Supabase 내부 스키마(auth, storage 등)는 제외
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
