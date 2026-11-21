"""Official charity and institution observations, with honest registry scope.

CRA annual-return identification is historical registration evidence, not a live
status check. Its addresses remain mailing/registered addresses, never verified
campuses. No people, guessed emails, company sizes or outreach are generated.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from lxml import html

from .geography import configured_footprint
from .store import dumps, normalise, stable_id, stamp
from .transport import BudgetExceeded, SourceBlocked, Transport

CRA_DATASET = "80c00cdb-1358-415c-bb8b-0de7f12675b8"
CRA_PAGE = "https://open.canada.ca/data/en/dataset/" + CRA_DATASET
CRA_API = "https://open.canada.ca/data/api/action/package_show?id=" + CRA_DATASET
CRA_LICENCE = "https://open.canada.ca/en/open-government-licence-canada"
CRA_REQUEST = "https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/guidance-videos-forms/request-charities-listings.html"
ROSTER_SOURCES = [
    {"id": "toronto-york-labour-council-affiliates", "name": "Toronto and York Region Labour Council", "url": "https://www.labourcouncil.ca/affiliates/", "kind": "labour_affiliates", "entity_type": "association", "family": "nonprofit_community", "geography_scope": ["Toronto", "York Region"], "source_date": None},
    {"id": "ocs-union-local-directory", "name": "Ontario Construction Secretariat", "url": "https://iciconstruction.com/industry-links/", "terms_url": "https://iciconstruction.com/terms-and-conditions/", "kind": "union_directory", "entity_type": "association", "family": "nonprofit_community", "geography_scope": ["Ontario"], "source_date": None},
    {"id": "ontario-public-university-roster", "name": "Government of Ontario public university roster", "url": "https://www.ontario.ca/page/ontario-universities", "kind": "public_universities", "entity_type": "institution", "family": "education_research", "geography_scope": ["Ontario"], "source_date": None},
    {"id": "ontario-agencies-roster-discovery", "name": "Government of Ontario agencies, boards and commissions", "url": "https://www.ontario.ca/page/agencies-boards-and-commissions", "kind": "source_discovery", "entity_type": "government_body", "family": "government_agencies", "geography_scope": ["Ontario"], "source_date": None},
    {"id": "ontario-public-appointments-bodies", "name": "Ontario Public Appointments Secretariat", "url": "https://www.pas.gov.on.ca/Home/Agencies-list", "kind": "provincial_agencies", "entity_type": "institution", "family": None, "geography_scope": ["Ontario"], "source_date": None, "notes": "Roster includes provincial agencies AND community bodies, professional councils and institutional boards. Do not classify every listed organisation as a government body. Ministry column is preserved separately; names of appointees are not collected."},
    {"id": "canada-departments-agencies-roster", "name": "Government of Canada departments and agencies", "url": "https://www.canada.ca/en/government/dept.html", "kind": "federal_departments", "entity_type": "government_body", "family": "government_agencies", "geography_scope": ["Canada"], "source_date": None},
    {"id": "orea-member-board-schedule-discovery", "name": "OREA member-board schedule (revised October 2024)", "url": "https://realtors-care.nyc3.cdn.digitaloceanspaces.com/4.-List-of-Member-Boards-and-Map.pdf", "kind": "pdf_roster_discovery", "entity_type": "association", "family": "nonprofit_community", "geography_scope": ["Ontario"], "source_date": "2024-10", "notes": "First-party by-law schedule hosted by Ontario REALTORS Care Foundation. Former boards must not be counted as current independent boards. Revision month explicit; current 2026 membership and bulk reuse remain unverified."},
]


def _csv_rows(body):
    try:
        body.decode("utf-8-sig")
        encoding = "utf-8-sig"
    except UnicodeDecodeError:
        encoding = "cp1252"
    return csv.DictReader(io.TextIOWrapper(io.BytesIO(body), encoding=encoding, newline=""))


def _get(row, *names):
    keys = {normalise(key): key for key in row}
    for name in names:
        key = keys.get(normalise(name))
        if key is not None:
            return str(row.get(key) or "").strip()
    return ""


def charity_websites(body):
    records = defaultdict(list)
    for row in _csv_rows(body):
        bn = _get(row, "BN/NE", "BN", "Business Number").replace(" ", "").upper()
        if re.fullmatch(r"\d{9}RR\d{4}", bn):
            records[bn].append(row)
    return records


def iter_cra_identification(body, *, observed_at, source_url, source_published_at=None,
                            web_records=None, footprint_labels=None, stats=None):
    """Yield Ontario annual-return records; never manufacture current status."""
    stats = stats if stats is not None else {}
    for name in ("national_rows", "ontario_rows", "accepted_rows", "invalid_records", "outside_ontario", "country_conflicts", "duplicate_bns", "exact_service_label_matches"):
        stats.setdefault(name, 0)
    seen = set()
    labels = {normalise(value) for value in (footprint_labels or [])}
    reader = _csv_rows(body)
    required = {"bn", "legalname", "city", "province"}
    if not required.issubset({normalise(value) for value in reader.fieldnames or []}):
        raise SourceBlocked("CRA Identification headers changed; preserve raw file and review parser")
    for raw in reader:
        stats["national_rows"] += 1
        if normalise(_get(raw, "Province")) not in ("on", "ontario"):
            stats["outside_ontario"] += 1
            continue
        stats["ontario_rows"] += 1
        country_raw = _get(raw, "Country")
        country_code = normalise(country_raw)
        if country_code and country_code not in ("ca", "can", "canada"):
            stats["country_conflicts"] += 1
            continue
        bn = _get(raw, "BN").replace(" ", "").upper()
        legal_name = _get(raw, "Legal Name")
        account_name = _get(raw, "Account Name")
        if not re.fullmatch(r"\d{9}RR\d{4}", bn) or not (legal_name or account_name):
            stats["invalid_records"] += 1
            continue
        if bn in seen:
            stats["duplicate_bns"] += 1
        seen.add(bn)
        city = _get(raw, "City") or None
        matching_label = bool(city and normalise(city) in labels)
        stats["exact_service_label_matches"] += int(matching_label)
        contacts = (web_records or {}).get(bn, [])
        urls = sorted({value for entry in contacts for value in [_get(entry, "Contact URL", "URL")] if value})
        websites = [url for url in urls if urlsplit(url).scheme in ("https", "http") and urlsplit(url).hostname]
        category, subcategory, designation = (_get(raw, field) for field in ("Category", "Sub Category", "Designation"))
        stats["accepted_rows"] += 1
        yield {"name": account_name or legal_name, "legal_name": legal_name or None,
               "source_record_id": bn, "registration_id": bn, "registration_jurisdiction": "CA-CRA-charity",
               "entity_type": "nonprofit", "address": ", ".join(value for value in (_get(raw, "Address Line 1"), _get(raw, "Address Line 2")) if value) or None,
               "city": city, "province": "ON", "country": "CA" if country_code else None,
               "postal_code": _get(raw, "Postal Code") or None, "location_type": "mailing_address",
               "website": websites[0] if len(websites) == 1 else None, "website_candidates": urls,
               "categories": ["CRA annual-return registered charity identification"] + [prefix + value for prefix, value in (("CRA Category:", category), ("CRA Sub Category:", subcategory), ("CRA Designation:", designation)) if value],
               "taxonomy": "CRA-T3010-2024", "source_url": source_url, "observed_at": observed_at,
               "source_published_at": source_published_at, "registry_return_year": 2024,
               "registration_status_current": "unverified", "registration_status_evidence_scope": "Reported in CRA 2024 annual-return Identification dataset; no live status field",
               "address_role": "registered_or_mailing_address_not_verified_physical_site",
               "service_area_label_match": matching_label,
               "service_area_label_match_scope": "Exact configured locality label only; not administrative-boundary or campaign eligibility determination",
               "raw_payload": {"identification": raw, "published_web_url_records": contacts}}
    stats["unique_bns"] = len(seen)


def _document(body):
    document = html.fromstring(body.decode("utf-8-sig", errors="replace") if isinstance(body, bytes) else body)
    for node in document.xpath("//script|//style|//noscript|//nav|//header|//footer"):
        node.drop_tree()
    return document


def _text(node):
    return " ".join(" ".join(node.xpath(".//text()")).split())


def parse_institution_roster(body, source):
    """Extract public organisation names; affiliation is never a premises address."""
    document = _document(body)
    result = {}
    if source["kind"] == "labour_affiliates":
        for item in document.xpath("//li"):
            name = _text(item)
            if name and len(name) <= 180:
                links = item.xpath(".//a/@href")
                parent = item.xpath("preceding::h3[1] | preceding::h4[1] | preceding::h5[1]")
                result[name] = {"name": name, "website": links[0] if len(links) == 1 and links[0].startswith(("https://", "http://")) else None, "supporting_excerpt": name, "relationship_predicate": "member_of", "listed_parent_union": _text(parent[-1]) if parent else None}
        # This publisher also formats its OPSEU locals as bullet paragraphs.
        for paragraph in document.xpath("//p"):
            text = _text(paragraph)
            if "•" in text:
                for name in text.split("•"):
                    name = name.strip()
                    if re.fullmatch(r"OPSEU\s+Local\s+[A-Za-z0-9/-]+", name):
                        result[name] = {"name": name, "supporting_excerpt": name, "relationship_predicate": "member_of"}
    elif source["kind"] == "union_directory":
        for anchor in document.xpath("//a[@href]"):
            label = _text(anchor)
            if re.search(r"\b(?:local\s*(?:#|union)?\s*\d+|building trades council|labour congress)\b", label, re.I) and 3 < len(label) <= 180:
                target = urljoin(source["url"], anchor.get("href"))
                if urlsplit(target).scheme in ("https", "http"):
                    result[label] = {"name": label, "website": target, "supporting_excerpt": label, "relationship_predicate": "listed_by"}
    elif source["kind"] == "provincial_agencies":
        for table_row in document.xpath("//table//tr"):
            cells = table_row.xpath("./td")
            if len(cells) < 2:
                continue
            anchors = cells[1].xpath(".//a[@href]")
            if anchors:
                name = _text(anchors[0])
                if name:
                    result[name] = {"name": name, "profile_url": urljoin(source["url"], anchors[0].get("href")), "responsible_ministry": _text(cells[0]), "supporting_excerpt": name, "public_roster_role": "agency_or_community_body_with_public_appointments"}
    elif source["kind"] in ("public_universities", "federal_departments"):
        for table_row in document.xpath("//table//tr"):
            links = table_row.xpath(".//a[@href]")
            if not links:
                continue
            if source["kind"] == "public_universities":
                cells = table_row.xpath("./td")
                if not cells:
                    continue
                cell = html.fromstring(html.tostring(cells[-1], encoding="unicode"))
                for linebreak in cell.xpath(".//br"):
                    linebreak.tail = "\n" + (linebreak.tail or "")
                for paragraph in cell.xpath(".//p"):
                    paragraph.tail = "\n" + (paragraph.tail or "")
                lines = [" ".join(line.split()) for line in cell.text_content().splitlines() if line.strip()]
                name = lines[0] if lines else ""
            else:
                name = _text(links[0])
            if name and len(name) <= 180 and not re.fullmatch(r"https?://.*|www\..*", name):
                websites = [urljoin(source["url"], a.get("href")) for a in links if a.get("href", "").startswith(("https://", "http://"))]
                websites = sorted(set(websites))
                result[name] = {"name": name, "website": websites[0] if len(websites) == 1 else None, "supporting_excerpt": name}
    return list(result.values())


def _save_gzip(path, body):
    temporary = path.with_suffix(path.suffix + ".tmp")
    with gzip.open(temporary, "wb", compresslevel=6) as handle:
        handle.write(body)
    temporary.replace(path)


def acquire_charities(output, *, include_websites=True):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    transport = Transport(max_requests=15, max_bytes=35_000_000, max_response_bytes=20_000_000,
                          min_interval=.35, retries=1, allowed_hosts=["open.canada.ca", "opencanada.blob.core.windows.net"])
    manifest = {"kind": "cra_charity_identification", "observed_at": stamp(), "status": "pending", "dataset_url": CRA_PAGE,
                "current_status_route": CRA_REQUEST, "current_status_route_status": "manual_request_not_submitted",
                "limitations": ["Annual 2024 return identification is not current charity-status validation.", "Registered/mailing addresses are not verified physical operating sites or campuses.", "Registered-charity account identifiers are not presumed legal corporation registration numbers.", "Ontario province filter is separate from an exact current-service-label match."]}
    try:
        metadata_response = transport.fetch(CRA_API)
        metadata = metadata_response.json()["result"]
        if metadata.get("license_id") != "ca-ogl-lgo":
            raise SourceBlocked("CRA dataset licence is not the reviewed Open Government Licence - Canada")
        licence = transport.fetch(CRA_LICENCE)
        licence_text = _text(_document(licence.body))
        if "commercial" not in licence_text.casefold() or "licence" not in licence_text.casefold():
            raise SourceBlocked("Official licence text changed; independent reuse review required")
        (output / "cra-package-metadata.json").write_text(json.dumps(metadata, indent=2))
        (output / "cra-licence-evidence.json").write_text(json.dumps({"url": CRA_LICENCE, "license_id": metadata["license_id"], "observed_at": manifest["observed_at"], "content_hash": hashlib.sha256(licence.body).hexdigest(), "scope": "Copy, modify, publish, translate, adapt, distribute and otherwise use under the Open Government Licence - Canada; attribution and licence conditions retained."}, indent=2))
        identification = next(resource for resource in metadata["resources"] if "/ident_2024" in resource.get("url", ""))
        print(json.dumps({"stage": "CRA licence verified; retrieving documented Identification CSV", "source": identification["url"]}), flush=True)
        response = transport.fetch(identification["url"])
        _save_gzip(output / "cra-identification-original.csv.gz", response.body)
        web_records = {}
        if include_websites:
            resource = next((resource for resource in metadata["resources"] if "/weburl_2024" in resource.get("url", "")), None)
            if resource:
                web_response = transport.fetch(resource["url"])
                _save_gzip(output / "cra-websites-original.csv.gz", web_response.body)
                web_records = charity_websites(web_response.body)
        labels = [item["label"] for item in configured_footprint()]
        stats = {}
        destination = output / "ontario-charities.jsonl.gz"
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        examples = []
        with gzip.open(temporary, "wt", encoding="utf-8", compresslevel=6) as handle:
            for row in iter_cra_identification(response.body, observed_at=manifest["observed_at"], source_url=identification["url"], source_published_at=identification.get("last_modified"), web_records=web_records, footprint_labels=labels, stats=stats):
                handle.write(dumps(row) + "\n")
                if len(examples) < 8 and row["service_area_label_match"]:
                    examples.append({key: row[key] for key in ("name", "source_record_id", "city", "location_type", "registration_status_current")})
        temporary.replace(destination)
        source = {"id": "cra-charities-2024-identification", "name": "CRA 2024 List of charities — Identification, Ontario mailing-address filter", "publisher": "Canada Revenue Agency", "source_url": identification["url"], "source_type": "charity_registry", "geography_scope": ["Ontario"], "sector_scope": ["nonprofit_community"], "access_method": "documented_bulk_download", "retrieval_status": "accessible", "rights_status": "licensed_open", "terms_url": CRA_LICENCE, "cost_model": "free", "source_date": identification.get("last_modified"), "last_checked_at": manifest["observed_at"], "adapter_name": "cra_identification_2024", "count_definition": "Identification rows from charities reporting for 2024; Ontario mailing province, not a current charity-status or physical-site census", "notes": "Source: Canada Revenue Agency, 2024 List of charities, Open Government Licence - Canada. Current status unverified. Mailing addresses only. Full BN/RR identifies the CRA charity account, not necessarily a legal corporation."}
        manifest.update({"status": "acquired", "source": source, "stats": stats, "source_sha256": hashlib.sha256(response.body).hexdigest(), "records_file": destination.name, "records_sha256": hashlib.sha256(destination.read_bytes()).hexdigest(), "examples": examples, "metadata_modified": metadata.get("metadata_modified"), "resource_published_at": identification.get("last_modified")})
    except (SourceBlocked, BudgetExceeded, StopIteration, KeyError) as exc:
        manifest.update({"status": "blocked", "error": str(exc)})
    manifest["metrics"] = transport.metrics()
    (output / "cra-manifest.json").write_text(json.dumps(manifest, indent=2))
    if manifest.get("source"):
        registry_path = output / "source-registry-fragment.json"
        existing = json.loads(registry_path.read_text()).get("sources", []) if registry_path.exists() else []
        entries = {entry["id"]: entry for entry in existing}
        entries[manifest["source"]["id"]] = manifest["source"]
        registry_path.write_text(json.dumps({"sources": list(entries.values()), "current_charity_status_manual_route": CRA_REQUEST}, indent=2))
    return manifest


def inspect_rosters(output, source_ids=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    fragments, batches = [], []
    for spec in ROSTER_SOURCES:
        if source_ids and spec["id"] not in source_ids:
            continue
        transport = Transport(max_requests=8, max_bytes=3_000_000, min_interval=.35, timeout=45 if spec["kind"] == "federal_departments" else 20, retries=0,
                              allowed_hosts=[urlsplit(spec["url"]).hostname])
        batch = {"source": spec, "observed_at": stamp(), "status": "pending", "records": [], "policy_observations": [], "followup_urls": []}
        try:
            response = transport.fetch(spec["url"])
            if spec["kind"] == "pdf_roster_discovery":
                batch.update({"status": "manual_parse_required", "content_hash": hashlib.sha256(response.body).hexdigest(), "note": spec.get("notes")})
            else:
                document = _document(response.body)
                batch["parser_structure"] = {"table_rows": len(document.xpath("//table//tr")), "list_items": len(document.xpath("//li")), "heading_samples": [{"tag": node.tag, "text": _text(node)[:150]} for node in document.xpath("//h1|//h2|//h3|//h4|//h5")][:45], "list_samples": [_text(node)[:150] for node in document.xpath("//li")][:12]}
                for anchor in document.xpath("//a[@href]"):
                    target = urljoin(spec["url"], anchor.get("href"))
                    if (".csv" in target.casefold() or re.search(r"/Home/Agencies", target, re.I)) and not re.search(r"/Account/|#", target, re.I):
                        batch["followup_urls"].append({"url": target, "label": _text(anchor)[:180]})
                restriction = None
                if spec.get("terms_url"):
                    policy = transport.fetch(spec["terms_url"])
                    policy_text = _text(_document(policy.body))
                    restriction = re.search(r"(?:may not|shall not|prohibit|without.{0,30}permission).{0,160}(?:reproduc|scrap|automat|redistribut|commercial)", policy_text, re.I)
                    batch["policy_observations"].append({"url": spec["terms_url"], "content_hash": hashlib.sha256(policy.body).hexdigest(), "restriction": restriction.group()[:300] if restriction else None})
                if restriction:
                    batch.update({"status": "reuse_review_required", "note": "Terms require review; no roster rows acquired for automatic import."})
                elif spec["kind"] == "source_discovery":
                    batch["status"] = "source_identified"
                else:
                    batch["records"] = parse_institution_roster(response.body, spec)
                    batch["status"] = "factual_roster_acquired" if batch["records"] else "parser_review_required"
                    batch["content_hash"] = hashlib.sha256(response.body).hexdigest()
        except (SourceBlocked, BudgetExceeded) as exc:
            batch.update({"status": "access_blocked", "error": str(exc)})
        fragment = {"id": spec["id"], "name": spec["name"], "publisher": spec["name"], "source_url": spec["url"], "source_type": "institutional_roster", "geography_scope": spec["geography_scope"], "sector_scope": [spec["family"]] if spec.get("family") else [], "access_method": "bounded_first_party_factual_review", "retrieval_status": "accessible" if batch["status"] == "factual_roster_acquired" else batch["status"], "rights_status": "limited_factual_review_only" if batch["status"] == "factual_roster_acquired" else "unreviewed", "terms_url": spec.get("terms_url"), "source_date": spec.get("source_date"), "last_checked_at": batch["observed_at"], "adapter_name": "institution_roster", "notes": spec.get("notes") or "Public first-party roster facts only; no unrestricted bulk-reuse licence assumed. Affiliation does not prove a local office or current buying authority."}
        batch["source_registry"] = fragment
        batch["metrics"] = transport.metrics()
        (output / (spec["id"] + ".json")).write_text(json.dumps(batch, indent=2))
        fragments.append(fragment)
        batches.append(batch)
        print(json.dumps({"source": spec["id"], "status": batch["status"], "records": len(batch["records"]), "error": batch.get("error")}), flush=True)
    registry_path = output / "source-registry-fragment.json"
    existing = json.loads(registry_path.read_text()).get("sources", []) if registry_path.exists() else []
    sources = {entry["id"]: entry for entry in existing}
    sources.update({entry["id"]: entry for entry in fragments})
    registry_path.write_text(json.dumps({"sources": list(sources.values()), "current_charity_status_manual_route": CRA_REQUEST}, indent=2))
    return batches


def apply_charity_acquisition(store, folder, *, batch_size=500, progress=None):
    """Explicit local import; the caller owns the target DB and no network occurs."""
    from .place_import import _committed_batch, _guard_storage
    if not 1 <= batch_size <= 2000:
        raise ValueError("Charity import batches must be 1–2000 rows")
    folder = Path(folder)
    manifest = json.loads((folder / "cra-manifest.json").read_text())
    if manifest.get("status") != "acquired" or manifest["source"]["rights_status"] != "licensed_open":
        raise SourceBlocked("CRA acquisition is not a verified licensed batch")
    path = folder / manifest["records_file"]
    if hashlib.sha256(path.read_bytes()).hexdigest() != manifest["records_sha256"]:
        raise SourceBlocked("Saved charity batch differs from the acquired source-normalisation artifact")
    source_id = store.upsert_source(manifest["source"])
    report = {"source_id": source_id, "rows": 0, "inserted": 0, "quarantined": 0, "replayed_batches": 0, "mailing_address_only": True, "current_registration_status": "unverified"}

    def ingest(rows, start):
        metrics = manifest["metrics"] if start == 0 else {}
        metadata = {"adapter_name": "cra_identification_2024", "parser_version": "1", "observed_at": manifest["observed_at"], "batch_id": manifest["source_sha256"] + ":" + str(start), "coverage_complete": False, **{key: metrics.get(key, 0) for key in ("requests", "bytes_fetched", "estimated_cost")}}
        if not _committed_batch(store, source_id, rows, metadata):
            _guard_storage(store, rows, {"source_folder": str(folder), "area": "CRA-Ontario-2024", "chunk": start // batch_size})
        with store.transaction():
            outcome = store.ingest(source_id, rows, run_metadata=metadata)
            with store.transaction(), store._buffer_field_assertions():
                for row in rows:
                    identity = store.db.execute("SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?", (source_id, row["source_record_id"])).fetchone()
                    if not identity:
                        continue
                    org, evidence_id = identity["organisation_id"], identity["last_evidence_id"]
                    for field in ("registry_return_year", "registration_status_current", "registration_status_evidence_scope", "address_role", "service_area_label_match", "service_area_label_match_scope"):
                        store.assert_field(org, "organisation", field, row[field], evidence_id, row["observed_at"])
                    store.db.execute("INSERT OR IGNORE INTO classifications(id,entity_id,entity_type,taxonomy,category,classification_method,confidence,evidence_id,review_status) VALUES(?,?,?,'ssm_industry_family','nonprofit_community','official_CRA_annual_return',NULL,?,'source_mapped')", (stable_id("cra-nonprofit-family", org, evidence_id), org, "organisation", evidence_id))
                    store.db.execute("INSERT OR IGNORE INTO external_ids VALUES(?,?,?,?,?,?)", (stable_id("cra-charity-account", row["source_record_id"]), org, "organisation", "CA-CRA-charity", row["source_record_id"], evidence_id))
                    if identity["location_id"]:
                        store.db.execute("UPDATE locations SET status='source_mailing_address_only' WHERE id=? AND location_type='mailing_address' AND manually_verified=0", (identity["location_id"],))
        report["rows"] += len(rows)
        report["inserted"] += 0 if outcome.get("replayed") else outcome["inserted_count"]
        report["quarantined"] += 0 if outcome.get("replayed") else outcome["quarantined_count"]
        report["replayed_batches"] += int(bool(outcome.get("replayed")))
        if progress:
            progress({"kind": "charities", "processed_rows": report["rows"], "batch_start": start, "batch_rows": len(rows), "run_id": outcome["run_id"], "replayed": bool(outcome.get("replayed"))})
    pending, start = [], 0
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            pending.append(json.loads(line))
            if len(pending) >= batch_size:
                ingest(pending, start)
                start += len(pending)
                pending = []
        if pending:
            ingest(pending, start)
    return report


def apply_roster_acquisitions(store, folder, *, progress=None):
    """Import explicit bounded first-party facts; physical offices stay unknown."""
    from .place_import import _committed_batch, _guard_storage
    folder = Path(folder)
    reports = []
    for spec in ROSTER_SOURCES:
        path = folder / (spec["id"] + ".json")
        if not path.exists():
            continue
        batch = json.loads(path.read_text())
        source_id = store.upsert_source(batch["source_registry"])
        if batch.get("status") != "factual_roster_acquired":
            reports.append({"source_id": source_id, "status": batch["status"], "records_imported": 0})
            continue
        rows = []
        for index, record in enumerate(batch["records"]):
            rows.append({"source_record_id": record.get("profile_url") or stable_id("roster-record", spec["url"], record["name"]), "source_url": spec["url"], "name": record["name"], "website": record.get("website"), "entity_type": spec["entity_type"], "country": "CA" if spec["kind"] in ("public_universities", "provincial_agencies", "federal_departments") else None, "province": None, "city": None, "address": None, "observed_at": batch["observed_at"], "supporting_excerpt": record["supporting_excerpt"], "raw_payload": {"source_roster_record": record, "source_content_hash": batch.get("content_hash"), "physical_presence": "not_asserted", "franchise_or_legal_parent": "not_inferred"}})
        metadata = {"adapter_name": "institution_roster", "parser_version": "1", "observed_at": batch["observed_at"], "batch_id": batch.get("content_hash"), "coverage_complete": False, **{key: batch["metrics"].get(key, 0) for key in ("requests", "bytes_fetched", "estimated_cost")}}
        if not _committed_batch(store, source_id, rows, metadata):
            _guard_storage(store, rows, {"source_folder": str(folder), "area": spec["id"], "chunk": 0})
        with store.transaction():
            result = store.ingest(source_id, rows, run_metadata=metadata)
            relationships = 0
            with store.transaction(), store._buffer_field_assertions():
                for row, record in zip(rows, batch["records"]):
                    identity = store.db.execute("SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?", (source_id, row["source_record_id"])).fetchone()
                    if not identity:
                        continue
                    org, evidence_id = identity["organisation_id"], identity["last_evidence_id"]
                    if spec.get("family"):
                        store.db.execute("INSERT OR IGNORE INTO classifications(id,entity_id,entity_type,taxonomy,category,classification_method,confidence,evidence_id,review_status) VALUES(?,?,?,'ssm_industry_family',?,'first_party_institution_roster',NULL,?,'source_mapped')", (stable_id("institution-roster-family", org, evidence_id, spec["family"]), org, "organisation", spec["family"], evidence_id))
                    if record.get("responsible_ministry"):
                        store.assert_field(org, "organisation", "responsible_ministry_source_label", record["responsible_ministry"], evidence_id, row["observed_at"])
                        store.assert_field(org, "organisation", "public_roster_role", record["public_roster_role"], evidence_id, row["observed_at"])
                        ministry_name = record["responsible_ministry"]
                        ministry_id = stable_id("ontario-PAS-ministry", ministry_name)
                        if not store.db.execute("SELECT 1 FROM organisations WHERE id=?", (ministry_id,)).fetchone():
                            store.db.execute("INSERT INTO organisations(id,trading_name,entity_type,country,first_seen_at,last_seen_at,name_normalized) VALUES(?,?,?,?,?,?,?)", (ministry_id, ministry_name, "government_body", "CA", row["observed_at"], row["observed_at"], normalise(ministry_name)))
                            store.assert_field(ministry_id, "organisation", "name", ministry_name, evidence_id, row["observed_at"])
                            store.assert_field(ministry_id, "organisation", "entity_type", "government_body", evidence_id, row["observed_at"])
                        relation_id = stable_id("public-roster-ministry", source_id, org, ministry_id, evidence_id)
                        store.db.execute("INSERT OR IGNORE INTO relationships(id,subject_id,subject_type,predicate,object_id,object_type,asserted_by_source_id,evidence_id,confidence,observed_at,review_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)", (relation_id, org, "organisation", "listed_under_ministry", ministry_id, "organisation", source_id, evidence_id, None, row["observed_at"], "source_listed_unverified"))
                    if record.get("relationship_predicate") == "member_of":
                        publisher_id = stable_id("roster-publisher", spec["id"])
                        if not store.db.execute("SELECT 1 FROM organisations WHERE id=?", (publisher_id,)).fetchone():
                            store.db.execute("INSERT INTO organisations(id,trading_name,entity_type,country,first_seen_at,last_seen_at,name_normalized) VALUES(?,?,?,?,?,?,?)", (publisher_id, spec["name"], "association", None, row["observed_at"], row["observed_at"], normalise(spec["name"])))
                        relation_id = stable_id("first-party-roster-membership", source_id, org, publisher_id, evidence_id)
                        inserted = store.db.execute("INSERT OR IGNORE INTO relationships(id,subject_id,subject_type,predicate,object_id,object_type,asserted_by_source_id,evidence_id,confidence,observed_at,review_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)", (relation_id, org, "organisation", "member_of", publisher_id, "organisation", source_id, evidence_id, None, row["observed_at"], "source_listed_unverified"))
                        relationships += inserted.rowcount
        reports.append({"source_id": source_id, "status": "imported", "records_imported": len(rows), "new_organisations": 0 if result.get("replayed") else result["inserted_count"], "replayed": bool(result.get("replayed")), "new_membership_assertions": relationships, "physical_locations_asserted": 0})
        if progress:
            progress(reports[-1])
    return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--skip-websites", action="store_true")
    parser.add_argument("--skip-charities", action="store_true")
    parser.add_argument("--skip-rosters", action="store_true")
    parser.add_argument("--roster-source", action="append", help="Select configured primary-roster IDs for a bounded follow-up")
    args = parser.parse_args()
    if not args.skip_charities:
        print(json.dumps(acquire_charities(args.output, include_websites=not args.skip_websites)), flush=True)
    if not args.skip_rosters:
        inspect_rosters(args.output, args.roster_source)


if __name__ == "__main__":
    main()
