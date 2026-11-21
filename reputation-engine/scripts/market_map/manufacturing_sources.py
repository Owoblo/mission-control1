"""Bounded first-party manufacturing-network facts and licensed historical data.

Association membership is not a manufacturing classification or local office.
No whole website, marketing descriptions, people, guessed contacts or CRM writes.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import re
import shutil
import time
import urllib.error
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urldefrag

from lxml import html

from .store import dumps, normalise, stable_id, stamp
from .transport import Transport, SourceBlocked, BudgetExceeded

SOURCES = [
    {"id": "trillium-manufacturing-ecosystem-roster", "name": "Trillium Network ecosystem directory", "url": "https://trilliummfg.ca/ecosystem_directory/", "kind": "ecosystem", "profile_path": "/ecosystem_partners/", "parent_name": None},
    {"id": "automate-canada-members", "name": "Automate Canada member directory", "url": "https://automatecanada.org/companies/", "kind": "automate", "profile_path": "/companies/", "parent_name": "Automate Canada"},
    {"id": "camm-member-directory", "name": "Canadian Association of Mold Makers member directory", "url": "https://canadianassociationofmoldmakers.com/members-directory/", "kind": "camm", "profile_path": "/members-directory/", "parent_name": "Canadian Association of Mold Makers"},
]
ODBUS_PAGE = "https://www150.statcan.gc.ca/n1/pub/21-26-0003/212600032023001-eng.htm"
ODBUS_ZIP = "https://www150.statcan.gc.ca/n1/pub/21-26-0003/2023001/ODBus_2023.zip"
LICENCE = "https://open.canada.ca/en/open-government-licence-canada"
EXCLUDED_HOSTS = {"facebook.com", "linkedin.com", "instagram.com", "twitter.com", "x.com", "youtube.com", "youtu.be", "google.com", "goo.gl", "maps.google.com", "matrixgroupinc.net"}
ON_ADDRESS = re.compile(r"(?P<address>\d[^\n]{3,150}?)(?:,\s*|\n+)(?P<city>[^,\n]{2,55}),\s*(?P<province>ON|Ontario)\s*,?\s+(?P<postal>[KLMNP]\d[A-Z][ -]?\d[A-Z]\d)\b", re.I)
PRELIMINARY_INSPECTION = {"requests": 24, "bytes_fetched": 971887,
    "note": "Prior guarded page/robots/card-schema inspection and one official ZIP HEAD; metadata records only."}


def text(node):
    return " ".join(node.text_content().split())


def decoded_body(response, limit=6_000_000):
    """Decode HTTP gzip within a separate decompressed-body ceiling."""
    body = response.body
    if response.headers.get("Content-Encoding", "").lower() == "gzip" or body.startswith(b"\x1f\x8b"):
        with gzip.GzipFile(fileobj=io.BytesIO(body)) as stream:
            body = stream.read(limit + 1)
    if len(body) > limit:
        raise BudgetExceeded("Decoded HTML exceeds bounded parser budget")
    if any(token in body[:10000].lower() for token in (b"cf-chl-", b"verify you are human", b".well-known/sgcaptcha")):
        raise SourceBlocked("Decoded access challenge; no bypass attempted")
    return body


def document(response):
    try:
        doc = html.fromstring(decoded_body(response))
    except (ValueError, gzip.BadGzipFile, EOFError) as exc:
        raise SourceBlocked("Invalid public HTML response") from exc
    for node in doc.xpath("//script|//style|//noscript"):
        node.drop_tree()
    if not doc.xpath("//h1|//h2|//h3"):
        raise SourceBlocked("Page lacks expected public HTML headings")
    return doc


def parse_roster(doc, spec, page_url):
    results = {}
    if spec["kind"] == "ecosystem":
        nodes = doc.xpath("//a[h3[contains(@class,'profile-title')]]")
    elif spec["kind"] == "automate":
        nodes = doc.xpath("//h2/a[@href]")
    else:
        nodes = doc.xpath("//main//a[@href]")
    for anchor in nodes:
        url = urljoin(page_url, anchor.get("href", ""))
        path = urlsplit(url).path
        if spec["profile_path"] not in path or path.rstrip("/") == spec["profile_path"].rstrip("/") or "/page/" in path:
            continue
        headings = anchor.xpath(".//h2|.//h3|.//h4|.//h5|.//*[contains(concat(' ',normalize-space(@class),' '),' brxe-heading ')]")
        name = text(headings[0]) if headings else text(anchor) if spec["kind"] == "automate" else ""
        if not name or len(name) > 190:
            continue
        record = {"name": name, "profile_url": url, "source_record_id": url,
            "source_roster_url": page_url, "supporting_excerpt": name,
            "relationship_predicate": "member_of" if spec.get("parent_name") else None,
            "relationship_object_name": spec.get("parent_name"),
            "physical_presence": "not_asserted", "manufacturing_status": "not_inferred_from_roster"}
        if spec["kind"] == "ecosystem":
            card = anchor.getparent()
            record["published_categories"] = [text(n) for n in card.xpath(".//div[contains(@class,'category_rec')]//button")]
        results[url] = record
    pagination = sorted({urldefrag(urljoin(page_url, a.get("href")))[0] for a in doc.xpath("//a[@href]")
        if re.search(re.escape(spec["profile_path"]) + r"page/\d+/?$", urlsplit(urljoin(page_url, a.get("href"))).path)
        and urlsplit(urljoin(page_url, a.get("href"))).hostname == urlsplit(spec["url"]).hostname})
    return list(results.values()), pagination


def parse_profile(doc, spec, record):
    """Read member-specific content, never the association header/footer address."""
    result = dict(record)
    headings = doc.xpath("//h1")
    if not headings or normalise(text(headings[0])) != normalise(record["name"]):
        result["profile_status"] = "heading_mismatch_review"
        return result
    if spec["kind"] == "automate":
        scope = headings[0].getparent()
    else:
        scopes = doc.xpath("//main")
        scope = scopes[0] if scopes else headings[0].getparent()
    for node in list(scope.xpath(".//header|.//footer|.//nav|.//form")):
        node.drop_tree()
    own_host = urlsplit(spec["url"]).hostname.removeprefix("www.")
    websites = []
    for anchor in scope.xpath(".//a[@href]"):
        url = urljoin(record["profile_url"], anchor.get("href"))
        parsed = urlsplit(url)
        host = (parsed.hostname or "").removeprefix("www.")
        if parsed.scheme in ("https", "http") and host and host != own_host and host not in EXCLUDED_HOSTS and not re.search(r"privacy|terms|wp-content|maps\.|google\.", url, re.I):
            websites.append(url)
    websites = sorted(set(websites))
    if len(websites) == 1:
        result["website"] = websites[0]
    elif websites:
        result["published_website_candidates"] = websites
    # Text lines are used only for factual postal-address extraction. Descriptions
    # are never retained. Newline boundaries keep unrelated header fields apart.
    content = "\n".join(" ".join(value.split()) for value in scope.itertext() if value.strip())
    addresses = list(ON_ADDRESS.finditer(content))
    if len(addresses) == 1:
        item = addresses[0]
        result.update({"address": item["address"].strip(), "city": item["city"].strip(),
            "province": "ON", "country": "CA", "postal_code": item["postal"].upper(),
            "published_location_excerpt": item.group(), "physical_presence": "association_profile_address_unverified",
            "location_type": "directory_reported_address"})
    elif len(addresses) > 1:
        result["location_review"] = "multiple_published_addresses_no_single_location_selected"
    result["profile_status"] = "factual_fields_checked"
    return result


def restriction(doc):
    content = text(doc)
    found = re.search(r"(?:may not|shall not|prohibit|not permitted|without.{0,25}(?:written )?permission).{0,160}(?:scrap|automat|harvest|reproduc|redistribut|commercial)", content, re.I)
    return found.group()[:240] if found else None


def acquire_rosters(output, *, max_requests=75, max_bytes=24_000_000, source_ids=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    previous_path = output/"manufacturing-manifest.json"
    previous = json.loads(previous_path.read_text()) if previous_path.exists() else {}
    previous_metrics = previous.get("metrics", {})
    odbus_path = output/"statcan-odbus-inspection.json"
    odbus_metrics = json.loads(odbus_path.read_text()).get("metrics", {}) if odbus_path.exists() else {}
    max_requests = min(max_requests, 100-PRELIMINARY_INSPECTION["requests"]-previous_metrics.get("requests", 0)-odbus_metrics.get("requests", 0))
    max_bytes = min(max_bytes, 25_000_000-PRELIMINARY_INSPECTION["bytes_fetched"]-previous_metrics.get("bytes_fetched", 0)-odbus_metrics.get("bytes_fetched", 0))
    if max_requests < 1 or max_bytes < 1:
        raise BudgetExceeded("Shared exploration budget exhausted; frozen prior batches preserved")
    hosts = ["trilliummfg.ca", "trilliumgis.ca", "automatecanada.org", "www.automatecanada.ca", "canadianassociationofmoldmakers.com", "www150.statcan.gc.ca", "open.canada.ca"]
    transport = Transport(max_requests=max_requests, max_bytes=max_bytes, max_response_bytes=6_000_000,
        allowed_hosts=hosts, min_interval=.4, timeout=15, retries=0)
    batches = []
    for spec in SOURCES:
        if source_ids and spec["id"] not in source_ids:
            path = output/(spec["id"]+".json")
            if path.exists():
                batches.append(json.loads(path.read_text()))
            continue
        start_requests, start_bytes = transport.requests, transport.bytes_fetched
        batch = {"spec": spec, "observed_at": stamp(), "status": "pending", "records": [], "pages": [],
            "policy_observations": [], "coverage_complete": False, "pagination_complete": False}
        records, queue, visited = {}, [spec["url"]], set()
        blocked = False
        try:
            first = transport.fetch(spec["url"])
            doc = document(first)
            policy_urls = sorted({urljoin(spec["url"], a.get("href")) for a in doc.xpath("//a[@href]")
                if re.search(r"(?:privacy|terms(?:-and-conditions)?|copyright|legal)/?$", urlsplit(a.get("href")).path, re.I)
                and urlsplit(urljoin(spec["url"], a.get("href"))).hostname == urlsplit(spec["url"]).hostname})
            for url in policy_urls[:3]:
                policy = transport.fetch(url)
                policy_doc = document(policy)
                deny = restriction(policy_doc)
                batch["policy_observations"].append({"url": url, "sha256": hashlib.sha256(policy.body).hexdigest(), "explicit_restriction": deny})
                blocked |= bool(deny)
            batch["policy_observations"].append({"scope": "Linked public policy pages and source footer reviewed; absence of a prohibition is not an open-data licence.",
                "bulk_reuse_licence": "not_verified", "use_scope": "minimal_first_party_factual_roster_review_only",
                "copyright_notice_present": bool(re.search(r"all rights reserved|copyright|©", text(doc), re.I))})
            if blocked:
                raise SourceBlocked("Source terms require reuse approval; no roster import permitted")
            while queue:
                url = queue.pop(0)
                if url in visited:
                    continue
                response = first if url == spec["url"] else transport.fetch(url)
                page = doc if url == spec["url"] else document(response)
                found, next_pages = parse_roster(page, spec, url)
                if not found:
                    raise SourceBlocked("Expected directory cards not parsed; no empty complete claim")
                visited.add(url)
                batch["pages"].append({"url": url, "sha256": hashlib.sha256(response.body).hexdigest(), "parsed_records": len(found)})
                for record in found:
                    record["roster_content_sha256"] = hashlib.sha256(response.body).hexdigest()
                    record["roster_observed_at"] = batch["observed_at"]
                    record["roster_label"] = "Ecosystem Directory" if spec["kind"] == "ecosystem" else "Member Directory"
                    records[record["source_record_id"]] = record
                queue.extend(target for target in next_pages if target not in visited and target not in queue)
            batch["pagination_complete"] = True
            # Reserve the shared request budget for the remaining roster sources.
            profile_limit = 4 if spec["kind"] == "ecosystem" else 12 if spec["kind"] == "automate" else 18
            for key in list(records)[:profile_limit]:
                if transport.requests >= transport.max_requests - 8:
                    break
                try:
                    response = transport.fetch(records[key]["profile_url"])
                    records[key] = parse_profile(document(response), spec, records[key])
                    records[key]["profile_content_sha256"] = hashlib.sha256(response.body).hexdigest()
                except SourceBlocked as exc:
                    records[key]["profile_status"] = "blocked"
                    records[key]["profile_error"] = str(exc)
            batch["status"] = "factual_roster_acquired"
        except (SourceBlocked, BudgetExceeded) as exc:
            batch["error"] = str(exc)
            batch["status"] = "factual_roster_partial" if records and not blocked else "blocked"
            batch["remaining_pages"] = queue
        batch["records"] = list(records.values()) if not blocked else []
        batch["source"] = {"id": spec["id"], "name": spec["name"], "publisher": spec.get("parent_name") or "Trillium Network for Advanced Manufacturing",
            "source_url": spec["url"], "source_type": "manufacturing_ecosystem_directory" if spec["kind"] == "ecosystem" else "manufacturers_association",
            "geography_scope": ["Ontario"] if spec["kind"] == "ecosystem" else ["Canada"], "sector_scope": [],
            "access_method": "bounded_first_party_factual_review", "rights_status": "limited_factual_review_only" if batch["records"] else "unreviewed",
            "retrieval_status": "accessible" if batch["records"] else "blocked", "cost_model": "free", "last_checked_at": batch["observed_at"],
            "notes": "Minimal factual names/profile links and explicitly published member fields. No unrestricted compilation/bulk licence verified. Membership is not manufacturing status, a local office or buying authority."}
        batch["metrics"] = {"requests": transport.requests-start_requests, "bytes_fetched": transport.bytes_fetched-start_bytes,
            "estimated_cost": 0, "currency": None, "paid_service_calls": 0, "model_tokens": 0}
        batch["artifact_fingerprint"] = hashlib.sha256(dumps({"pages": batch["pages"], "records": batch["records"]}).encode()).hexdigest()
        path = output/(spec["id"]+".json")
        temp = path.with_suffix(".json.tmp")
        temp.write_text(json.dumps(batch, indent=2, ensure_ascii=False)+"\n")
        temp.replace(path)
        batches.append(batch)
        print(json.dumps({"source": spec["id"], "status": batch["status"], "records": len(batch["records"]), "pages": len(batch["pages"]), "requests_so_far": transport.requests}), flush=True)
    metrics = transport.metrics()
    for key in ("requests", "bytes_fetched", "elapsed_seconds"):
        metrics[key] += previous_metrics.get(key, 0)
    manifest = {"observed_at": stamp(), "metrics": metrics, "sources": [{"source_id": b["source"]["id"], "status": b["status"], "records": len(b["records"]), "pagination_complete": b["pagination_complete"]} for b in batches],
        "preliminary_inspection_metrics": PRELIMINARY_INSPECTION,
        "source_budget": {"max_requests_this_acquisition": max_requests, "max_bytes_this_acquisition": max_bytes,
            "shared_max_requests": 100, "shared_max_bytes_initial": 25_000_000},
        "limitations": ["TrilliumGIS full-map access and bulk licence remain unverified; no internal endpoint reverse engineering.", "OntarioMade automated collection prohibited by published terms; not collected.", "Roster affiliations are source-reported and unverified; no manufacturing/physical-presence/parent-company inference."]}
    (output/"manufacturing-manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")
    (output/"source-registry-fragment.json").write_text(json.dumps({"sources": [b["source"] for b in batches]}, indent=2)+"\n")
    return manifest


def apply_acquisitions(store, folder, *, progress=None):
    """Atomic per-source import and membership proof, deterministic on replay."""
    from .place_import import _committed_batch, _guard_storage
    folder = Path(folder)
    reports = []
    for spec in SOURCES:
        path = folder/(spec["id"]+".json")
        if not path.exists():
            continue
        batch = json.loads(path.read_text())
        if batch.get("status") not in ("factual_roster_acquired", "factual_roster_partial") or batch["source"].get("rights_status") != "limited_factual_review_only":
            reports.append({"source_id": spec["id"], "status": "held", "records_imported": 0})
            continue
        fingerprint = hashlib.sha256(dumps({"pages": batch["pages"], "records": batch["records"]}).encode()).hexdigest()
        if fingerprint != batch["artifact_fingerprint"]:
            raise SourceBlocked("Saved manufacturing facts differ from acquired batch")
        source_id = store.upsert_source(batch["source"])
        rows = [{"source_record_id": record["source_record_id"], "source_url": record["profile_url"] if record.get("profile_content_sha256") else record["source_roster_url"], "name": record["name"],
            "website": record.get("website"), "entity_type": "organisation", "address": record.get("address"),
            "city": record.get("city"), "province": record.get("province"), "country": record.get("country"),
            "postal_code": record.get("postal_code"), "location_type": record.get("location_type"),
            "observed_at": batch["observed_at"], "raw_payload": record} for record in batch["records"]]
        metadata = {"adapter_name": "manufacturing_factual_roster", "parser_version": "1", "batch_id": fingerprint,
            "observed_at": batch["observed_at"], "coverage_complete": False, **batch["metrics"]}
        if not _committed_batch(store, source_id, rows, metadata):
            _guard_storage(store, rows, {"source_folder": str(folder), "area": spec["id"], "chunk": 0})
        relationships = 0
        with store.transaction():
            result = store.ingest(source_id, rows, run_metadata=metadata)
            if not result.get("replayed"):
                with store._buffer_field_assertions():
                    for row, record in zip(rows, batch["records"]):
                        identity = store.db.execute("SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?", (source_id, row["source_record_id"])).fetchone()
                        if not identity:
                            continue
                        org, evidence = identity["organisation_id"], identity["last_evidence_id"]
                        store.assert_field(org, "organisation", "manufacturing_roster_context", {key: record.get(key) for key in ("published_categories", "manufacturing_status", "physical_presence")}, evidence, batch["observed_at"], method="first_party_factual_roster", review_status="source_listed_unverified")
                        if record.get("relationship_predicate") not in ("member_of", "sponsor_of") or not spec.get("parent_name"):
                            continue
                        parent = stable_id("manufacturing-roster-association", spec["id"])
                        store.db.execute("""INSERT OR IGNORE INTO organisations(id,trading_name,entity_type,first_seen_at,last_seen_at,name_normalized)
                            VALUES(?,?,'association',?,?,?)""", (parent, spec["parent_name"], batch["observed_at"], batch["observed_at"], normalise(spec["parent_name"])))
                        store.assert_field(parent, "organisation", "name", spec["parent_name"], evidence, batch["observed_at"])
                        inserted = store.db.execute("""INSERT OR IGNORE INTO relationships
                            (id,subject_id,subject_type,predicate,object_id,object_type,asserted_by_source_id,evidence_id,confidence,observed_at,review_status)
                            VALUES(?,?,'organisation',?,?,'organisation',?,?,NULL,?,'source_listed_unverified')""",
                            (stable_id("manufacturing-roster-relation", source_id, org, parent, record["relationship_predicate"], evidence), org, record["relationship_predicate"], parent, source_id, evidence, batch["observed_at"]))
                        relationships += inserted.rowcount
        report = {"source_id": source_id, "records_imported": len(rows), "replayed": bool(result.get("replayed")),
            "new_membership_assertions": relationships, "new_organisations": 0 if result.get("replayed") else result["inserted_count"],
            "published_member_profile_addresses": sum(bool(row.get("address")) for row in rows), "manufacturing_status_inferred": 0}
        reports.append(report)
        if progress:
            progress(report)
    return reports


def iter_odbus_rows(stream, *, observed_at, stats=None):
    """Keep Ontario publisher rows from the historical ODBus, no census claim."""
    stats = stats if stats is not None else {}
    reader = csv.DictReader(stream)
    headers = {normalise(value): value for value in reader.fieldnames or []}
    if not any(k in headers for k in ("province", "provterr", "provincename", "prname", "pruid")) or not any(k in headers for k in ("businessname", "name", "operatingname")):
        raise SourceBlocked("ODBus headers changed or lack name/province fields")
    for index, raw in enumerate(reader):
        stats["national_rows"] = stats.get("national_rows", 0) + 1
        def get(*keys):
            return next((str(raw[headers[key]] or "").strip() for key in keys if key in headers and raw.get(headers[key]) and str(raw[headers[key]]).strip() != ".."), "")
        province = get("province", "provterr", "provincename", "prname", "pruid")
        if normalise(province) not in ("on", "ontario", "35"):
            continue
        name = get("businessname", "operatingname", "name")
        if not name:
            stats["unnamed_rows_held"] = stats.get("unnamed_rows_held", 0) + 1
            continue
        stats["ontario_rows"] = stats.get("ontario_rows", 0) + 1
        published_id = get("idx", "index", "odbid", "odbusid", "id")
        identity = published_id or "row:"+str(index)
        if not published_id:
            stats["missing_publisher_id_rows"] = stats.get("missing_publisher_id_rows", 0) + 1
        naics = get("sourcenaicsprimary", "naics", "naicscode", "naics2017", "naics2022")
        if re.fullmatch(r"(?:31|32|33)\d{0,4}(?:\.0)?", naics):
            stats["published_naics_manufacturing_rows"] = stats.get("published_naics_manufacturing_rows", 0) + 1
        website = get("website", "url", "web")
        yield {"source_record_id": identity, "source_url": ODBUS_ZIP, "name": name,
            "provider_record_id": published_id or None, "source_row_ordinal": index+1,
            "source_record_id_basis": "publisher_idx" if published_id else "pinned_file_row_ordinal",
            "address": get("fulladdress", "address", "streetaddress") or None,
            "city": get("municipality", "municipalityname", "city") or None,
            "province": "ON", "country": "CA", "postal_code": get("postalcode", "postal") or None,
            "website": website if urlsplit(website).scheme in ("http", "https") else None,
            "naics_code": naics or None, "naics_version": None,
            "source_naics_secondary": get("sourcenaicssecondary") or None,
            "statscan_derived_naics_code": get("derivednaics") or None,
            "statscan_derived_naics_version": "NAICS Canada 2022 Version 1.0",
            "source_business_sector": get("businesssector") or None,
            "source_provider": get("provider") or None,
            "source_status_historical": get("status") or None,
            "source_geocoding_method": get("geosource") or None,
            "latitude": _coordinate(get("latitude"), -90, 90), "longitude": _coordinate(get("longitude"), -180, 180),
            "coordinates_source": "Statistics Canada ODBus 2023: " + get("geosource") if get("geosource") else "Statistics Canada ODBus 2023; method unspecified",
            "entity_type": "organisation_candidate", "location_type": "source_reported_historical_address",
            "source_published_at": "2023-11-28", "source_publication_date": "2023-11-28", "source_input_collection_period": "2022-05/2022-12",
            "current_operating_status": "not_verified", "observed_at": observed_at,
            "raw_payload": raw, "outreach_eligibility": "research_only", "campaign_ready": False}


def _coordinate(value, low, high):
    try:
        number = float(value)
        return number if low <= number <= high else None
    except (TypeError, ValueError):
        return None


def normalise_odbus_archive(output, report):
    """Reparse a verified frozen ZIP without any network or database writes."""
    output = Path(output)
    target = output/report["raw_file"]
    if hashlib.sha256(target.read_bytes()).hexdigest() != report["raw_sha256"]:
        raise SourceBlocked("Frozen official ODBus ZIP hash changed")
    destination = output/"statcan-odbus-ontario-2023.jsonl.gz"
    temp = destination.with_suffix(".gz.tmp")
    stats, identities = {}, set()
    with zipfile.ZipFile(target) as archive:
        members = archive.infolist()
        if sum(item.file_size for item in members) > 1_000_000_000:
            raise BudgetExceeded("Decoded ZIP members exceed 1GB inspection cap")
        csv_members = sorted([item for item in members if item.filename.lower().endswith(".csv")], key=lambda item: item.file_size, reverse=True)
        if not csv_members:
            raise SourceBlocked("ODBus archive has no documented CSV data")
        with archive.open(csv_members[0]) as raw, io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as stream, gzip.open(temp, "wt", encoding="utf-8") as handle:
            for row in iter_odbus_rows(stream, observed_at=report["observed_at"], stats=stats):
                if row["source_record_id"] in identities:
                    raise SourceBlocked("Duplicate official ODBus record ID requires review")
                identities.add(row["source_record_id"])
                handle.write(dumps(row)+"\n")
    temp.replace(destination)
    report.update({"stats": stats, "records_file": destination.name, "records_sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
        "parser_version": "odbus-ontario/2", "normalisation_note": "Original idx retained where present; absent publisher IDs use explicitly labelled pinned-file-row ordinals. Missing sentinel '..' becomes unknown; source primary NAICS remains separate from Statistics Canada derived codes; no NAICS version guessed."})
    (output/"statcan-odbus-inspection.json").write_text(json.dumps(report, indent=2)+"\n")
    return report


def apply_odbus_acquisition(store, folder, *, batch_size=500, manufacturing_only=False, progress=None):
    """Import verified historical Ontario observations in atomic replayable chunks.

    Optional manufacturing-first mode selects only original-source NAICS 31–33;
    the shared source namespace and acquisition ID also support later full import.
    """
    from .place_import import _committed_batch, _guard_storage
    if not 1 <= batch_size <= 2000:
        raise ValueError("Historical-source batches must contain 1–2000 rows")
    folder = Path(folder)
    manifest = json.loads((folder/"statcan-odbus-inspection.json").read_text())
    if manifest.get("status") != "licensed_historical_data_acquired" or manifest.get("rights_status") != "licensed_open" or manifest.get("parser_version") != "odbus-ontario/2":
        raise SourceBlocked("Historical ODBus acquisition is not licensed and fully normalised")
    path = folder/manifest["records_file"]
    if hashlib.sha256(path.read_bytes()).hexdigest() != manifest["records_sha256"]:
        raise SourceBlocked("Frozen normalised ODBus artifact hash differs")
    with gzip.open(path, "rb") as stream:
        verified_rows = 0
        for line in stream:
            if not line.strip():
                continue
            verified_rows += 1
            if json.loads(line).get("source_published_at") != manifest["publication_date"]:
                raise SourceBlocked("Historical observation lacks the standard verified publication date")
        if verified_rows != manifest["stats"]["ontario_rows"]:
            raise SourceBlocked("Historical normalised row count differs before import")
    source_id = store.upsert_source({"id": manifest["source_id"], "name": "Statistics Canada Open Database of Businesses v1.0 (2023), Ontario observations",
        "publisher": "Statistics Canada and retained original municipal/provincial providers", "source_url": manifest["download_url"],
        "source_type": "open_data_locations", "geography_scope": ["Ontario"], "sector_scope": ["*"],
        "source_date": manifest["publication_date"], "last_checked_at": manifest["observed_at"], "terms_url": manifest["licence_url"],
        "access_method": "documented_bulk_download", "rights_status": "licensed_open", "retrieval_status": "accessible", "cost_model": "free",
        "attribution": manifest["licence_evidence"]["attribution"], "notes": manifest["historical_scope"]+" Individual licence observations may duplicate a business; this is not a legal-entity census."})
    mode = "source-naics-manufacturing" if manufacturing_only else "all-ontario"
    report = {"source_id": source_id, "selection": mode, "processed_rows": 0, "new_organisations": 0,
        "replayed_batches": 0, "current_operation_verified": False}
    def ingest(rows, start):
        measured = manifest["metrics"] if start == 0 else {}
        metadata = {"adapter_name": "statcan_odbus_2023", "parser_version": "odbus-ontario/2", "observed_at": manifest["observed_at"],
            "batch_id": manifest["raw_sha256"]+":parser2:"+mode+":"+str(start), "acquisition_id": "statcan-odbus:"+manifest["raw_sha256"],
            "coverage_complete": False, **{key: measured.get(key, 0) for key in ("requests", "bytes_fetched", "estimated_cost")}}
        if not _committed_batch(store, source_id, rows, metadata):
            _guard_storage(store, rows, {"source_folder": str(folder), "area": "Ontario-ODBus-2023", "chunk": start//batch_size})
        with store.transaction():
            result = store.ingest(source_id, rows, run_metadata=metadata)
            if not result.get("replayed"):
                with store._buffer_field_assertions():
                    for row in rows:
                        identity = store.db.execute("SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?", (source_id, row["source_record_id"])).fetchone()
                        if not identity:
                            continue
                        evidence = identity["last_evidence_id"]
                        for field in ("source_publication_date", "source_input_collection_period", "current_operating_status", "source_provider", "statscan_derived_naics_code", "statscan_derived_naics_version", "source_naics_secondary", "source_status_historical"):
                            store.assert_field(identity["organisation_id"], "organisation", field, row.get(field), evidence, row["observed_at"], method="historical_open_data_observation", review_status="source_reported_historical")
                        if row.get("source_record_id_basis") == "pinned_file_row_ordinal":
                            store.assert_field(identity["organisation_id"], "organisation", "source_record_id_lineage",
                                {key: row.get(key) for key in ("source_record_id", "provider_record_id", "source_record_id_basis", "source_row_ordinal")},
                                evidence, row["observed_at"], method="pinned_file_row_identifier", review_status="source_position_not_publisher_identifier")
                        if identity["location_id"]:
                            store.assert_field(identity["location_id"], "location", "address_observation_scope", {"historical": True, "reference_period": manifest["reference_period"], "geocoding_method": row.get("source_geocoding_method"), "current_occupancy_verified": False}, evidence, row["observed_at"], method="historical_open_data_observation", review_status="source_reported_historical")
        report["processed_rows"] += len(rows)
        report["new_organisations"] += 0 if result.get("replayed") else result["inserted_count"]
        report["replayed_batches"] += int(bool(result.get("replayed")))
        if progress:
            progress({**report, "batch_start": start, "batch_rows": len(rows), "run_id": result["run_id"], "replayed": bool(result.get("replayed"))})
    pending, start, total = [], 0, 0
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            total += 1
            if manufacturing_only and not re.fullmatch(r"(?:31|32|33)\d{0,4}(?:\.0)?", str(row.get("naics_code") or "")):
                continue
            pending.append(row)
            if len(pending) >= batch_size:
                ingest(pending, start)
                start += len(pending)
                pending = []
        if pending:
            ingest(pending, start)
    if total != manifest["stats"]["ontario_rows"]:
        raise SourceBlocked("Historical normalised row count differs from verified acquisition")
    return report


def export_manufacturing_view(folder, *, geography_database=None, manufacturing_only=True):
    """Usable historical manufacturing observations; geography reads are optional."""
    from .acquired_inventory import ServiceFootprint, safe_cell
    folder = Path(folder)
    manifest = json.loads((folder/"statcan-odbus-inspection.json").read_text())
    source = folder/manifest["records_file"]
    if hashlib.sha256(source.read_bytes()).hexdigest() != manifest["records_sha256"]:
        raise SourceBlocked("Manufacturing export input hash differs")
    target = folder/("odbus-source-naics-manufacturing-ontario-2023.csv.gz" if manufacturing_only else "odbus-historical-ontario-2023.csv.gz")
    temporary = target.with_suffix(".gz.tmp")
    columns = ["source_observation_id", "provider_record_id", "source_record_id_basis", "source_row_ordinal", "name", "address", "city", "province", "country", "postal_code",
        "source_naics_primary", "source_naics_version", "source_business_sector", "statscan_derived_naics", "original_provider",
        "latitude", "longitude", "source_geocoding_method", "publication_date", "input_files_collected",
        "source_url", "service_footprint_status", "configured_catchments", "current_operation_verified", "campaign_ready"]
    rows = total = 0
    city_counts, provider_counts, scope_counts, sector_counts, derived_counts = Counter(), Counter(), Counter(), Counter(), Counter()
    footprint = ServiceFootprint(geography_database)
    try:
        with gzip.open(source, "rt", encoding="utf-8") as stream, temporary.open("wb") as raw:
            with gzip.GzipFile(fileobj=raw, filename="", mode="wb", mtime=0) as compressed, io.TextIOWrapper(compressed, encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=columns)
                writer.writeheader()
                for line in stream:
                    row = json.loads(line)
                    total += 1
                    if manufacturing_only and not re.fullmatch(r"(?:31|32|33)\d{0,4}(?:\.0)?", str(row.get("naics_code") or "")):
                        continue
                    scope = footprint.resolve(row.get("city"))
                    record = {"source_observation_id": row["source_record_id"], "provider_record_id": row.get("provider_record_id"),
                        "source_record_id_basis": row.get("source_record_id_basis"), "source_row_ordinal": row.get("source_row_ordinal"), "name": row["name"],
                        **{key: row.get(key) for key in ("address", "city", "province", "country", "postal_code", "latitude", "longitude", "source_geocoding_method")},
                        "source_naics_primary": row["naics_code"], "source_naics_version": row["naics_version"],
                        "source_business_sector": row.get("source_business_sector"),
                        "statscan_derived_naics": row.get("statscan_derived_naics_code"), "original_provider": row.get("source_provider"),
                        "publication_date": row["source_publication_date"], "input_files_collected": row["source_input_collection_period"],
                        "source_url": row["source_url"], **scope, "current_operation_verified": False, "campaign_ready": False}
                    writer.writerow({key: safe_cell(record.get(key)) for key in columns})
                    rows += 1
                    city_counts[str(row.get("city") or "")] += 1
                    provider_counts[str(row.get("source_provider") or "")] += 1
                    scope_counts[scope["service_footprint_status"]] += 1
                    code = str(row.get("naics_code") or "")
                    sector_counts[code[:2] if re.fullmatch(r"\d{2,6}(?:\.0)?", code) else "unmapped_or_missing_source_NAICS"] += 1
                    derived_counts[str(row.get("statscan_derived_naics_code") or "unknown")] += 1
    finally:
        footprint.close()
    expected = manifest["stats"].get("published_naics_manufacturing_rows", 0) if manufacturing_only else manifest["stats"]["ontario_rows"]
    if total != manifest["stats"]["ontario_rows"] or rows != expected:
        raise SourceBlocked("Manufacturing view counts differ from original-source NAICS selection")
    temporary.replace(target)
    with gzip.open(target, "rt", encoding="utf-8", newline="") as stream:
        if sum(1 for _ in csv.DictReader(stream)) != rows:
            raise SourceBlocked("Manufacturing CSV independent parsed-row check failed")
    prefix = "odbus-manufacturing" if manufacturing_only else "odbus-historical"
    summaries = []
    for name, label, values in (("city", "published_city", city_counts), ("provider", "original_provider", provider_counts),
            ("sector", "source_NAICS_two_digit_sector", sector_counts), ("scope", "service_footprint_status", scope_counts)):
        summary = folder/(prefix+"-"+name+"-summary.csv")
        with summary.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow([label, "historical_observations"])
            writer.writerows((safe_cell(value), count) for value, count in values.most_common())
        summaries.append({"file": summary.name, "rows": len(values), "sha256": hashlib.sha256(summary.read_bytes()).hexdigest()})
    report = {"file": target.name, "rows": rows, "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "source_record_count": total, "source_input_sha256": manifest["records_sha256"],
        "scope_counts": dict(scope_counts), "published_localities": city_counts.most_common(), "providers": provider_counts.most_common(),
        "source_sector_counts": dict(sector_counts), "statscan_imputed_sector_counts_separate": dict(derived_counts), "summary_files": summaries,
        "selection": "original_provider_NAICS31–33" if manufacturing_only else "all_Ontario_source_observations",
        "licence": manifest["licence_evidence"], "publication_date": manifest["publication_date"],
        "source_currency_metadata": "original-provider-currency.json",
        "policy": "Historical licence/business observations, not unique legal companies or current factories. Some source business directories describe2019snapshots; datesvarybyprovider. StatsCan imputed NAICS is preserved separately. Scope is a read-only label/reference match, not point-in-boundary or current occupancy. No canonicalSSM IDs or verified-company claims."}
    (folder/("manufacturing-view-manifest.json" if manufacturing_only else "odbus-historical-view-manifest.json")).write_text(json.dumps(report, indent=2)+"\n")
    return report


def inspect_odbus(output):
    """Document licence and size before a bounded, guarded streamed ZIP fetch."""
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    saved_path = output/"statcan-odbus-inspection.json"
    if saved_path.exists():
        saved = json.loads(saved_path.read_text())
        if saved.get("status") == "licensed_historical_data_acquired" and saved.get("parser_version") == "odbus-ontario/2":
            for key, checksum in (("raw_file", "raw_sha256"), ("records_file", "records_sha256")):
                if hashlib.sha256((output/saved[key]).read_bytes()).hexdigest() != saved[checksum]:
                    raise SourceBlocked("Frozen historical acquisition differs; do not silently redownload")
            return {**saved, "replayed_saved_acquisition": True, "incremental_metrics": {"requests": 0, "bytes_fetched": 0}}
    prior = json.loads((output/"manufacturing-manifest.json").read_text()) if (output/"manufacturing-manifest.json").exists() else {}
    used_requests = prior.get("metrics", {}).get("requests", 0) + PRELIMINARY_INSPECTION["requests"]
    remaining = min(12, 100-used_requests)
    if remaining < 4:
        raise BudgetExceeded("Shared 100-request exploration budget lacks room for licence and bulk preflight")
    transport = Transport(max_requests=remaining, max_bytes=25_000_000, max_response_bytes=2_000_000,
        retries=0, timeout=30, min_interval=.4, allowed_hosts=["www150.statcan.gc.ca", "open.canada.ca"])
    report = {"source_id": "statcan-odbus-2023-v1", "observed_at": stamp(), "status": "pending",
        "source_url": ODBUS_PAGE, "download_url": ODBUS_ZIP, "licence_url": LICENCE,
        "publication_date": "2023-11-28", "reference_period": "Input datasets collected May–December 2022",
        "historical_scope": "Selection of businesses, separate from Statistics Canada Business Register; current operations unverified."}
    try:
        page = transport.fetch(ODBUS_PAGE)
        page_doc = document(page)
        if not any(a.get("href") == LICENCE for a in page_doc.xpath("//a[@href]")):
            raise SourceBlocked("Official ODBus page no longer links reviewed Open Government Licence - Canada")
        licence = transport.fetch(LICENCE)
        if "commercial" not in text(document(licence)).casefold():
            raise SourceBlocked("Official licence content changed; review required")
        report["licence_evidence"] = {"id": "Open Government Licence - Canada", "url": LICENCE,
            "content_sha256": hashlib.sha256(licence.body).hexdigest(), "dataset_page_sha256": hashlib.sha256(page.body).hexdigest(),
            "attribution": "Contains information licensed under the Open Government Licence – Canada, Statistics Canada, Open Database of Businesses, version 1.0 (2023)."}
        parsed = transport._guard(ODBUS_ZIP, transport.allowed_hosts)
        transport._check_robots(ODBUS_ZIP, transport.allowed_hosts)
        if transport.requests >= transport.max_requests:
            raise BudgetExceeded("Request cap before bulk preflight")
        transport.requests += 1
        request = urllib.request.Request(ODBUS_ZIP, headers={"User-Agent": transport.USER_AGENT}, method="HEAD")
        with transport.opener.open(request, timeout=transport.timeout) as response:
            length = int(response.headers.get("Content-Length", "0"))
            content_type = response.headers.get("Content-Type", "")
        free = shutil.disk_usage(output.resolve()).free
        report["preflight"] = {"documented_bytes": length, "content_type": content_type, "disk_free_bytes": free,
            "initial_download_cap": 25_000_000, "authorized_maximum_if_licensed_and_sized": 150_000_000}
        if not length or length > 150_000_000 or not any(kind in content_type.lower() for kind in ("zip", "octet-stream")):
            raise SourceBlocked("Documented ODBus ZIP unavailable or content type/size changed; no HTML/error page imported as data")
        if free < 512*1024*1024 + length*5:
            raise BudgetExceeded("Insufficient storage headroom for licensed historical ZIP and normalisation")
        transport.max_bytes = transport.bytes_fetched + length + 1
        report["preflight"]["declared_download_cap"] = length
        transport._guard(ODBUS_ZIP, transport.allowed_hosts)
        if transport.requests >= transport.max_requests:
            raise BudgetExceeded("Request cap before bulk download")
        transport.requests += 1
        request = urllib.request.Request(ODBUS_ZIP, headers={"User-Agent": transport.USER_AGENT})
        target = output/"statcan-odbus-2023-original.zip"
        temporary = target.with_suffix(".zip.tmp")
        checksum, fetched, started = hashlib.sha256(), 0, time.monotonic()
        with transport.opener.open(request, timeout=transport.timeout) as response, temporary.open("wb") as handle:
            while True:
                if time.monotonic()-started > 180:
                    raise BudgetExceeded("Historical ZIP download deadline reached")
                block = response.read(1024*1024)
                if not block:
                    break
                fetched += len(block)
                transport.bytes_fetched += len(block)
                if fetched > length or transport.bytes_fetched > transport.max_bytes:
                    raise BudgetExceeded("ZIP exceeded predeclared size/byte cap")
                handle.write(block)
                checksum.update(block)
        if fetched != length or not zipfile.is_zipfile(temporary):
            raise SourceBlocked("Downloaded bytes are not the documented complete ZIP")
        temporary.replace(target)
        destination = output/"statcan-odbus-ontario-2023.jsonl.gz"
        temporary_rows = destination.with_suffix(".gz.tmp")
        stats = {}
        with zipfile.ZipFile(target) as archive:
            members = archive.infolist()
            if sum(item.file_size for item in members) > 1_000_000_000:
                raise BudgetExceeded("Decoded ZIP members exceed 1GB inspection cap")
            csv_members = sorted([item for item in members if item.filename.lower().endswith(".csv")], key=lambda item: item.file_size, reverse=True)
            if not csv_members:
                raise SourceBlocked("ODBus archive has no documented CSV data")
            report["archive_members"] = [{"name": item.filename, "bytes": item.file_size} for item in members]
            with archive.open(csv_members[0]) as raw, io.TextIOWrapper(raw, encoding="utf-8-sig", newline="") as csv_stream, gzip.open(temporary_rows, "wt", encoding="utf-8") as handle:
                for row in iter_odbus_rows(csv_stream, observed_at=report["observed_at"], stats=stats):
                    handle.write(dumps(row)+"\n")
        temporary_rows.replace(destination)
        report.update({"status": "licensed_historical_data_acquired", "stats": stats, "raw_file": target.name,
            "raw_sha256": checksum.hexdigest(), "records_file": destination.name, "records_sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
            "rights_status": "licensed_open", "coverage_complete": False, "parser_version": "odbus-ontario/2",
            "normalisation_scope": "Ontario records only; source dates retained, no current status inferred."})
    except (SourceBlocked, BudgetExceeded, urllib.error.URLError, OSError, ValueError, zipfile.BadZipFile) as exc:
        report.update({"status": "held", "error": str(exc)})
    report["metrics"] = transport.metrics()
    report["total_exploration_requests"] = used_requests + transport.requests
    (output/"statcan-odbus-inspection.json").write_text(json.dumps(report, indent=2)+"\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-requests", type=int, default=75)
    parser.add_argument("--only-odbus", action="store_true")
    parser.add_argument("--source-id", action="append")
    args = parser.parse_args()
    print(json.dumps(inspect_odbus(args.output) if args.only_odbus else acquire_rosters(args.output, max_requests=args.max_requests, source_ids=args.source_id), indent=2))


if __name__ == "__main__":
    main()
