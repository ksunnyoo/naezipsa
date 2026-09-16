"""Alembic 리비전 체인 점검. DB에 연결하지 않고 versions 폴더만 읽는다.

2026-09-14에 공용 DB가 git에 없던 리비전(667be58b68d8)을 가리키고, checked·임장
마이그레이션이 같은 부모에서 갈라져 alembic 명령이 전부 멈췄다. 같은 일이 다시 생기지
않도록 head가 하나인지, 공용 DB에 이미 적용된 리비전의 부모 관계가 바뀌지 않았는지 본다.
"""
from alembic.config import Config
from alembic.script import ScriptDirectory


def _script():
    return ScriptDirectory.from_config(Config("alembic.ini"))


def test_single_head():
    heads = _script().get_heads()
    assert len(heads) == 1, f"head가 {len(heads)}개입니다: {heads}. alembic merge로 합쳐 주세요."


def test_applied_revisions_keep_their_parents():
    """이미 공용 DB에 적용된 리비전의 부모를 바꾸면 DB 기록과 히스토리가 어긋난다."""
    script = _script()
    assert script.get_revision("258caef7f856").down_revision == "98a4d5fa65f8"
    assert script.get_revision("667be58b68d8").down_revision == "258caef7f856"
    assert script.get_revision("c71f9a2d830e").down_revision == "98a4d5fa65f8"
    assert set(script.get_revision("b449723601b1").down_revision) == {"667be58b68d8", "c71f9a2d830e"}
    assert script.get_revision("16bbbf4cc3a5").down_revision == "b449723601b1"
    assert script.get_revision("ff9db2ef90e4").down_revision == "16bbbf4cc3a5"
    assert script.get_revision("d755235ab9bc").down_revision == "ff9db2ef90e4"


def test_every_branch_is_reachable_from_head():
    """checked·그룹/공유·임장·Phase 4 그룹 마이그레이션이 모두 head의 조상이어야 upgrade에서 빠지지 않는다."""
    script = _script()
    head = script.get_heads()[0]
    ancestors = {rev.revision for rev in script.walk_revisions(base="base", head=head)}
    assert {"258caef7f856", "667be58b68d8", "c71f9a2d830e", "b449723601b1", "16bbbf4cc3a5", "ff9db2ef90e4",
            "d755235ab9bc", "3c9e1a7b52d4"} <= ancestors
