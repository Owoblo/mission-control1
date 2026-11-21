"""Resumable Toronto licence-record collection through the permitted CKAN API.

Scope is licences with no recorded cancellation, not verified active companies.
The City dataset has no authoritative company identifier. Licence numbers stay
separate provisional candidates; similar licencees are left for identity review.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

from .transport import Transport, SourceBlocked, BudgetExceeded

RESOURCE_ID = "169e90ba-3ae0-43dd-8b2f-919e87002f50"
API_URL = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search"


def _now():
    return datetime.now(timezone.utc).isoformat()


def _atomic(path, data):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False) + "\n")
    temp.replace(path)


def normalise_licence(record, source, observed_at):
    if record.get("Cancel Date") not in (None, ""):
        raise SourceBlocked("Publisher no-cancellation filter returned a cancelled record")
    def published_value(field):
        value = record.get(field)
        return None if value is None or str(value).strip().casefold() in {"", "none", "null"} else str(value).strip()
    number = published_value("Licence No.")
    if not number:
        raise SourceBlocked("Licence number missing; source identity cannot be preserved")
    name = published_value("Operating Name") or published_value("Client Name")
    if not name:
        raise SourceBlocked("Published trading/client name missing")
    city_line = published_value("Licence Address Line 2") or ""
    match = re.fullmatch(r"(.+?)[,\s]+(ON|ONTARIO)", city_line, re.I)
    city = match[1].rstrip(", ") if match else ""
    return {"source_record_id": number, "source_url": source["source_url"],
            "name": name,
            "entity_type": "licensed_business_candidate", "location_type": "unknown",
            "address": published_value("Licence Address Line 1"), "city": city,
            "province": "ON" if match else None, "country": "CA" if match else None,
            "postal_code": published_value("Licence Address Line 3"), "phone": published_value("Business Phone"),
            "categories": [record["Category"]] if record.get("Category") else [],
            "taxonomy": "toronto_licence_category", "observed_at": observed_at,
            "source_published_at": record.get("Last Record Update"),
            "source_licence_cancellation_status": "no_cancellation_recorded",
            "description": "Publisher licence/permit record with no recorded cancellation; current business operation and legal identity remain unverified.",
            "raw_payload": record}


def collect_toronto_licences(source, *, transport, output_path, max_records=250000, page_size=10000, max_pages=200):
    """Collect a count-reconciled uncancelled-record scope with durable pages.

    A checkpoint is written only after a complete response is saved. Subsequent
    calls use saved pages and the original offset; no record cap implies scope
    completion. An API failure leaves the existing pages and cursor resumable.
    """
    if source.get("rights_status") not in {"permitted", "licensed_open", "open_licence", "open_license"}:
        raise SourceBlocked("Reviewed publisher reuse permission required")
    if not 1 <= max_records <= 1000000 or not 1 <= page_size <= 10000 or not 1 <= max_pages <= 10000:
        raise ValueError("Invalid explicit collection budget")
    folder = Path(output_path)
    folder.mkdir(parents=True, exist_ok=True)
    state_path = folder / "checkpoint.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {"resource_id": RESOURCE_ID,
        "scope": "full_publisher_roster_then_no_cancellation_recorded", "offset": 0, "expected_count": None, "pages": [],
        "observed_at": _now(), "status": "pending"}
    if state.get("resource_id") != RESOURCE_ID or state.get("scope") != "full_publisher_roster_then_no_cancellation_recorded":
        raise SourceBlocked("Checkpoint belongs to another source scope")
    if state["expected_count"] is None and source.get("reported_count") is not None:
        # Exact record_count is advertised on the official CKAN resource
        # metadata. Avoid an expensive API count during the documented outage;
        # still reconcile every fetched object ID against that named snapshot.
        state["expected_count"] = int(source["reported_count"])
        state["expected_count_basis"] = "official_resource_metadata_record_count"
    acquired = []
    seen_ids = set()
    for page_file in state["pages"]:
        page = json.loads((folder / page_file).read_text())
        for record in page["records"]:
            ident = record.get("_id")
            if ident in seen_ids:
                raise SourceBlocked("Duplicate source object ID in saved pages")
            seen_ids.add(ident)
            acquired.append(record)
    before_requests = transport.requests
    before_bytes = transport.bytes_fetched
    try:
        for _ in range(max_pages):
            if state["status"] == "completed":
                break
            if len(acquired) >= max_records:
                state["status"] = "partial"
                state["limitation"] = "Explicit record cap reached; resume with a larger bound"
                break
            limit = min(page_size, max_records - len(acquired))
            # CKAN's JSON-null equality filter returned zero even though the
            # roster contains open records; SQL endpoint is unavailable. Read
            # the complete permitted API roster, then apply the explicit field
            # condition locally. Never call a failed filter an empty market.
            params = {"resource_id": RESOURCE_ID, "sort": "_id asc", "offset": state["offset"], "limit": limit,
                      "include_total": "true" if state["expected_count"] is None else "false"}
            response = transport.fetch(API_URL + "?" + urlencode(params), allowed_hosts=["ckan0.cf.opendata.inter.prod-toronto.ca"])
            data = response.json()
            if not data.get("success") or not isinstance(data.get("result", {}).get("records"), list):
                raise SourceBlocked("CKAN returned no successful record list")
            result = data["result"]
            expected = result.get("total")
            if expected is not None:
                if state["expected_count"] is not None and int(expected) != state["expected_count"]:
                    raise SourceBlocked("Publisher total changed during collection; review snapshot consistency")
                state["expected_count"] = int(expected)
            records = result["records"]
            if records and any(r.get("_id") is None for r in records):
                raise SourceBlocked("CKAN object IDs missing")
            ordered_ids = [r["_id"] for r in records]
            if ordered_ids != sorted(ordered_ids) or len(set(ordered_ids)) != len(ordered_ids) or any(i in seen_ids for i in ordered_ids) or (ordered_ids and seen_ids and ordered_ids[0] <= max(seen_ids)):
                raise SourceBlocked("Duplicate or non-advancing source page")
            filename = f"page-{state['offset']:08d}.json"
            _atomic(folder / filename, {"url": response.url if hasattr(response, "url") else API_URL,
                    "records": records, "expected_count": state["expected_count"], "observed_at": state["observed_at"]})
            state["pages"].append(filename)
            state.pop("error", None)
            state["offset"] += len(records)
            acquired.extend(records)
            seen_ids.update(ordered_ids)
            if state["expected_count"] is not None:
                if state["offset"] > state["expected_count"]:
                    raise SourceBlocked("Fetched source IDs exceed publisher filtered count")
                if state["offset"] == state["expected_count"]:
                    state["status"] = "completed"
                elif not records:
                    raise SourceBlocked("Source stopped before expected filtered count")
                else:
                    state["status"] = "running"
            elif not records:
                state["status"] = "completed"
            else:
                state["status"] = "running"
            _atomic(state_path, state)
        if state["status"] == "running":
            state["status"] = "partial"
            state["limitation"] = "Explicit page cap reached; source cursor remains resumable"
    except (SourceBlocked, BudgetExceeded, OSError) as exc:
        state["status"] = "partial" if acquired else "blocked"
        state["error"] = str(exc)
    state["requests_total"] = int(state.get("requests_total") or 0) + transport.requests - before_requests
    state["bytes_fetched_total"] = int(state.get("bytes_fetched_total") or 0) + transport.bytes_fetched - before_bytes
    _atomic(state_path, state)
    rows, quarantined = [], []
    cancelled = 0
    for record in acquired:
        if record.get("Cancel Date") not in (None, ""):
            cancelled += 1
            continue
        try:
            rows.append(normalise_licence(record, source, state["observed_at"]))
        except SourceBlocked as error:
            # Preserve publisher object IDs and complete saved raw pages. A
            # literal "None" licence/name is not a company or shared licence ID.
            quarantined.append({"publisher_object_id": record.get("_id"),
                "reason": str(error), "raw_payload": record})
    _atomic(folder / "quarantined-licence-records.json", {"source_id": source["id"],
        "observed_at": state["observed_at"], "records": quarantined})
    batch = {"rows": rows, "metadata": {"source_id": source["id"], "adapter_name": "toronto_ckan_licences",
        "parser_version": "toronto-licences/2-null-placeholders", "observed_at": state["observed_at"],
        "status": "completed" if state["status"] == "completed" else "partial" if rows else "blocked",
        "coverage_complete": state["status"] == "completed", "source_query_exhausted": state["status"] == "completed",
        "expected_count": len(rows) if state["status"] == "completed" else None,
        "publisher_roster_expected_count": state["expected_count"], "licence_records_read": len(acquired),
        "cancelled_licence_records_excluded_from_account_candidates": cancelled,
        "quarantined_count": len(quarantined), "invalid_publisher_records_excluded_from_account_candidates": len(quarantined),
        "quarantined_records_file": "quarantined-licence-records.json",
        "fetched_count": len(acquired), "parsed_count": len(rows),
        "requests": state["requests_total"], "bytes_fetched": state["bytes_fetched_total"],
        "incremental_requests": transport.requests - before_requests, "incremental_bytes_fetched": transport.bytes_fetched - before_bytes,
        "estimated_cost": 0, "cursor_checkpoint": state, "paid_service_calls": 0,
        "scope": "Licence/permit records with no recorded cancellation; not verified active businesses or unique companies",
        "company_identity_limitation": "No authoritative company/client ID supplied. Multiple licences may refer to one organisation or site; conservative candidates remain separate for review."}}
    _atomic(folder / "batch.json", batch)
    return batch


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-records", type=int, default=250000)
    parser.add_argument("--page-size", type=int, default=10000)
    parser.add_argument("--max-pages", type=int, default=200)
    args = parser.parse_args()
    fragment = json.loads(args.source_file.read_text())
    source = next(s for s in fragment["sources"] if s["id"] == "toronto-business-licences")
    transport = Transport(args.output / "http-cache", max_requests=220, max_bytes=150000000,
                          timeout=40, max_response_bytes=12000000, min_interval=.25, retries=1)
    batch = collect_toronto_licences(source, transport=transport, output_path=args.output,
                                  max_records=args.max_records, page_size=args.page_size, max_pages=args.max_pages)
    _atomic(args.output / "transport-metrics.json", transport.metrics())
    print(json.dumps({"rows": len(batch["rows"]), **batch["metadata"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
