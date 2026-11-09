"""Sending-domain DNS pre-flight: SPF, DKIM (common selectors) and DMARC, via the DnsResolver port."""
from __future__ import annotations

from app.outreach.ports import ports

DEFAULT_SELECTORS = ("google", "default", "selector1", "selector2", "k1", "s1", "mail", "dkim")


async def _txt(name: str) -> list[str]:
    try:
        return await ports.dns.txt(name)
    except Exception:  # noqa: BLE001 - a resolver failure is reported as "not found", not a crash
        return []


async def preflight(domain: str, selectors: tuple[str, ...] | list[str] | None = None) -> dict:
    domain = domain.strip().lower().rstrip(".")
    spf_records = [t for t in await _txt(domain) if t.lower().startswith("v=spf1")]
    spf = {"found": bool(spf_records), "record": spf_records[0] if spf_records else None, "status": "fail",
           "hint": "Publish a TXT record like 'v=spf1 include:_spf.google.com ~all' on your domain."}
    if len(spf_records) > 1:
        spf.update(status="fail", hint="Multiple SPF records exist; merge them into one.")
    elif spf_records:
        rec = spf_records[0].lower()
        strong = rec.rstrip().endswith(("-all", "~all"))
        spf.update(status="pass" if strong else "warn",
                   hint=None if strong else "End your SPF record with ~all or -all.")

    dkim_found = None
    for sel in selectors or DEFAULT_SELECTORS:
        recs = [t for t in await _txt(f"{sel}._domainkey.{domain}") if "p=" in t.replace(" ", "")]
        if recs:
            dkim_found = {"selector": sel, "record": recs[0][:120]}
            break
    dkim = {"found": bool(dkim_found), **(dkim_found or {}), "status": "pass" if dkim_found else "warn",
            "hint": None if dkim_found else "No DKIM key found for common selectors. Enable DKIM signing at your mail "
                                           "provider and publish the key (add your selector if it is custom)."}

    dm = [t for t in await _txt(f"_dmarc.{domain}") if t.lower().startswith("v=dmarc1")]
    policy = None
    for part in (dm[0].split(";") if dm else []):
        k, _, v = part.strip().partition("=")
        if k.lower() == "p":
            policy = v.strip().lower()
    dmarc = {"found": bool(dm), "record": dm[0] if dm else None, "policy": policy,
             "status": "fail" if not dm else ("warn" if policy == "none" else "pass"),
             "hint": "Publish a TXT record at _dmarc with 'v=DMARC1; p=quarantine; rua=mailto:you@" + domain + "'."
             if not dm else ("DMARC policy is 'none' (monitor only); move to quarantine once aligned."
                             if policy == "none" else None)}

    checks = {"spf": spf, "dkim": dkim, "dmarc": dmarc}
    statuses = {c["status"] for c in checks.values()}
    overall = "fail" if "fail" in statuses else ("warn" if "warn" in statuses else "pass")
    return {"domain": domain, "overall": overall, "checks": checks}
