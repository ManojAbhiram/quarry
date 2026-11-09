import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "apps" / "api" / "app"


def test_production_env_example_documents_every_variable():
    text = (ROOT / ".env.production.example").read_text(encoding="utf-8")
    names = set()
    for f in APP.rglob("*.py"):
        src = f.read_text(encoding="utf-8")
        names |= set(re.findall(r'(?:getenv|environ\.get)\(\s*"([A-Z][A-Z0-9_]+)"', src))
    names |= {"STRIPE_SECRET_KEY", "RAZORPAY_KEY_ID", "GROQ_API_KEY", "OPENROUTER_API_KEY"}
    missing = sorted(n for n in names if not re.search(rf"^#?\s*{n}=", text, re.M))
    assert not missing, f"undocumented env vars: {missing}"


def test_production_env_example_has_no_real_looking_secrets():
    text = (ROOT / ".env.production.example").read_text(encoding="utf-8")
    assert not re.search(r"(sk_live|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,})", text)


def test_health_endpoint(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_deploy_files_exist():
    for p in ("apps/api/Dockerfile", "apps/web/Dockerfile", "docker-compose.yml", "DEPLOYMENT.md"):
        assert (ROOT / p).is_file(), p
