"""실거래 데이터 테이블을 다른 DB로 통째로 복사한다.

왜 필요한가
    지금은 팀원 로컬 서버와 배포 서버가 Supabase 한 곳을 같이 쓴다. 배포용 DB를
    따로 파면 실거래 데이터(raw_trades_*, complex_master, size_master,
    item_metrics_cache, regulation_zones)를 새 DB에 옮겨야 한다. 이 테이블들은
    Alembic이 관리하지 않아서 마이그레이션으로는 안 따라온다.

    나중에 Supabase를 떠나 다른 Postgres로 옮길 때도 이 스크립트를 그대로 쓴다.

무엇을 옮기고 무엇을 안 옮기는가
    옮긴다  : 실거래 데이터 6개 테이블 (누가 만들었든 똑같은 공개 데이터)
    안 옮긴다: 회원·후보매물·그룹·임장기록 (profiles, dashboard_items, groups,
              group_items, dashboard_shares, group_share_links,
              property_inspections)
              -> 배포 DB는 빈 상태로 시작한다. 로그인 계정 자체가 새 Supabase
                 프로젝트의 것이라 옛 회원 행을 옮겨도 주인이 없다.
              -> 이 테이블들은 새 DB에서 `alembic upgrade head`로 만든다.

실행
    # 두 주소 모두 5432(Session pooler)를 쓴다. 대량 복사에는 6543보다 안전하다.
    set SOURCE_DATABASE_URL=postgresql://...:5432/postgres      # 지금 공용 DB
    set TARGET_DATABASE_URL=postgresql://...:5432/postgres      # 새 배포용 DB
    python scripts/clone_db.py              # 먼저 계획만 보여준다(아무것도 안 씀)
    python scripts/clone_db.py --run        # 실제로 복사

주의
    --run 은 대상 테이블을 TRUNCATE 하고 새로 채운다. 원본은 읽기만 한다.
"""
import argparse
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

# Windows 기본 콘솔은 한글 코드페이지라 진행 상황 출력이 깨질 수 있다.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # 아주 옛 파이썬이나 특이한 터미널
    pass

from sqlalchemy import create_engine, text  # noqa: E402

from app.property.model import Base  # noqa: E402

# 옮길 테이블. 순서가 중요하다 — 참조되는 쪽(complex_master)을 먼저 채운다.
TABLES = [
    "complex_master",
    "size_master",
    "raw_trades_sale",
    "raw_trades_rent",
    "item_metrics_cache",
    "regulation_zones",
]


def _columns(conn, table):
    """CSV 컬럼 순서를 양쪽에서 똑같이 맞추기 위해 실제 컬럼 목록을 읽는다."""
    rows = conn.execute(
        text(
            "select column_name from information_schema.columns "
            "where table_schema='public' and table_name=:t order by ordinal_position"
        ),
        {"t": table},
    ).fetchall()
    return [r[0] for r in rows]


def _count(conn, table):
    return conn.execute(text(f'select count(*) from public."{table}"')).scalar()


def _human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def copy_table(src_engine, dst_engine, table, tmpdir):
    """원본에서 CSV로 뽑아 대상에 그대로 밀어넣는다(COPY 사용, 행 단위 INSERT보다 훨씬 빠름)."""
    with src_engine.connect() as sc:
        cols = _columns(sc, table)
        total = _count(sc, table)
    col_sql = ", ".join(f'"{c}"' for c in cols)

    csv_path = Path(tmpdir) / f"{table}.csv"
    started = time.time()

    # 1) 원본 -> 파일
    raw_src = src_engine.raw_connection()
    try:
        cur = raw_src.cursor()
        with open(csv_path, "w", encoding="utf-8", newline="") as f:
            cur.copy_expert(
                f'COPY (SELECT {col_sql} FROM public."{table}") TO STDOUT WITH (FORMAT csv)',
                f,
            )
    finally:
        raw_src.close()

    size = csv_path.stat().st_size
    print(f"    내려받음 {total:,}행 {_human(size)} ({time.time() - started:.0f}초)")

    # 2) 파일 -> 대상 (기존 내용은 비우고 넣는다)
    raw_dst = dst_engine.raw_connection()
    try:
        cur = raw_dst.cursor()
        cur.execute(f'TRUNCATE public."{table}" CASCADE')
        with open(csv_path, "r", encoding="utf-8", newline="") as f:
            cur.copy_expert(
                f'COPY public."{table}" ({col_sql}) FROM STDIN WITH (FORMAT csv)', f
            )
        # BIGSERIAL 다음 번호를 최대 id에 맞춘다. 안 하면 새 글이 1번부터
        # 매겨지면서 "이미 있는 키"라고 실패한다.
        if "id" in cols:
            cur.execute(
                f"SELECT setval(pg_get_serial_sequence('public.\"{table}\"','id'), "
                f'COALESCE((SELECT MAX(id) FROM public."{table}"), 1))'
            )
        raw_dst.commit()
    finally:
        raw_dst.close()

    csv_path.unlink(missing_ok=True)
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="store_true", help="실제로 복사한다(없으면 계획만 보여준다)")
    args = ap.parse_args()

    source = os.getenv("SOURCE_DATABASE_URL", "")
    target = os.getenv("TARGET_DATABASE_URL", "")
    if not source or not target:
        sys.exit("SOURCE_DATABASE_URL과 TARGET_DATABASE_URL을 둘 다 채워야 합니다.")
    if source == target:
        sys.exit("원본과 대상이 같은 주소입니다. 중단합니다.")

    src_engine = create_engine(source)
    dst_engine = create_engine(target)

    print("원본 :", source.split("@")[-1])
    print("대상 :", target.split("@")[-1])
    print()

    with src_engine.connect() as sc:
        plan = [(t, _count(sc, t)) for t in TABLES]

    print("옮길 테이블")
    for t, n in plan:
        print(f"  {t:22} {n:>10,}행")
    print(f"  {'합계':22} {sum(n for _, n in plan):>10,}행")
    print()

    if not args.run:
        print("계획만 보여줬습니다. 실제로 옮기려면 --run 을 붙이세요.")
        return

    print("대상에 테이블을 만듭니다(이미 있으면 건너뜁니다)...")
    Base.metadata.create_all(dst_engine)

    with tempfile.TemporaryDirectory() as tmpdir:
        for t, _ in plan:
            print(f"  {t} 복사 중...")
            copy_table(src_engine, dst_engine, t, tmpdir)

    print()
    print("확인 — 원본과 대상의 행 수가 같아야 합니다.")
    ok = True
    with src_engine.connect() as sc, dst_engine.connect() as dc:
        for t, _ in plan:
            a, b = _count(sc, t), _count(dc, t)
            mark = "OK " if a == b else "다름"
            if a != b:
                ok = False
            print(f"  {mark} {t:22} 원본 {a:>10,} / 대상 {b:>10,}")

    print()
    print("전부 일치합니다." if ok else "행 수가 다른 테이블이 있습니다. 다시 확인하세요.")


if __name__ == "__main__":
    main()
