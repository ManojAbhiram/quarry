"""
Merge tech stack signals: careers stack is kept in full, union-merged with baseline.
"""

from typing import Any, Dict, List, Optional, Set

from app.services.tech_stack import group_technologies_by_category


def _normalize_key(name: str) -> str:
    return name.strip().lower()


def _canonical_name(name: str, canonical_map: Dict[str, str]) -> str:
    key = _normalize_key(name)
    return canonical_map.get(key, name.strip())


def _dedupe_canonical(items: List[str], canonical_map: Dict[str, str]) -> List[str]:
    seen: Set[str] = set()
    result: List[str] = []
    for item in items:
        if not item or not str(item).strip():
            continue
        canon = _canonical_name(str(item), canonical_map)
        key = _normalize_key(canon)
        if key in seen:
            continue
        seen.add(key)
        result.append(canon)
    return result


def merge_tech_profiles(
    *,
    careers_stack: Optional[List[str]] = None,
    fingerprint_stack: Optional[List[str]] = None,
    dns_services: Optional[List[str]] = None,
    canonical_map: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Union merge for final tech profile.

    All careers tech is kept (no scoring threshold). Baseline fingerprint + DNS
    are merged on top with deduplication.
    """
    canonical_map = canonical_map or {}
    careers_stack = _dedupe_canonical(careers_stack or [], canonical_map)
    fingerprint_stack = _dedupe_canonical(fingerprint_stack or [], canonical_map)
    dns_services = _dedupe_canonical(dns_services or [], canonical_map)
    baseline_stack = _dedupe_canonical(fingerprint_stack + dns_services, canonical_map)

    provenance: Dict[str, Dict[str, Any]] = {}
    final_keys: Dict[str, str] = {}

    for name in careers_stack:
        key = _normalize_key(name)
        final_keys[key] = name
        provenance[name] = {"sources": ["careers"], "score": 1.0, "evidence_count": 1}

    for name in baseline_stack:
        key = _normalize_key(name)
        if key in final_keys:
            existing = final_keys[key]
            sources = provenance[existing]["sources"]
            if "fingerprint" not in sources and name in fingerprint_stack:
                sources.append("fingerprint")
            if "dns" not in sources and name in dns_services:
                sources.append("dns")
            provenance[existing]["sources"] = sorted(set(sources))
            provenance[existing]["evidence_count"] = len(provenance[existing]["sources"])
        else:
            final_keys[key] = name
            sources = []
            if name in fingerprint_stack:
                sources.append("fingerprint")
            if name in dns_services:
                sources.append("dns")
            provenance[name] = {
                "sources": sources or ["fingerprint"],
                "score": 0.7,
                "evidence_count": len(sources) or 1,
            }

    technologies = sorted(final_keys.values())
    return {
        "technologies": technologies,
        "infrastructure": group_technologies_by_category(technologies),
        "tech_provenance": provenance,
        "careers_stack": careers_stack,
        "baseline_stack": baseline_stack,
    }


# Backward-compatible alias
def fuse_tech_stacks(**kwargs) -> Dict[str, Any]:
    kwargs.pop("llm_stack", None)
    kwargs.pop("careers_role_hits", None)
    return merge_tech_profiles(
        careers_stack=kwargs.get("careers_stack"),
        fingerprint_stack=kwargs.get("fingerprint_stack"),
        dns_services=kwargs.get("dns_services"),
        canonical_map=kwargs.get("canonical_map"),
    )
