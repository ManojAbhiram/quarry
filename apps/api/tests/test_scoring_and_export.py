"""Scoring engine and export generators."""
import csv
import io
from datetime import datetime, timedelta, timezone

import openpyxl

from app.core.scoring_config import PILLAR_CAPS
from app.services import export_service as ex
from app.services.leads import filter_leads_by_icp
from app.services.scoring import apply_score_decay, compute_intent_score, get_score_band


def _sig(category, weight, confidence="high", title="t"):
    return {"category": category, "weight": weight, "confidence": confidence, "title": title, "source": "s"}


# ── scoring ──────────────────────────────────────────────────────────────────

def test_bands_cover_edges():
    assert get_score_band(100)["band"] == "HOT"
    assert get_score_band(80)["band"] == "HOT"
    assert get_score_band(79)["band"] == "WARM"
    assert get_score_band(40)["band"] == "NURTURE"
    assert get_score_band(20)["band"] == "WATCH"
    assert get_score_band(0)["band"] == "COLD"


def test_empty_signals_scores_from_match_score_only():
    r = compute_intent_score([], existing_match_score=80)
    assert r["score_breakdown"]["firmographic"] == 20.0
    assert r["intent_score"] == 20
    assert r["intent_band"] == "WATCH"
    assert r["total_signals"] == 0


def test_garbage_match_score_is_zero_not_a_crash():
    assert compute_intent_score([], existing_match_score="n/a")["intent_score"] == 0
    assert compute_intent_score([], existing_match_score=None)["intent_score"] == 0


def test_match_score_with_slash_format():
    assert compute_intent_score([], existing_match_score="60/100")["score_breakdown"]["firmographic"] == 15.0


def test_pillars_are_capped_and_confidence_weighted():
    r = compute_intent_score([_sig("intent", 100)], existing_match_score=0)
    assert r["score_breakdown"]["intent"] == PILLAR_CAPS["intent"]
    low = compute_intent_score([_sig("tech", 10, "low")], 0)
    assert low["score_breakdown"]["tech"] == 5.0  # 10 * 0.5


def test_unknown_category_counts_as_intent():
    r = compute_intent_score([_sig("weird", 10)], 0)
    assert r["score_breakdown"]["intent"] == 10.0


def test_total_is_clamped_to_100():
    sigs = [_sig("tech", 99), _sig("intent", 99), _sig("engagement", 99)]
    assert compute_intent_score(sigs, 100)["intent_score"] == 100


def test_decay_only_touches_intent_and_engagement():
    old = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
    out = apply_score_decay({"firmographic": 20, "tech": 10, "intent": 30, "engagement": 10}, old)
    assert out["firmographic"] == 20 and out["tech"] == 10
    assert out["intent"] < 30 and out["engagement"] < 10


def test_decay_accepts_naive_and_invalid_dates():
    pillars = {"intent": 30.0}
    naive = (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%d")
    assert apply_score_decay(pillars, naive)["intent"] < 30
    assert apply_score_decay(pillars, "not-a-date") == pillars
    assert apply_score_decay(pillars, None) == pillars


def test_recent_signal_does_not_decay():
    now = datetime.now(timezone.utc).isoformat()
    r = compute_intent_score([_sig("intent", 20)], 0, last_signal_date=now)
    assert r["decay_applied"] is False


# ── ICP filter ───────────────────────────────────────────────────────────────

def test_icp_filter_threshold_and_failed_leads_kept():
    leads = [
        {"company_name": "hi", "match_score": "80"},
        {"company_name": "lo", "match_score": "10"},
        {"company_name": "failed", "enrichment_failed": True},
    ]
    names = [x["company_name"] for x in filter_leads_by_icp(leads, None, threshold=60)]
    assert names == ["hi", "failed"]
    assert len(filter_leads_by_icp(leads, None, threshold=0)) == 3


def test_icp_filter_is_off_by_default():
    from app.core.config import settings

    assert settings.ICP_FILTER_ENABLED is False


# ── exports ──────────────────────────────────────────────────────────────────

def test_csv_roundtrip_with_lists_none_and_bom():
    data = ex.generate_csv(["Name", "Tags", "Email"], [["Acme, Inc", ["a", "b"], None]])
    assert data.startswith(b"\xef\xbb\xbf")
    rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
    assert rows == [["Name", "Tags", "Email"], ["Acme, Inc", "a; b", ""]]


def test_xlsx_contains_headers_and_rows():
    data = ex.generate_xlsx("Leads", ["Name", "Score"], [["Acme", 91], ["Beta", 40]])
    ws = openpyxl.load_workbook(io.BytesIO(data)).active
    assert ws.title == "Leads"
    assert [c.value for c in ws[1]] == ["Name", "Score"]
    assert [c.value for c in ws[2]] == ["Acme", 91]


def test_pdfs_render_with_minimal_and_empty_input():
    lead = {"company_name": "Acme", "website": "https://acme.test", "match_score": "80", "tech_stack": ["Python"]}
    assert ex.generate_companies_pdf([lead]).startswith(b"%PDF")
    assert ex.generate_companies_pdf([]).startswith(b"%PDF")
    contact = {"name": "Jane", "title": "CTO", "company_name": "Acme", "linkedin_url": "https://linkedin.com/in/j"}
    assert ex.generate_decision_makers_pdf([contact]).startswith(b"%PDF")
    comp = {"name": "Rival", "website": "https://rival.test", "tier": "Direct", "overlap_score": 70}
    assert ex.generate_competitors_pdf([comp]).startswith(b"%PDF")
