"""Per-field provenance and region inference."""
import pytest

from app.compliance.region import infer_region
from app.db import leads as leads_db
from app.provenance import build_contact_provenance, build_lead_provenance, summarize


def test_lead_provenance_records_only_fields_with_values_and_urls():
    item = {
        "company_name": "Acme", "contact_email": "jane@acme.com", "phone": "", "industry": "SaaS",
        "page_url": "https://acme.com/contact", "source_url": "https://acme.com",
        "linkedin_url": "https://linkedin.com/company/acme", "tech_stack": ["React"], "website": "https://acme.com",
    }
    p = build_lead_provenance(item, "2026-01-02T00:00:00Z")
    assert p["contact_email"] == {"source_url": "https://acme.com/contact", "retrieved_at": "2026-01-02T00:00:00Z", "method": "page_scrape"}
    assert p["industry"]["source_url"] == "https://linkedin.com/company/acme"
    assert p["tech_stack"]["method"] == "site_probe"
    assert "phone" not in p  # empty value
    assert "growth" not in p and "funding_stage" not in p  # no value


def test_lead_provenance_skips_fields_without_a_known_source():
    assert build_lead_provenance({"contact_email": "a@b.co"}) == {}
    assert build_lead_provenance({"contact_email": "a@b.co", "page_url": "not-a-url"}) == {}


def test_contact_provenance_uses_profile_and_email_source():
    dm = {"name": "Jane", "title": "CTO", "linkedin_url": "https://linkedin.com/in/jane", "email": "jane@acme.com"}
    p = build_contact_provenance(dm, fallback_url="https://acme.com", retrieved_at="t")
    assert p["name"]["source_url"] == "https://linkedin.com/in/jane"
    assert p["email"]["source_url"] == "https://acme.com"
    dm["email_source_url"] = "https://acme.com/team"
    assert build_contact_provenance(dm)["email"]["source_url"] == "https://acme.com/team"
    assert "email" not in build_contact_provenance({"name": "x", "linkedin_url": "https://l.in/x"})


def test_summarize_is_one_readable_line():
    s = summarize({"email": {"source_url": "https://a.co", "retrieved_at": "2026-03-04T10:00:00Z"}})
    assert s == "email: https://a.co (2026-03-04)"
    assert summarize(None) == ""


@pytest.mark.parametrize("url,loc,region", [
    ("https://acme.de", None, "EU"),
    ("https://www.acme.co.uk/about", None, "UK"),
    ("https://acme.ca", None, "CA"),
    ("https://acme.in", None, "IN"),
    ("https://acme.com", "Toronto, Canada", "CA"),
    ("https://acme.com", "Berlin, Germany", "EU"),
    ("https://acme.com", "Mumbai, India", "IN"),
    ("https://acme.com", "London, United Kingdom", "UK"),
    ("https://acme.com", "Indianapolis, USA", None),  # 'india' must not match 'indiana'-like words
    ("https://acme.com", "Austin, Texas", None),
])
def test_infer_region(url, loc, region):
    out = infer_region(url, location=loc)
    assert out["region"] == region
    assert bool(out["note"]) == bool(region)


def test_stated_country_beats_domain_and_email_domain_is_used():
    assert infer_region("https://acme.de", country="Canada")["region"] == "CA"
    assert infer_region(None, email="x@firma.fr")["region"] == "EU"
    assert infer_region(None)["region"] is None


async def test_saved_lead_carries_provenance_region_and_email_status(db):
    item = {
        "company_name": "Firma", "source_url": "https://firma.de", "website": "https://firma.de",
        "page_url": "https://firma.de/kontakt", "contact_email": "ceo@firma.de", "match_score": "80",
        "email_status": "likely", "email_checked_at": "2026-01-01T00:00:00+00:00",
        "decision_makers": [{"name": "Jan", "title": "CEO", "linkedin_url": "https://linkedin.com/in/jan", "email": "jan@firma.de"}],
    }
    await leads_db.save_enriched_leads_to_db("r1", "u1", [item])
    combined = await leads_db.get_normalized_leads_for_request("r1")
    lead = combined[0]
    assert lead["region"] == "EU" and "GDPR" in lead["region_note"]
    assert lead["provenance"]["contact_email"]["source_url"] == "https://firma.de/kontakt"
    assert lead["email_status"] == "likely" and lead["email_checked_at"]
    dm = lead["decision_makers"][0]
    assert dm["id"] and dm["provenance"]["name"]["source_url"] == "https://linkedin.com/in/jan"
    assert dm["provenance"]["email"]["source_url"] == "https://firma.de"
