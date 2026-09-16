"""DB 연결 풀 설정값 파싱.

.env.example을 그대로 복사하면 DB_POOL_SIZE= 처럼 값이 빈 줄이 생긴다. 이때 int("")로
앱이 뜨지 못하면 안 되므로 기본값으로 떨어지는지, 값을 넣으면 반영되는지 확인한다.
"""
import importlib

import pytest

import app.core.config as config

_POOL_KEYS = ("DB_POOL_SIZE", "DB_MAX_OVERFLOW", "DB_POOL_TIMEOUT")


@pytest.fixture
def reload_config(monkeypatch):
    def reload(**env):
        for key in _POOL_KEYS:
            monkeypatch.delenv(key, raising=False)
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        return importlib.reload(config)

    yield reload
    # 다른 테스트가 원래 환경의 설정값을 보도록 되돌린다.
    monkeypatch.undo()
    importlib.reload(config)


def test_empty_pool_values_fall_back_to_defaults(reload_config):
    cfg = reload_config(DB_POOL_SIZE="", DB_MAX_OVERFLOW="", DB_POOL_TIMEOUT="")
    assert (cfg.DB_POOL_SIZE, cfg.DB_MAX_OVERFLOW, cfg.DB_POOL_TIMEOUT) == (3, 2, 10)


def test_pool_values_can_be_tuned_per_environment(reload_config):
    cfg = reload_config(DB_POOL_SIZE="10", DB_MAX_OVERFLOW="5", DB_POOL_TIMEOUT="30")
    assert (cfg.DB_POOL_SIZE, cfg.DB_MAX_OVERFLOW, cfg.DB_POOL_TIMEOUT) == (10, 5, 30)
