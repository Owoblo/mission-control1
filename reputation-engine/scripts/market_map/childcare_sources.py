"""Ontario's published childcare licence snapshots, with all history retained.

Facility licences are source observations, not legal-company identifiers. Agency
addresses do not identify individual home providers, and active-at-snapshot does
not independently verify current operations. No ancillary personal data is read.
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
import zipfile
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

from lxml import html

from .store import dumps, stable_id, stamp

DATASET = "https://data.ontario.ca/dataset/licensed-child-care-facilities-in-ontario"
LICENCE = "https://www.ontario.ca/page/open-government-licence-ontario"
RESOURCE = DATASET + "/resource/2b81313c-9ada-4680-abba-4470ec386a2e"
DOWNLOAD = "https://data.ontario.ca/dataset/7efd8b4b-cc63-4337-a551-c940a346605b/resource/2b81313c-9ada-4680-abba-4470ec386a2e/download/child_care_facilities_open_data_sep_2026.xlsx"
RAW_NAME = "child_care_facilities_open_data_sep_2026.xlsx"
SOURCE_ID = "ontario-licensed-childcare-facilities"
REQUIRED = {"Report Snapshot Date", "Licensee Name", "Program Type Desc", "Child Care Site Name",
            "Licence Number", "Licence Status", "City", "Province"}


def _scalar(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _text(value):
    return None if value is None else str(value).strip() or None


def _date(value):
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = _text(value)
    return text[:10] if text and re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:[T ].*)?", text) else text


def workbook_rows(path):
    """Read every nonempty published data row, retaining its worksheet lineage."""
    import openpyxl
    path = Path(path)
    with zipfile.ZipFile(path) as archive:
        if sum(item.file_size for item in archive.infolist()) > 200_000_000:
            raise ValueError("Decoded workbook exceeds the bounded inspection size")
    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        for sheet in book:
            rows = sheet.iter_rows()
            first = next(rows, None)
            headers = [_text(cell.value) or "unnamed_column_" + str(index + 1)
                       for index, cell in enumerate(first or [])]
            if not REQUIRED <= set(headers):
                raise ValueError("Unrecognised worksheet requires review; original workbook remains retained: " + sheet.title)
            for ordinal, cells in enumerate(rows, 2):
                if not any(cell.value is not None and str(cell.value).strip() for cell in cells):
                    continue
                yield {"worksheet": sheet.title, "worksheet_row": ordinal,
                       "values": {key: _scalar(cell.value) for key, cell in zip(headers, cells)},
                       "cell_types": {key: cell.data_type for key, cell in zip(headers, cells)}}
    finally:
        book.close()


def normalise_childcare(rows, *, observed_at, raw_sha256, source_updated_at="2026-10-23"):
    """Keep all source rows; label active Ontario candidates separately."""
    result = []
    for raw in rows:
        values = raw["values"]
        number = _text(values.get("Licence Number"))
        name = _text(values.get("Child Care Site Name"))
        status = _text(values.get("Licence Status"))
        program = _text(values.get("Program Type Desc"))
        province = _text(values.get("Province"))
        agency = program == "Home Child Care Agency"
        valid_name = bool(name and name.casefold() not in {"none", "null"})
        valid_number = bool(number and number.casefold() not in {"none", "null"})
        eligible = valid_name and valid_number and status == "Active" and province in (None, "ON", "Ontario")
        if not valid_name or not valid_number:
            reason = "missing_publisher_licence_or_site_name_raw_evidence_only"
        elif province not in (None, "ON", "Ontario"):
            reason = "published_non_ON_address_raw_evidence_only"
        elif status != "Active":
            reason = "inactive_or_unknown_status_at_snapshot_raw_evidence_only"
        else:
            reason = "source_active_at_reference_date_current_operations_unverified"
        observation = stable_id("childcare-source-row", raw_sha256, raw["worksheet"], raw["worksheet_row"])
        record_key = number if valid_number else "pinned-row:" + observation
        result.append({"source_record_id": record_key,
            "source_record_id_basis": "publisher_licence_number" if valid_number else "pinned_file_row_ordinal",
            "source_observation_id": observation, "source_url": DOWNLOAD,
            "name": name, "entity_type": "institution", "legal_name": None,
            "website": None, "email": None, "phone": None,
            "address": " ".join(value for value in (_text(values.get("Street Number")), _text(values.get("Street Name")), _text(values.get("Street Type"))) if value) or None,
            "city": _text(values.get("City")), "province": province, "country": None,
            "postal_code": _text(values.get("Postal Code")),
            "location_type": "registered_address" if agency else "licensed_childcare_centre_address" if program == "Child Care Centre" else "unknown",
            "address_role": "agency_administrative_or_contact_address_not_individual_provider_homes" if agency else "publisher_licensed_facility_address_current_occupancy_unverified",
            "program_type": program, "source_licence_number": number,
            "source_licence_namespace": "CA-ON-CHILDCARE-FACILITY-LICENCE",
            "licence_status_at_reference_date": status,
            "source_licensee_name": values.get("Licensee Name"),
            "source_reference_date": _date(values.get("Report Snapshot Date")),
            "source_original_licence_issue_date": _date(values.get("Original Issue Date")),
            "source_closure_or_termination_date": _date(values.get("Closure or Termination Date")),
            "source_published_at": None, "source_updated_at": source_updated_at,
            "source_cmsm_dssab_label": values.get("CMSM / DSSAB Name"),
            "account_candidate_eligible": eligible, "candidate_eligibility_reason": reason,
            "current_operation_verified": False, "ownership_or_operator_relationship_inferred": False,
            "observed_at": observed_at, "raw_payload": {**raw, "source_workbook_sha256": raw_sha256}})
    duplicates = Counter(row["source_record_id"] for row in result)
    for row in result:
        if duplicates[row["source_record_id"]] > 1:
            row["account_candidate_eligible"] = False
            row["candidate_eligibility_reason"] = "duplicate_publisher_licence_requires_review_raw_evidence_only"
    return result


def _save(path, payload):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    temporary.replace(path)


def _gzip_rows(path, rows):
    with Path(path).open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
            with io.TextIOWrapper(compressed, encoding="utf-8", newline="") as stream:
                for row in rows:
                    stream.write(dumps(row) + "\n")


def freeze_childcare(output, *, minimum_free_bytes=2 * 1024 ** 3):
    """Validate already acquired, explicitly licensed files without network calls."""
    output = Path(output)
    manifest_path = output / "manifest.json"
    if manifest_path.exists():
        saved = json.loads(manifest_path.read_text())
        if saved.get("status") != "acquired_complete" or saved.get("source_id") != SOURCE_ID or not saved.get("artifacts"):
            raise ValueError("Existing childcare manifest is not a verified acquisition")
        for artifact in saved["artifacts"]:
            if Path(artifact["file"]).name != artifact["file"]:
                raise ValueError("Childcare artifacts must be sibling files")
            if hashlib.sha256((output / artifact["file"]).read_bytes()).hexdigest() != artifact["sha256"]:
                raise ValueError("Frozen childcare artifact differs: " + artifact["file"])
        return {**saved, "replayed_frozen_acquisition": True}
    if shutil.disk_usage(output).free < minimum_free_bytes:
        return {"status": "normalisation_capacity_paused", "raw_workbook_retained": (output / RAW_NAME).exists(),
                "required_free_bytes": minimum_free_bytes, "free_bytes": shutil.disk_usage(output).free}
    path = output / RAW_NAME
    raw_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    dataset_doc = html.fromstring((output / "dataset-page.html").read_bytes())
    if LICENCE not in dataset_doc.xpath("//a/@href"):
        raise ValueError("Official dataset no longer supplies the reviewed Ontario licence link")
    licence_doc = html.fromstring((output / "licence-page.html").read_bytes())
    for node in licence_doc.xpath("//script|//style"):
        node.drop_tree()
    licence_text = " ".join(licence_doc.text_content().split()).casefold()
    if "commercial" not in licence_text or "licence" not in licence_text or "ontario" not in licence_text:
        raise ValueError("Official licence receipt requires independent review")
    observed = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
    raw_rows = list(workbook_rows(path))
    records = normalise_childcare(raw_rows, observed_at=observed, raw_sha256=raw_hash)
    statuses = Counter(row["licence_status_at_reference_date"] for row in records)
    types = Counter(row["program_type"] for row in records)
    provinces = Counter(row["province"] for row in records)
    references = Counter(row["source_reference_date"] for row in records)
    if set(references) != {"2026-09-30"}:
        raise ValueError("Frozen September2026 source reference dates differ")
    stats = {"raw_rows": len(raw_rows), "normalised_observations": len(records),
             "unique_publisher_licence_strings": len({row["source_licence_number"] for row in records if row["source_licence_number"]}),
             "status_counts": dict(statuses), "program_type_counts": dict(types), "published_province_counts": dict(provinces),
             "source_reference_dates": dict(references),
             "account_candidate_rows": sum(row["account_candidate_eligible"] for row in records),
             "raw_only_or_review_rows": sum(not row["account_candidate_eligible"] for row in records)}
    _gzip_rows(output / "raw-records.jsonl.gz", raw_rows)
    _gzip_rows(output / "observations.jsonl.gz", records)
    _gzip_rows(output / "candidate-records.jsonl.gz", [row for row in records if row["account_candidate_eligible"]])
    artifacts = []
    for name in (RAW_NAME, "dataset-page.html", "resource-page.html", "licence-page.html", "raw-records.jsonl.gz", "observations.jsonl.gz", "candidate-records.jsonl.gz"):
        item = output / name
        artifacts.append({"file": name, "bytes": item.stat().st_size, "sha256": hashlib.sha256(item.read_bytes()).hexdigest()})
    manifest = {"status": "acquired_complete", "source_id": SOURCE_ID, "dataset_url": DATASET,
        "resource_url": RESOURCE, "download_url": DOWNLOAD, "licence_url": LICENCE, "rights_status": "licensed_open",
        "attribution": "Contains information licensed under the Open Government Licence – Ontario.",
        "observed_at": observed, "observed_at_basis": "Local raw-download file write timestamp; publisher reference dates remain separate.",
        "normalised_at": stamp(), "source_reference_date": "2026-09-30", "source_updated_at": "2026-10-23",
        "source_published_at": None, "record_unit": "Published facility/licence snapshot row, including inactive history; not a legal-company census.",
        "source_inventory_exhausted": True, "source_inventory_scope": "Offered September2026 XLSX resource only",
        "history_scope": "Facilities active at any time since2014-01-01; source snapshot2026-09-30.",
        "stats": stats, "artifacts": artifacts, "raw_sha256": raw_hash,
        "records_file": "observations.jsonl.gz", "records_sha256": next(item["sha256"] for item in artifacts if item["file"] == "observations.jsonl.gz"),
        "minimum_business_size_filter": None, "website_required": False, "email_required": False, "address_required": False,
        "individual_home_provider_locations_inferred": False, "person_or_child_records_created": 0,
        "market_completeness_verified": False,
        "limitations": ["Active is the publisher's licence status at the reference date; current business operations are unverified.",
            "Agency addresses are administrative/contact routes, not individual provider homes.",
            "Published non-Ontario addresses are retained without forcing ON or CA defaults.",
            "A licence number identifies the published childcare licence, not a legal corporation or property owner.",
            "The robots-disallowed CKAN API was not bypassed; the publicly offered HTML/resource/download route was permitted.",
            "The early blocked API probe lacks complete network meters; allowed-route probe metrics are separate receipts."]}
    _save(manifest_path, manifest)
    return manifest


def apply_childcare_acquisition(store, output, *, batch_size=250, progress=None):
    """Explicit later promotion: valid candidates plus every other raw licence.

    Inactive and explicit non-Ontario address records remain raw evidence, with
    no new account identity. All work for one chunk commits together. This
    helper performs no downloads and never creates people/owner relationships.
    """
    from .place_import import _committed_batch, _guard_storage, StoragePaused
    if not 1 <= batch_size <= 1000:
        raise ValueError("Childcare chunks must contain1–1000 source observations")
    output = Path(output)
    if not (output / "manifest.json").exists():
        raise ValueError("Freeze and review the childcare acquisition before promotion")
    manifest = freeze_childcare(output)
    if manifest.get("status") != "acquired_complete" or manifest.get("rights_status") != "licensed_open":
        raise ValueError("A fully verified licensed childcare acquisition is required")
    path = output / manifest["records_file"]
    preflight_rows = preflight_candidates = 0
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                row = json.loads(line)
                preflight_rows += 1
                preflight_candidates += bool(row["account_candidate_eligible"])
    if (preflight_rows != manifest["stats"]["raw_rows"] or
            preflight_candidates != manifest["stats"]["account_candidate_rows"]):
        raise ValueError("Frozen childcare row counts differ before promotion")
    source_id = store.upsert_source({"id": SOURCE_ID,
        "name": "Ontario licensed childcare facility snapshot, September2026 with inactive history",
        "publisher": "Ontario Ministry of Education", "source_url": DOWNLOAD,
        "source_type": "institutional_directory", "geography_scope": ["Ontario"],
        "sector_scope": ["education_research"], "rights_status": "licensed_open", "terms_url": LICENCE,
        "source_date": manifest["source_reference_date"], "last_checked_at": manifest["observed_at"],
        "retrieval_status": "accessible", "access_method": "offered_public_xlsx_download", "cost_model": "free",
        "adapter_name": "ontario_childcare_snapshot", "notes": manifest["history_scope"] +
        " Publisher updated2026-10-23; actual publication date unknown. Agency addresses are administrative/contact routes. No current-operation, corporation or owner claim."})
    report = {"source_id": source_id, "processed_raw_rows": 0, "account_candidate_rows": 0,
              "raw_only_rows": 0, "new_organisations": 0, "replayed_batches": 0,
              "people_created": 0, "ownership_relationships_created": 0}
    def ingest(chunk, start):
        eligible = [row for row in chunk if row["account_candidate_eligible"]]
        candidates = []
        for row in eligible:
            candidate = dict(row)
            if not row["address"]:
                candidate["city"] = None
                if row["postal_code"]:
                    candidate["location_type"] = "postal_route"
            candidates.append(candidate)
        metadata = {"adapter_name": "ontario_childcare_snapshot", "parser_version": "1",
            "batch_id": manifest["records_sha256"] + ":" + str(start),
            "observed_at": manifest["observed_at"], "acquisition_id": "ontario-childcare:" + manifest["raw_sha256"],
            "coverage_complete": False, "source_date": manifest["source_reference_date"],
            "requests": None, "bytes_fetched": None, "request_count_known": False,
            "transfer_bytes_known": False, "paid_service_calls": 0, "estimated_cost": 0,
            "meter_note": "Allowed-route probe receipts are saved; the earlier robots-denied API probe lacks full meters."}
        replay = _committed_batch(store, source_id, candidates, metadata)
        if not replay:
            if store.path != ":memory:":
                free = shutil.disk_usage(Path(store.path).resolve().parent).free
                if free < 2 * 1024 ** 3:
                    raise StoragePaused({"source_folder": str(output), "area": "Ontario-childcare",
                        "chunk": start // batch_size, "free_bytes": free, "required_free_bytes": 2 * 1024 ** 3})
            _guard_storage(store, chunk, {"source_folder": str(output), "area": "Ontario-childcare", "chunk": start // batch_size})
        with store.transaction():
            result = store.ingest(source_id, candidates, run_metadata=metadata)
            if not result.get("replayed"):
                for row in chunk:
                    if not row["account_candidate_eligible"]:
                        store.record_evidence(source_id, row, DOWNLOAD, manifest["observed_at"],
                            source_record_id=row["source_record_id"],
                            excerpt="Published childcare licence retained as raw evidence: " + row["candidate_eligibility_reason"])
                with store._buffer_field_assertions():
                    for row in eligible:
                        identity = store.db.execute("SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?",
                            (source_id, row["source_record_id"])).fetchone()
                        if identity is None:
                            continue
                        for field in ("program_type", "address_role", "source_licence_number", "source_licence_namespace",
                                "source_licensee_name", "licence_status_at_reference_date", "source_reference_date",
                                "source_original_licence_issue_date", "source_closure_or_termination_date", "source_updated_at"):
                            store.assert_field(identity["organisation_id"], "organisation", field, row[field],
                                identity["last_evidence_id"], manifest["observed_at"],
                                method="published_childcare_licence_observation", review_status="source_reported_unverified_current_operation")
                        store.assert_field(identity["organisation_id"], "organisation", "source_published_city", row["city"],
                            identity["last_evidence_id"], manifest["observed_at"], method="published_childcare_licence_observation")
                        if row["program_type"] in {"Child Care Centre", "Home Child Care Agency"}:
                            store.db.execute("""INSERT OR IGNORE INTO classifications
                                (id,entity_id,entity_type,taxonomy,category,classification_method,evidence_id,review_status)
                                VALUES(?,?,'organisation','ssm_industry_family','education_research',?,?, 'source_mapped')""",
                                (stable_id("childcare-source-family", identity["organisation_id"], identity["last_evidence_id"]),
                                 identity["organisation_id"], "official_licensed_childcare_program_type", identity["last_evidence_id"]))
        report["processed_raw_rows"] += len(chunk)
        report["account_candidate_rows"] += len(eligible)
        report["raw_only_rows"] += len(chunk) - len(eligible)
        report["new_organisations"] += 0 if result.get("replayed") else result["inserted_count"]
        report["replayed_batches"] += int(bool(result.get("replayed")))
        if progress:
            progress({**report, "last_batch_start": start, "run_id": result["run_id"]})
    pending, start = [], 0
    with gzip.open(path, "rt", encoding="utf-8") as stream:
        for line in stream:
            if line.strip():
                pending.append(json.loads(line))
            if len(pending) == batch_size:
                ingest(pending, start)
                start += len(pending)
                pending = []
        if pending:
            ingest(pending, start)
    if report["processed_raw_rows"] != manifest["stats"]["raw_rows"]:
        raise ValueError("Promoted childcare raw count differs from the frozen inventory")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(freeze_childcare(args.output), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
