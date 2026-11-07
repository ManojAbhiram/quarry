"""
Request intake service — business logic for request creation and ICP management.

Layer contract:
  - Receives validated Pydantic models or primitives.
  - Calls LLM/scraper services and DB helpers; never imports from app.api.
  - Returns plain dicts or Pydantic models — no HTTP concerns.
"""
import asyncio
import io
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import HTTPException, UploadFile

from app.core.utils import normalize_urls_list

from app.db.competitor_analyses import upsert_competitor_analysis
from app.db.icp_profiles import upsert_icp_profile
from app.db.requests import insert_complete_lead_request
from app.db.mongo_ids import id_query
from app.db.product_intake import upsert_product_intake
from app.schemas.request_intake import (
    RequestIntakeCreate,
    ConsistencyCheckResponse,
    StructuredICP,
)
from app.services.llm import (
    check_icp_consistency,
    extract_intake_from_text,
    generate_chip_suggestion,
    generate_structured_icp,
)
from app.services.scraper import scrape_url_with_discovery

logger = logging.getLogger("app.services.request_intake_service")

_SUPPORTED_EXTENSIONS = {"txt", "pdf", "docx", "pptx"}


# ── Source-content extraction ─────────────────────────────────────────────────

async def _text_from_file(file: UploadFile) -> str:
    filename = file.filename or "document"
    content_type = file.content_type or ""
    raw_bytes = await file.read()
    if not raw_bytes:
        return ""

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext == "txt" or "text/plain" in content_type:
        return raw_bytes.decode("utf-8", errors="replace")

    if ext == "pdf" or "pdf" in content_type:
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(raw_bytes))
            return "\n\n".join(p.extract_text() for p in reader.pages if p.extract_text())
        except Exception as exc:
            logger.error("PDF parse error for %s: %s", filename, exc)
            return ""

    if ext == "docx":
        try:
            import xml.etree.ElementTree as ET
            import zipfile
            ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as z:
                root = ET.fromstring(z.read("word/document.xml"))
            paras = []
            for para in root.findall(".//w:p", ns):
                text = "".join(t.text for t in para.findall(".//w:t", ns) if t.text)
                if text:
                    paras.append(text)
            return "\n".join(paras)
        except Exception as exc:
            logger.error("DOCX parse error for %s: %s", filename, exc)
            return ""

    if ext == "pptx":
        try:
            import xml.etree.ElementTree as ET
            import zipfile
            ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as z:
                slide_files = sorted(
                    n for n in z.namelist()
                    if n.startswith("ppt/slides/slide") and n.endswith(".xml")
                )
                slides = []
                for sf in slide_files:
                    root = ET.fromstring(z.read(sf))
                    texts = [t.text for t in root.findall(".//a:t", ns) if t.text]
                    if texts:
                        slides.append(" ".join(texts))
            return "\n\n".join(slides)
        except Exception as exc:
            logger.error("PPTX parse error for %s: %s", filename, exc)
            return ""

    raise HTTPException(
        status_code=415,
        detail=f"Unsupported file type '{ext}' for {filename}. Allowed: txt, pdf, docx, pptx.",
    )



async def analyze_sources(
    description: Optional[str],
    files: Optional[List[UploadFile]],
    urls: Optional[str],
) -> dict:
    chunks: List[str] = []

    if description and description.strip():
        chunks.append(f"\n\n--- User Description ---\n{description.strip()}")

    if files:
        file_texts = await asyncio.gather(*[_text_from_file(f) for f in files])
        for file, text in zip(files, file_texts):
            if text:
                chunks.append(f"\n\n--- Content from {file.filename} ---\n{text}")

    if urls:
        url_list = normalize_urls_list(urls)
        if url_list:
            results = await asyncio.gather(
                *[scrape_url_with_discovery(u) for u in url_list],
                return_exceptions=True,
            )
            for url, result in zip(url_list, results):
                if isinstance(result, Exception):
                    logger.error("Scrape failed for %s: %s", url, result)
                    continue
                page_text, structured = result
                combined = page_text or ""
                if structured:
                    header = "\n".join(f"{k}: {v}" for k, v in structured.items() if v)
                    combined = f"{header}\n\n{combined}" if header else combined
                if combined.strip():
                    chunks.append(f"\n\n--- Content from {url} ---\n{combined}")

    combined_text = "".join(chunks).strip()
    if not combined_text:
        raise HTTPException(
            status_code=400,
            detail="No readable content found. Provide a description, valid URLs, or supported documents.",
        )

    extracted = await extract_intake_from_text(combined_text)
    if not extracted:
        raise HTTPException(
            status_code=422,
            detail="AI could not extract product attributes. Ensure your inputs describe the product in detail.",
        )
    return extracted


# ── ICP ───────────────────────────────────────────────────────────────────────

async def suggest_chip(
    chip_type: str,
    product_name: str,
    product_category: str,
    current_description: str,
) -> str:
    return await generate_chip_suggestion(
        chip_type=chip_type,
        product_name=product_name,
        category=product_category,
        description=current_description,
    )


def _neutralize_icp_confidence(icp_data: dict) -> dict:
    for key in ("firmographic", "technographic", "team_structure", "buying_signals", "compliance", "deployment_pref"):
        dim = icp_data.get(key)
        if isinstance(dim, dict):
            dim["confidence"] = "High Confidence"
            dim["warning"] = None
        elif isinstance(dim, str):
            icp_data[key] = {"value": dim, "confidence": "High Confidence", "warning": None}
    return icp_data


async def generate_icp(intake_data: dict, request_id: str, user_id: str) -> dict:
    icp_data = await generate_structured_icp(intake_data)
    icp_data = _neutralize_icp_confidence(icp_data)

    try:
        await upsert_icp_profile(request_id, icp_data)
    except Exception as exc:
        logger.warning("icp_profile upsert failed for request %s: %s", request_id, exc)

    try:
        await upsert_competitor_analysis(
            request_id=request_id,
            user_id=user_id,
            product_description=intake_data.get("product_description", ""),
            status="Pending",
        )
    except Exception as exc:
        logger.warning("competitor_analysis upsert failed for request %s: %s", request_id, exc)

    return icp_data


async def check_consistency(icp_data: dict) -> ConsistencyCheckResponse:
    result = await check_icp_consistency(icp_data)
    return ConsistencyCheckResponse(**result)


# ── Request creation ──────────────────────────────────────────────────────────

def _extract_icp_value(dim) -> str:
    if hasattr(dim, "value"):
        return dim.value
    if isinstance(dim, dict) and "value" in dim:
        return dim["value"]
    return str(dim)


def _build_ideal_lead_profile(intake, icp) -> str:
    return (
        f"Product Name: {intake.product_name}\n"
        f"One-liner: {intake.one_liner}\n"
        f"Primary Value Prop: {intake.primary_value_prop}\n"
        f"Geography: {intake.target_geographies}\n\n"
        f"FIRMOGRAPHIC:\n{_extract_icp_value(icp.firmographic)}\n\n"
        f"TECHNOGRAPHIC:\n{_extract_icp_value(icp.technographic)}\n\n"
        f"TEAM STRUCTURE:\n{_extract_icp_value(icp.team_structure)}\n\n"
        f"BUYING SIGNALS:\n{_extract_icp_value(icp.buying_signals)}\n\n"
        f"COMPLIANCE:\n{_extract_icp_value(icp.compliance)}\n\n"
        f"DEPLOYMENT PREFERENCES:\n{_extract_icp_value(icp.deployment_pref)}"
    )


async def create_request(
    body: RequestIntakeCreate,
    user_id: str,
    draft_id: Optional[str] = None,
) -> str:
    """Persist the request (new or from draft) and return the request_id."""
    from app.db.database import get_db

    db = get_db()
    created_at = datetime.utcnow()

    if draft_id:
        doc = await db.requests.find_one({
            **id_query("_id", draft_id),
            **id_query("user_id", user_id),
        })
        if not doc:
            raise HTTPException(status_code=404, detail="Draft request not found")
        created_at = doc.get("created_at", created_at)

    request_doc = {
        "title": f"{body.product_intake.product_name} Lead Request",
        "business_type": body.product_intake.product_category,
        "target_location": body.product_intake.target_geographies,
        "ideal_lead_profile": _build_ideal_lead_profile(body.product_intake, body.icp_dimensions),
        "product_description": body.product_intake.product_description,
        "status": "Pending",
        "created_at": created_at,
        "updated_at": datetime.utcnow(),
    }

    if draft_id:
        request_doc["user_id"] = user_id
        request_doc["_id"] = doc["_id"]
        await db.requests.replace_one({"_id": doc["_id"]}, request_doc)
        request_id = str(doc["_id"])
        logger.info("Updated draft %s → Pending", request_id)
    else:
        request_id = await insert_complete_lead_request(request_doc.copy(), user_id)

    try:
        await upsert_product_intake(request_id, body.product_intake.model_dump())
    except Exception as exc:
        logger.warning("product_intake upsert failed for request %s: %s", request_id, exc)

    try:
        await upsert_icp_profile(request_id, body.icp_dimensions.model_dump())
    except Exception as exc:
        logger.warning("icp_profile upsert failed for request %s: %s", request_id, exc)

    return request_id


async def create_direct_companies_request(
    body,
    user_id: str,
    draft_id: Optional[str] = None,
) -> str:
    """Persist a 'direct companies → decision makers' request and return its id.

    This flow has no product intake / ICP. The list of companies and target
    roles are stored on the request doc for provenance; the pipeline receives
    them directly via the launch endpoint.
    """
    from app.db.database import get_db

    db = get_db()
    created_at = datetime.utcnow()

    title = (body.title or "").strip()
    if not title:
        first = body.companies[0].strip() if body.companies else "Companies"
        extra = len(body.companies) - 1
        title = f"{first}{f' +{extra} more' if extra > 0 else ''} — Decision Makers"

    request_doc = {
        "title": title,
        "business_type": "",
        "target_location": "",
        "request_type": "direct_companies",
        "ideal_lead_profile": (
            f"Decision Makers: {', '.join(body.target_roles)}" if body.target_roles else ""
        ),
        "product_description": "",
        "input_companies": [c.strip() for c in body.companies if c and c.strip()],
        "target_roles": [r.strip() for r in body.target_roles if r and r.strip()],
        "status": "Pending",
        "created_at": created_at,
        "updated_at": datetime.utcnow(),
    }

    if draft_id:
        doc = await db.requests.find_one({
            **id_query("_id", draft_id),
            **id_query("user_id", user_id),
        })
        if not doc:
            raise HTTPException(status_code=404, detail="Draft request not found")
        request_doc["created_at"] = doc.get("created_at", created_at)
        request_doc["user_id"] = user_id
        request_doc["_id"] = doc["_id"]
        await db.requests.replace_one({"_id": doc["_id"]}, request_doc)
        logger.info("Updated draft %s → Pending (direct companies)", doc["_id"])
        return str(doc["_id"])

    return await insert_complete_lead_request(request_doc.copy(), user_id)
