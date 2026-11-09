"""
Unified tech stack pipeline: fingerprint + DNS + careers, fused into one profile.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.services.careers_tech_stack import (
    aggregate_careers_stack,
    detect_careers_tech_stack,
    get_canonical_map,
)
from app.services.infrastructure_detection import detect_infrastructure_via_dns
from app.services.llm import extract_tech_from_job_descriptions_batch
from app.services.tech_stack import detect_technology_stack, group_technologies_by_category
from app.services.tech_stack_fusion import merge_tech_profiles
from app.core.utils import domain_slug, normalize_url, utc_now_iso

logger = logging.getLogger(__name__)


def _jd_export_rows(job_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """JD rows for export — omit full description text to keep files readable."""
    rows = []
    for job in job_results:
        rows.append({
            "title": job.get("title"),
            "url": job.get("url"),
            "technologies": job.get("technologies", []),
            "evidence": job.get("evidence", []),
            "llm_used": job.get("llm_used", False),
        })
    return rows


def build_pipeline_export_payload(
    *,
    url: str,
    duration_ms: float,
    fingerprint_stack: List[str],
    dns_infra: Dict[str, Any],
    dns_services: List[str],
    careers_data: Dict[str, Any],
    job_results: List[Dict[str, Any]],
    aggregated: Dict[str, Any],
    fused: Dict[str, Any],
    errors: List[str],
) -> Dict[str, Any]:
    """Build full pipeline trace JSON for debugging."""
    discovery = careers_data.get("discovery") or {}
    listings = careers_data.get("jobs") or []
    selected = careers_data.get("selected_roles") or []

    return {
        "url": url,
        "status": "completed" if not errors else "partial",
        "timestamps": {
            "exported_at": utc_now_iso(),
            "duration_ms": duration_ms,
        },
        "steps": {
            "baseline": {
                "technologies": fingerprint_stack,
                "infrastructure": group_technologies_by_category(fingerprint_stack),
                "dns_infrastructure": {
                    "domain": dns_infra.get("domain"),
                    "detected_services": dns_infra.get("detected_services", {}),
                    "infrastructure_hints": dns_infra.get("infrastructure_hints", []),
                },
            },
            "careers_discovery": discovery,
            "job_collection": {
                "total_listings": len(listings),
                "engineering_candidates": len(listings),
                "selected_count": len(selected),
            },
            "selected_roles": selected,
            "jd_extraction": _jd_export_rows(job_results),
            "fusion": {
                "technologies": fused.get("technologies", []),
                "infrastructure": fused.get("infrastructure", {}),
                "tech_provenance": fused.get("tech_provenance", {}),
                "careers_stack": fused.get("careers_stack", aggregated.get("technologies", [])),
                "baseline_stack": fused.get("baseline_stack", []),
                "role_hits": aggregated.get("role_hits", {}),
                "evidence_map": aggregated.get("evidence_map", {}),
            },
        },
        "result": {
            "technologies": fused.get("technologies", []),
            "infrastructure": fused.get("infrastructure", {}),
            "tech_provenance": fused.get("tech_provenance", {}),
        },
        "errors": errors,
    }


def export_pipeline_json(payload: Dict[str, Any], url: str) -> Optional[str]:
    """
    Write pipeline trace to a timestamped JSON file.

    Filename format: {YYYYMMDD_HHMMSS}_{domain}.json
    Returns the absolute file path, or None if export is disabled/failed.
    """
    if not settings.CAREERS_PIPELINE_EXPORT:
        return None

    export_dir = Path(settings.CAREERS_PIPELINE_EXPORT_DIR)
    try:
        export_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.warning("Could not create careers export directory %s: %s", export_dir, exc)
        return None

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{domain_slug(url)}.json"
    file_path = export_dir / filename

    try:
        with file_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False, default=str)
        logger.info("Exported careers pipeline trace to %s", file_path)
        return str(file_path.resolve())
    except OSError as exc:
        logger.warning("Failed to export careers pipeline JSON to %s: %s", file_path, exc)
        return None


async def detect_full_tech_profile(url: str, timeout: int = 8) -> Dict[str, Any]:
    """
    Run the full tech stack pipeline for one URL.

    Runs fingerprint, DNS, and careers detection in parallel, applies LLM JD
    fallback when dictionary extraction is sparse, then fuses all signals.
    # Optional JSON export via export_pipeline_json() is disabled at call site.
    """
    url = normalize_url(url)
    start = time.time()
    errors: List[str] = []

    fingerprint_result, dns_infra, careers_data = await asyncio.gather(
        detect_technology_stack(url, timeout=timeout),
        detect_infrastructure_via_dns(url),
        detect_careers_tech_stack(url),
        return_exceptions=True,
    )

    if isinstance(fingerprint_result, Exception):
        errors.append(f"fingerprint: {fingerprint_result}")
        fingerprint_stack: List[str] = []
    else:
        fingerprint_stack = fingerprint_result or []

    if isinstance(dns_infra, Exception):
        errors.append(f"dns: {dns_infra}")
        dns_infra = {}
    if not isinstance(dns_infra, dict):
        dns_infra = {}

    if isinstance(careers_data, Exception):
        errors.append(f"careers: {careers_data}")
        careers_data = {
            "discovery": {},
            "jobs": [],
            "selected_roles": [],
            "job_results": [],
            "aggregated": {"technologies": [], "role_hits": {}, "jobs_analyzed": 0},
        }

    job_results = list(careers_data.get("job_results") or [])
    if job_results and sum(len(j.get("technologies", [])) for j in job_results) < settings.CAREERS_MIN_DICT_TECHS:
        try:
            llm_results = await extract_tech_from_job_descriptions_batch(job_results)
            for idx, enriched in enumerate(llm_results):
                if idx >= len(job_results) or not enriched.get("technologies"):
                    continue
                existing = set(job_results[idx].get("technologies", []))
                job_results[idx]["technologies"] = list(existing.union(enriched.get("technologies", [])))
                job_results[idx]["evidence"] = enriched.get("evidence", job_results[idx].get("evidence", []))
                job_results[idx]["llm_used"] = True
        except Exception as exc:
            errors.append(f"llm_jd: {exc}")

    aggregated = aggregate_careers_stack(job_results)
    careers_stack = aggregated.get("technologies", [])
    dns_services = list((dns_infra or {}).get("detected_services", {}).keys())

    fused = merge_tech_profiles(
        careers_stack=careers_stack,
        fingerprint_stack=fingerprint_stack,
        dns_services=dns_services,
        canonical_map=get_canonical_map(),
    )

    duration_ms = (time.time() - start) * 1000
    discovery = careers_data.get("discovery") or {}

    return {
        "url": url,
        "technologies": fused.get("technologies", []),
        "infrastructure": fused.get("infrastructure", {}),
        "tech_provenance": fused.get("tech_provenance", {}),
        "dns_infrastructure": {
            "domain": dns_infra.get("domain"),
            "detected_services": dns_infra.get("detected_services", {}),
            "infrastructure_hints": dns_infra.get("infrastructure_hints", []),
        },
        "careers": {
            "discovery": discovery,
            "jobs_analyzed": aggregated.get("jobs_analyzed", 0),
            "selected_roles": careers_data.get("selected_roles", []),
        },
        "pipeline": {
            "fingerprint": fingerprint_stack,
            "dns_services": dns_services,
            "careers_stack": fused.get("careers_stack", careers_stack),
            "baseline_stack": fused.get("baseline_stack", []),
            "duration_ms": duration_ms,
        },
        "errors": errors,
    }
