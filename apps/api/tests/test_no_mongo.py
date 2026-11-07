"""Guard: MongoDB must not creep back into the codebase.

`tech_stack.py` / `careers_tech_stack.py` are excluded on purpose: they list "MongoDB" as a technology Quarry
can *detect* on prospects' websites, which has nothing to do with Quarry's own database.
"""
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
EXCLUDES = [
    ":!docs",
    ":!*uv.lock",
    ":!*package-lock.json",
    ":!apps/api/app/services/tech_stack.py",
    ":!apps/api/app/services/careers_tech_stack.py",
    ":!apps/api/tests/test_no_mongo.py",
]


def test_no_mongo_references():
    out = subprocess.run(
        ["git", "grep", "-inE", "mongo|motor|pymongo|bson", "--", ".", *EXCLUDES],
        cwd=REPO, capture_output=True, text=True,
    )
    assert out.stdout == "", f"MongoDB references remain:\n{out.stdout}"
