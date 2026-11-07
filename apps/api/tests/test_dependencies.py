"""Guard: the database drivers the app imports must be declared, or a fresh `uv sync` yields a broken install."""
import tomllib
from pathlib import Path

API = Path(__file__).resolve().parents[1]


def test_pyproject_declares_database_dependencies():
    deps = tomllib.loads((API / "pyproject.toml").read_text(encoding="utf-8"))["project"]["dependencies"]
    names = {d.split("[")[0].split(">")[0].split("=")[0].strip().lower() for d in deps}
    assert {"sqlalchemy", "aiosqlite"} <= names, sorted(names)


def test_requirements_txt_declares_database_dependencies():
    lines = (API / "requirements.txt").read_text(encoding="utf-8").splitlines()
    names = {line.split("[")[0].split(">")[0].split("=")[0].strip().lower() for line in lines if line.strip()}
    assert {"sqlalchemy", "aiosqlite"} <= names, sorted(names)
