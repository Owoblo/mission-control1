"""Versioned source-taxonomy mappings; no name-based buying-intent inference."""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from .store import stable_id

VERSION = "ssm-source-taxonomy-crosswalk/2026-10-26.2"
# These patterns operate exclusively on publisher category labels. They never
# inspect organisation names, websites, people, or generated descriptions.
RULES = {
    "manufacturing": r"manufactur|fabricat|industrial_equipment|machine_shop|metal_work|tool_and_die|mould|mold_maker|automotive_supplier",
    "wholesale_distribution": r"wholesale|distribut(?:or|ion)|warehouse",
    "retail_franchises": r"(?:^|_)(?:shopping|retail|auto_dealer)(?:_|$)|(?:^|_)(?:store|shop|retailer)(?:_|$)|appliance_dealer",
    "construction_fitout": r"contractor|construction|renovat|remodel|carpenter|carpentry|electrician|plumb|hvac|roofing|flooring_install|kitchen_and_bath|painting_service|landscap|interior_design",
    "property_facilities": r"real_estate|property_manag|facility_manag|facilities|commercial_property|office_building|shopping_cent(?:er|re)|industrial_park",
    "professional_offices": r"professional_service|accountant|accounting|attorney|law_firm|lawyer|notary|consult|corporate_or_business_office|architect|engineering_service|surveyor|bookkeep",
    "technology_telecom": r"software|telecom|computer_service|information_technology|data_cent(?:er|re)|web_design|computer_programming|internet_service",
    "finance_insurance": r"financial|insurance|bank(?:_|$)|credit_union|mortgage|investment|securities|wealth_manag",
    "healthcare": r"clinic|dental|dentist|doctor|hospital|medical|health_service|pharmacy|physio|physical_therapy|chiroprac|optometr|optician|counseling|naturopath|massage_therapy|home_health",
    "education_research": r"school|college|university|research_institut|educational|education_service|tutor|training_cent(?:er|re)|daycare|child_care",
    "hospitality": r"restaurant|(?:^|_)(?:hotel|motel|resort|cafe|pub|bar|bakery|catering|coffee_shop|campground)(?:_|$)|bed_and_breakfast|banquet|food_truck",
    "senior_living": r"retirement_home|nursing_home|assisted_living|senior_living|long_term_care",
    "government_agencies": r"government|municipal_office|city_hall|public_administration|post_office|fire_station|police_station|public_library",
    "nonprofit_community": r"community_service|social_service|charit|nonprofit|non_profit|place_of_worship|church|mosque|synagogue|temple|religious|community_cent(?:er|re)|association|labou?r_union|trade_union|real_estate_board|chamber_of_commerce",
    "sports": r"sports|sporting|athletic|arena|stadium|skating|martial_arts|gym(?:_|$)|fitness|golf|tennis|swimming|hockey|soccer|baseball|basketball|football|curling|dance_studio",
    "arts_culture_events_media": r"museum|art_gallery|performing_arts|theat(?:re|er)|cinema|media|broadcast|newspaper|publishing|photograph|event_planning|event_venue|cultural",
    "restoration_storage_logistics": r"storage|moving_company|mover|logistic|freight|courier|trucking|restoration|delivery_service|junk_removal|transportation|cleaning_service",
    "agriculture_food": r"(?:^|_)(?:farm|agriculture|greenhouse)(?:_|$)|food_process|food_manufactur|winery|brewery|grain|dairy_farm|orchard|aquaculture",
    "utilities_infrastructure": r"utility|utilities|power_station|water_treatment|wastewater|electric_power|natural_gas_supplier|renewable_energy",
}
NON_ORGANISATION = {"park", "historic_site", "atm", "monument", "picnic_site", "public_art", "viewpoint", "beach", "trailhead", "public_toilet", "fountain", "parking", "parking_lot", "bus_stop", "charging_station"}


def mapped_families(taxonomy, category, families):
    label = str(category or "").strip()
    if not label:
        return []
    if str(taxonomy).upper().startswith("NAICS"):
        code = re.sub(r"\.0$", "", label)
        if not re.fullmatch(r"\d{2,6}", code):
            return []
        matches = [(len(prefix), item["id"]) for item in families for prefix in item.get("naics_prefix_hints", []) if code.startswith(prefix)]
        longest = max((length for length, _ in matches), default=0)
        return sorted({family for length, family in matches if length == longest})
    # Only map controlled Overture category labels. Directory free text stays
    # source_category until a reviewed mapping is added; no invented NAICS.
    if not str(taxonomy).casefold().startswith("overture"):
        return []
    normalized = re.sub(r"[^a-z0-9]+", "_", label.casefold()).strip("_")
    return sorted(family for family, pattern in RULES.items() if re.search(pattern, normalized))


def classify(store, *, batch_size=1000, progress=None):
    if not 1 <= batch_size <= 10000:
        raise ValueError("Classification batch size must be 1-10000")
    families = json.loads((Path(__file__).parent / "config/taxonomy.json").read_text())["industry_families"]
    inserted = contexts = examined = 0
    counts = Counter()
    cursor = ""
    # Finish each bounded read before writing this table. Derived mappings are
    # excluded from the keyset, so new mapping IDs cannot skip source labels.
    # Per-batch commits bound RAM/WAL and retain safe replay after interruption.
    while True:
        source_rows = store.db.execute("""SELECT c.* FROM classifications c
            WHERE c.id>? AND c.taxonomy<>'ssm_industry_family' AND c.taxonomy<>'ssm_discovery_context'
            ORDER BY c.id LIMIT ?""", (cursor, batch_size)).fetchall()
        if not source_rows:
            break
        with store.transaction():
            for source in source_rows:
                for family in mapped_families(source["taxonomy"], source["category"], families):
                    ident = stable_id("taxonomy-crosswalk", VERSION, source["id"], family)
                    result = store.db.execute("""INSERT OR IGNORE INTO classifications
                        (id,entity_id,entity_type,taxonomy,category,classification_method,confidence,evidence_id,review_status)
                        VALUES(?,?,?,'ssm_industry_family',?,?,NULL,?,'source_mapped')""",
                        (ident, source["entity_id"], source["entity_type"], family, VERSION, source["evidence_id"]))
                    inserted += result.rowcount
                    counts[family] += result.rowcount
                if str(source["taxonomy"]).casefold().startswith("overture") and source["category"] in NON_ORGANISATION:
                    result = store.db.execute("""INSERT OR IGNORE INTO classifications
                        (id,entity_id,entity_type,taxonomy,category,classification_method,confidence,evidence_id,review_status)
                        VALUES(?,?,?,'ssm_discovery_context','non_organisation_place_candidate',?,NULL,?,'source_mapped')""",
                        (stable_id("place-context", VERSION, source["id"]), source["entity_id"], source["entity_type"], VERSION, source["evidence_id"]))
                    contexts += result.rowcount
        examined += len(source_rows)
        cursor = source_rows[-1]["id"]
        if progress:
            progress({"source_classifications_examined": examined,
                "new_industry_classifications": inserted, "new_non_organisation_place_flags": contexts,
                "last_source_classification_id": cursor})
    return {"mapping_version": VERSION, "source_classifications_examined": examined,
            "new_industry_classifications": inserted, "new_non_organisation_place_flags": contexts,
            "new_classifications_by_family": dict(counts),
            "policy": "Mappings describe source-indicated industry only. Unmapped labels stay uncategorised; no buying intent, franchise ownership, capability, people, or contact eligibility is inferred."}
