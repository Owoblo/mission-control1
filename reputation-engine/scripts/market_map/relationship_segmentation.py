"""Evidence-bound segmentation recommendations; never sends or mutates records."""
from __future__ import annotations
import json
from pathlib import Path

CONFIG = json.loads((Path(__file__).parent / "config/relationship-segmentation.json").read_text())

def recommend_channel(record):
    """Select a review channel, preserving the distinction from consent/preference."""
    available = []
    if record.get("mobile_verified") and record.get("route_identity_verified") and record.get("sms_capable"):
        available.append("sms")
    if record.get("professional_email_verified"):
        available.append("email")
    preferred = record.get("explicit_preferred_channel")
    result = {"available_channels": available, "recommended_channel": None,
              "basis": "no_verified_route", "preference_state": "unknown", "send_authorized": False}
    if record.get("suppressed"):
        return {**result, "basis": "suppressed"}
    if preferred == "both" and record.get("preference_evidence"):
        active = record.get("active_conversation_channel")
        selected = active if active in available else ("email" if "email" in available else (available[0] if available else None))
        return {**result, "recommended_channel": selected, "basis": "explicit_multi_channel_preference",
                "preference_state": "explicit", "preference_evidence": record["preference_evidence"],
                "simultaneous_send": False}
    if preferred in {"sms", "email", "phone", "linkedin"} and record.get("preference_evidence"):
        return {**result, "recommended_channel": preferred if preferred in available else None,
                "basis": "explicit_preference" if preferred in available else "preferred_route_requires_review",
                "preference_state": "explicit", "preference_evidence": record["preference_evidence"]}
    active = record.get("active_conversation_channel")
    if active in available and record.get("conversation_evidence"):
        return {**result, "recommended_channel": active, "basis": "existing_conversation", "preference_state": "observed_context"}
    role = str(record.get("contact_role") or "").lower()
    if any(term in role for term in ["finance", "cfo", "procurement", "purchasing"]) and "email" in available:
        return {**result, "recommended_channel": "email", "basis": "role_routing_hypothesis", "preference_state": "not_personally_confirmed"}
    vertical = record.get("vertical")
    if vertical in {"realtor", "mortgage_broker"} and "sms" in available:
        return {**result, "recommended_channel": "sms", "basis": "vertical_routing_hypothesis", "preference_state": "not_personally_confirmed"}
    if "email" in available:
        return {**result, "recommended_channel": "email", "basis": "available_professional_route", "preference_state": "not_personally_confirmed"}
    if "sms" in available:
        return {**result, "recommended_channel": "sms", "basis": "verified_mobile_route_review", "preference_state": "not_personally_confirmed"}
    return result

def employee_size(count, evidence=None):
    if not evidence or isinstance(count, bool) or not isinstance(count, int) or count < 0:
        return "unknown"
    if count == 0: return "non_employer"
    return "small" if count < 100 else "medium" if count < 500 else "large"

def city_sector_cohorts(cities):
    """A complete rotating planning grid; no source-completion assertions."""
    if len({c["id"] for c in cities}) != len(cities):
        raise ValueError("Duplicate city IDs")
    sectors = CONFIG["sector_backbone"]
    rows = []
    for rotation in range(len(sectors)):
        for ordinal, city in enumerate(cities):
            sector = sectors[(rotation + ordinal) % len(sectors)]
            rows.append({"cohort_id": city["id"] + "|NAICS-CA-2022|" + sector["code"],
                         "municipality_id": city["id"], "city": city["name"],
                         "sector_code": sector["code"], "sector": sector["label"],
                         "rotation": rotation + 1, "coverage_state": "requires_existing_inventory_reconciliation",
                         "market_total": None, "coverage_percent": None,
                         "next_action": "Reconcile saved source and identity evidence; record unknowns before new discovery.",
                         "automatic_send": False, "paid_research_authorized_by_cohort": False})
    return rows

def segment_business(record, industry_families=()):
    """Facts retain their evidence; industry-to-service mapping is a hypothesis.

    The caller supplies resolved source industry labels and current CRM state.
    No classification implies delivery capability, employee count, franchise
    ownership, a decision-maker identity, active demand or permission to contact.
    """
    families = sorted(set(industry_families))
    context_only = bool(record.get("non_organisation_place_candidate") or record.get("entity_type") == "invalid_source_record")
    playbooks = [CONFIG["playbooks"].get(f, CONFIG["playbooks"]["default"]) for f in families] or [CONFIG["playbooks"]["default"]]
    recommendations = lambda field: sorted({v for p in playbooks for v in p[field]})
    size = employee_size(record.get("paid_employees"), record.get("employee_count_evidence"))
    reasons = []
    if not families: reasons.append("industry_unresolved")
    if not record.get("municipality_id"): reasons.append("geography_unresolved")
    if size == "unknown": reasons.append("organization_size_unverified")
    if record.get("suppressed"): reasons.append("suppressed")
    if record.get("paused"): reasons.append("preserve_existing_pause")
    if record.get("identity_conflict"): reasons.append("identity_conflict")
    if context_only: reasons.append("geographic_context_not_business_target")
    state = record.get("relationship_state") or "unknown"
    if state in {"active_conversation", "existing_relationship", "customer_led_wait", "meeting_pending"}:
        message_strategy = "existing_context_and_commitments_first"
    elif record.get("contact_role_evidence"):
        message_strategy = "verified_role_relevant_introduction"
    elif record.get("account_structure_evidence") and record.get("account_structure") == "public_institution":
        message_strategy = "facilities_or_supplier_process_review"
    elif record.get("professional_route_evidence"):
        message_strategy = "business_team_introduction_without_invented_name"
    else:
        message_strategy = "verify_business_and_contact_route_first"
    return {
        "version": CONFIG["version"], "organization_id": record.get("id"),
        "geography": {"municipality_id": record.get("municipality_id"), "city": record.get("city")},
        "industry_families": families, "industry_status": "caller_supplied_source_mapping" if families else "unknown",
        "organization_scale": {"band": size, "paid_employees": record.get("paid_employees") if size != "unknown" else None, "evidence": record.get("employee_count_evidence") if size != "unknown" else None},
        "site_type": record.get("site_type") or "unknown",
        "account_structure": record.get("account_structure") if record.get("account_structure_evidence") else "unknown",
        "verified_relationship_roles": record.get("verified_relationship_roles") or [],
        "entity_disposition": "context_only" if context_only else "business_identity_review",
        "research_role_targets": [] if context_only else recommendations("decision_roles"),
        "service_hypotheses": [] if context_only else recommendations("services"),
        "message_angles_for_review": [] if context_only else sorted({p["message_angle"] for p in playbooks}),
        "project_scope": record.get("project_scope") or "unknown",
        "relationship_state": state, "message_strategy": "no_outreach" if context_only else message_strategy,
        "signals": record.get("signals") or [], "review_reasons": reasons,
        "outreach_eligible": False, "automatic_send": False,
    }
