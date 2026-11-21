"""Explicit source adapters: bulk files, ArcGIS IDs, and bounded public HTML.

Every result carries a cursor and source-completeness limitations. Nothing here
creates a CRM contact, authorizes outreach, or calls a paid API.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from .contact_normalization import parse_phone_candidate
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urljoin, urlsplit

from .sources import eligible
from .transport import SourceBlocked, BudgetExceeded

PARSER_VERSION = "market-map/1"


def _now():
    return datetime.now(timezone.utc).isoformat()


def _value(row, names):
    for name in names:
        if row.get(name) not in (None, ""):
            return row[name]
    return ""


def normalize(raw, source, observed_at=None, index=None):
    """Map publisher fields without fabricating missing routes or legal identity."""
    fields = source.get("field_map", {})
    choices = {
        "name": ["name", "Name", "NAME", "Business_Name", "COMPANY_NAME", "CompanyName", "BusinessName", "BUSINESS_NAME"],
        "website": ["website", "Web_Address", "WEBURL", "Website", "WebSite"],
        "city": ["city", "Municipality", "City", "CITY", "CITY_NAME"],
        "address": ["address", "BUSINESS_FULL_ADDRESS", "Mailing_Address1", "Address", "ADDRESS"],
        "postal_code": ["postal_code", "Site_Postal_Code", "POSTAL_CODE", "PostalCode"],
        "phone": ["phone", "Telephone_Number", "PHONE", "Phone", "Telephone"],
        "email": ["email", "Email", "EMAIL"],
        "categories": ["categories", "NAICSCode_Desc", "NAICS_DETAIL", "NAICS", "Category"],
        "province": ["province", "Province", "PROVINCE"],
        "country": ["country", "Country", "COUNTRY"],
        "source_record_id": ["source_record_id", "OBJECTID", "ObjectID", "Business_Id", "ID", "id"],
    }
    row = {}
    for target, defaults in choices.items():
        configured = fields.get(target)
        names = configured if isinstance(configured, list) else [configured] if configured else defaults
        value = _value(raw, names)
        row[target] = str(value).strip() if value is not None else ""
    if row["postal_code"]:
        compact = re.sub(r"\s+", "", row["postal_code"]).upper()
        row["postal_code"] = compact[:3]+" "+compact[3:] if len(compact) == 6 else row["postal_code"]
    if row["phone"]:
        phone = parse_phone_candidate(row['phone'])
        row.update(phone_raw=phone['raw_value'], phone=phone['e164'] or '', phone_extension=phone['extension'],
                   phone_format_status=phone['status'], phone_normalization=phone)
    if row["website"] and not row["website"].startswith(("https://", "http://")):
        row["website"] = "https://" + row["website"]
    row["province"] = row["province"] or source.get("province", "")
    row["country"] = row["country"] or source.get("country", "")
    row["city"] = row["city"] or source.get("city", "")
    row["city_raw"] = str(raw.get("City") or raw.get("city") or row["city"])
    row["municipality_name"] = str(raw.get("Municipality") or "")
    row["description"] = str(raw.get("Business_Description") or raw.get("description") or "")
    row["unit"] = str(raw.get("Unit_Number") or raw.get("UNIT") or raw.get("unit") or "")
    if not row["address"]:
        # Durham publishes street components rather than a single address field.
        # This only joins publisher-provided values; missing numbers remain absent.
        parts = [raw.get(k) for k in ("Street_Number", "Street_Name", "Street_Type", "Street_Direction")]
        street = " ".join(str(value).strip() for value in parts if value not in (None, ""))
        row["street"] = street
        row["address"] = ("Unit %s, " % row["unit"] if row["unit"] and street else "") + street
    if not row["source_record_id"]:
        # Files with no publisher ID get a content identity, never a row number
        # whose meaning changes when the publisher reorders the export.
        row["source_record_id"] = hashlib.sha256(json.dumps(raw, sort_keys=True, default=str).encode()).hexdigest()
    row["source_url"] = source.get("record_url_template", "").replace("{id}", row["source_record_id"]) or source["source_url"]
    naics = _value(raw, ["NAICSCode", "NAICS_DETAIL", "NAICS", "NAICS_CODE"])
    if naics not in (None, ""):
        row["naics_code"] = str(int(naics)) if isinstance(naics, float) and naics.is_integer() else str(naics)
        # The dataset must state its NAICS version; never silently assume 2022.
        row["naics_version"] = source.get("naics_version")
        row["taxonomy"] = "NAICS"
    row["raw_payload"] = raw
    row["observed_at"] = observed_at or _now()
    return row


def _request_json(transport, url, source):
    data = transport.fetch(url, allowed_hosts=source["allowed_hosts"]).json()
    if not isinstance(data, dict):
        raise SourceBlocked("Expected a JSON object from source API: " + url[:300])
    return data


def _result(source, transport, before, rows, **meta):
    requests = getattr(transport, "requests", 0) - before[0]
    byte_count = getattr(transport, "bytes_fetched", 0) - before[1]
    return {"rows": rows, "metadata": {"source_id": source["id"],
        "adapter_name": source["adapter_name"], "parser_version": PARSER_VERSION,
        "requests": requests, "bytes_fetched": byte_count, "estimated_cost": 0,
        "paid_service_calls": 0, "model_tokens": 0, "browser_rendered_pages": 0,
        "fetched_count": len(rows), "parsed_count": len(rows), **meta}}


def collect(source, *, transport, checkpoint=None, max_records=10000, max_pages=100, progress=None):
    ok, reason = eligible(source)
    if not ok:
        raise SourceBlocked(reason)
    if not 1 <= max_records <= 1_000_000 or not 1 <= max_pages <= 10000:
        raise ValueError("Explicit positive collection caps required")
    name = source["adapter_name"]
    before = (getattr(transport, "requests", 0), getattr(transport, "bytes_fetched", 0))
    checkpoint = json.loads(checkpoint) if isinstance(checkpoint, str) else checkpoint or {}
    if name == "arcgis":
        return _arcgis(source, transport, checkpoint, max_records, max_pages, before, progress)
    if name in ("csv", "json", "jsonl", "xlsx", "xls"):
        try:
            return _bulk(source, transport, checkpoint, max_records, before)
        except SourceBlocked:
            raise
        except (UnicodeError, json.JSONDecodeError, csv.Error, KeyError, TypeError, ValueError, StopIteration, OSError) as exc:
            raise SourceBlocked("Bulk source parse/schema failure: " + str(exc)[:300]) from exc
    if name in ("html_directory", "govstack_directory", "chambermaster_directory"):
        return _html(source, transport, checkpoint, max_records, max_pages, before)
    raise SourceBlocked("No configured adapter: " + str(name))


def _bulk(source, transport, checkpoint, limit, before):
    if source.get("local_path"):
        # Local fixture/import must be explicit; it cannot silently stand in for a
        # live network download or change a live source's access status.
        if source.get("retrieval_status") not in ("fixture", "manual_import"):
            raise SourceBlocked("Local input requires fixture/manual_import status")
        data = Path(source["local_path"]).read_bytes()
    else:
        data = transport.fetch(source.get("download_url", source["source_url"]), allowed_hosts=source["allowed_hosts"]).body
    payload_hash = hashlib.sha256(data).hexdigest()
    if checkpoint.get("payload_hash") and checkpoint["payload_hash"] != payload_hash:
        raise SourceBlocked("Bulk source changed since checkpoint; restart a new collection")
    name = source["adapter_name"]
    if name == "csv":
        text = data.decode(source.get("encoding", "utf-8-sig"))
        reader = csv.DictReader(io.StringIO(text), delimiter=source.get("delimiter", ","), strict=True)
        if not reader.fieldnames:
            raise SourceBlocked("CSV source has no header; not treated as empty coverage")
        if len(reader.fieldnames) != len(set(reader.fieldnames)) or any(not name.strip() for name in reader.fieldnames):
            raise SourceBlocked("CSV schema has duplicate or blank column names")
        name_fields = source.get("field_map", {}).get("name") or ["name", "Name", "NAME", "Business_Name", "COMPANY_NAME", "CompanyName", "BusinessName", "BUSINESS_NAME"]
        name_fields = [name_fields] if isinstance(name_fields, str) else name_fields
        if not any(field in reader.fieldnames for field in name_fields):
            raise SourceBlocked("CSV schema lacks the configured/recognized business-name column")
        records = list(reader)
        if any(None in row or any(value is None for value in row.values()) for row in records):
            raise SourceBlocked("CSV row width does not match its declared header")
    elif name == "jsonl":
        records = [json.loads(line) for line in data.splitlines() if line.strip()]
    elif name == "json":
        records = json.loads(data)
        for key in source.get("records_path", []):
            records = records[key]
    elif name == "xlsx":
        try:
            import openpyxl
        except ImportError as exc:
            raise SourceBlocked("XLSX adapter requires openpyxl") from exc
        book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        sheet = book[source["sheet_name"]] if source.get("sheet_name") else book.active
        values = iter(sheet.values)
        headers = [str(v or "") for v in next(values)]
        records = [dict(zip(headers, row)) for row in values]
        book.close()
    else:
        try:
            import xlrd
        except ImportError as exc:
            raise SourceBlocked("Legacy XLS adapter requires optional xlrd; not silently treated as CSV") from exc
        book = xlrd.open_workbook(file_contents=data)
        sheet = book.sheet_by_name(source["sheet_name"]) if source.get("sheet_name") else book.sheet_by_index(0)
        headers = [str(v or "") for v in sheet.row_values(0)]
        records = [dict(zip(headers, sheet.row_values(n))) for n in range(1, sheet.nrows)]
    if not isinstance(records, list) or any(not isinstance(row, dict) for row in records):
        raise SourceBlocked("Bulk payload does not contain a list of record objects")
    start = int(checkpoint.get("next_index", 0))
    if start < 0 or start > len(records):
        raise SourceBlocked("Invalid bulk checkpoint position")
    selected = records[start:start+limit]
    rows = [normalize(r, source) for r in selected]
    invalid = sum(not r["name"] for r in rows)
    end = start + len(selected)
    complete = end == len(records) and invalid == 0
    return _result(source, transport, before, rows, expected_count=len(records),
        status="completed" if complete else "partial", coverage_complete=complete and start == 0,
        source_query_exhausted=complete, collection_start_index=start, collection_end_index=end,
        cursor_checkpoint={"next_index": end, "payload_hash": payload_hash},
        payload_hash=payload_hash, invalid_rows=invalid,
        coverage_note="Source export traversal only; not a market census",
        input_mode=source.get("retrieval_status"), observed_at=_now())


def _arcgis(source, transport, checkpoint, limit, max_pages, before, progress=None):
    base = source.get("data_url", source["source_url"]).rstrip("/")
    metadata = _request_json(transport, base + "?f=json", source)
    fields = metadata.get("fields", [])
    oid = metadata.get("objectIdField") or metadata.get("objectIdFieldName") or next(
        (f["name"] for f in fields if f.get("type") == "esriFieldTypeOID"), None)
    if not oid:
        raise SourceBlocked("ArcGIS metadata lacks a stable object ID field")
    where = source.get("where", "1=1")
    query = base + "/query?"
    count = _request_json(transport, query+urlencode({"f": "json", "where": where, "returnCountOnly": "true"}), source).get("count")
    id_data = _request_json(transport, query+urlencode({"f": "json", "where": where, "returnIdsOnly": "true"}), source)
    ids = id_data.get("objectIds")
    if not isinstance(ids, list) or any(not isinstance(i, int) for i in ids):
        raise SourceBlocked("ArcGIS did not return a usable object ID inventory")
    ids = sorted(set(ids))
    snapshot = hashlib.sha256(json.dumps(ids).encode()).hexdigest()
    if checkpoint.get("snapshot_hash") and checkpoint["snapshot_hash"] != snapshot:
        raise SourceBlocked("ArcGIS ID inventory changed since checkpoint; restart a new collection")
    start = int(checkpoint.get("next_index", 0))
    if start < 0 or start > len(ids):
        raise SourceBlocked("Invalid ArcGIS checkpoint position")
    page_size = min(int(metadata.get("maxRecordCount") or 1000), int(source.get("page_size", 1000)), 1000)
    if page_size < 1:
        raise SourceBlocked("Invalid ArcGIS advertised page size")
    rows, fetched_ids, missing_ids, warnings = [], [], [], []
    index, pages = start, 0
    if count is None or count != len(ids) or id_data.get("exceededTransferLimit"):
        warnings.append("Count query and unique ID inventory do not reconcile")
    while index < len(ids) and len(rows) < limit and pages < max_pages:
        batch = ids[index:index+min(page_size, limit-len(rows))]
        params = {"f": "json", "objectIds": ",".join(map(str, batch)), "outFields": "*",
                  "returnGeometry": "true", "outSR": 4326}
        # IIS deployments often cap query-string length below a service's record
        # ceiling. Keep documented ID queries short without assuming offset support.
        while len(urlencode(params, safe=",")) > 3500 and len(batch) > 1:
            batch = batch[:max(1, len(batch)//2)]
            params["objectIds"] = ",".join(map(str, batch))
        try:
            data = _request_json(transport, query+urlencode(params, safe=","), source)
        except (BudgetExceeded, SourceBlocked) as exc:
            warnings.append(str(exc))
            break
        pages += 1
        features = data.get("features")
        if not isinstance(features, list):
            warnings.append("ArcGIS query lacks features; parser failure")
            break
        seen_page = set()
        for feature in features:
            raw = feature.get("attributes", {})
            identity = raw.get(oid)
            if identity not in batch or identity in seen_page:
                warnings.append("Unexpected or repeated object ID in query response")
                continue
            seen_page.add(identity)
            row = normalize(raw, {**source, "field_map": {**source.get("field_map", {}), "source_record_id": oid}})
            row["source_url"] = base + "/query?" + urlencode({"where": "%s=%s" % (oid, identity), "outFields": "*", "f": "json"})
            geometry = feature.get("geometry") or {}
            spatial_ref = (data.get("spatialReference") or geometry.get("spatialReference") or {}).get("wkid")
            if spatial_ref in (4326, None) and geometry.get("x") is not None and geometry.get("y") is not None:
                x, y = geometry["x"], geometry["y"]
                if -180 <= x <= 180 and -90 <= y <= 90:
                    row.update(longitude=x, latitude=y, coordinates_source=base)
            row["raw_payload"] = feature
            rows.append(row)
            fetched_ids.append(identity)
        missed = sorted(set(batch)-seen_page)
        if missed or data.get("exceededTransferLimit"):
            missing_ids.extend(missed)
            warnings.append("ArcGIS truncated or omitted requested IDs; checkpoint holds this page for retry")
            break
        index += len(batch)
        if progress:
            progress({"rows": rows, "metadata": {"source_id": source["id"],
                "adapter_name": "arcgis", "parser_version": PARSER_VERSION,
                "status": "partial", "coverage_complete": False,
                "expected_count": count, "fetched_count": len(rows),
                "cursor_checkpoint": {"next_index": index, "snapshot_hash": snapshot},
                "requests": getattr(transport, "requests", 0)-before[0],
                "bytes_fetched": getattr(transport, "bytes_fetched", 0)-before[1],
                "observed_at": _now(), "estimated_cost": 0,
                "coverage_note": "Durable in-progress collection; not a completed source run"}})
    invalid = sum(not r["name"] for r in rows)
    complete = index == len(ids) and count == len(ids) and not warnings and not invalid
    return _result(source, transport, before, rows, expected_count=count,
        status="completed" if complete else "partial", coverage_complete=complete and start == 0,
        source_query_exhausted=complete, collection_start_index=start, collection_end_index=index,
        cursor_checkpoint={"next_index": index, "snapshot_hash": snapshot},
        object_id_field=oid, id_inventory_count=len(ids), id_inventory_hash=snapshot,
        fetched_unique_ids=len(set(fetched_ids)), missing_ids=missing_ids,
        advertised_max_record_count=metadata.get("maxRecordCount"),
        supports_pagination=metadata.get("advancedQueryCapabilities", {}).get("supportsPagination"),
        spatial_reference=metadata.get("extent", {}).get("spatialReference"),
        pages=pages, warnings=warnings, invalid_rows=invalid, observed_at=_now(),
        coverage_note="Reconciled source ID traversal, not business census completeness",
        attribution=source.get("attribution"), terms_url=source.get("terms_url"))


def _html(source, transport, checkpoint, limit, max_pages, before):
    try:
        from lxml import html
    except ImportError as exc:
        raise SourceBlocked("HTML adapters require lxml") from exc
    # An explicit null continuation means the saved walk reached its last
    # linked page. Do not interpret it as permission to restart at page one.
    url = checkpoint["next_url"] if "next_url" in checkpoint else source["source_url"]
    seen = set(checkpoint.get("seen_urls", []))
    rows, pages, warnings = [], 0, []
    page_fingerprints = set(checkpoint.get("page_fingerprints", []))
    while url and pages < max_pages and len(rows) < limit:
        if url in seen:
            warnings.append("Pagination loop detected")
            break
        try:
            response = transport.fetch(url, allowed_hosts=source["allowed_hosts"])
        except (BudgetExceeded, SourceBlocked) as exc:
            warnings.append(str(exc))
            break
        document = html.fromstring(response.body)
        cards = document.xpath(source.get("card_xpath", '//div[contains(@class,"gs-feed-list-meta")]'))
        if not cards:
            warnings.append("No configured directory cards found; not counted as empty coverage")
            break
        page_rows = []
        for card in cards:
            links = card.xpath(source.get("name_xpath", './/a[contains(@class,"gs-feed-list-title")]'))
            if not links:
                continue
            link = links[0]
            name = " ".join(link.text_content().split())
            address = " ".join(" ".join(card.xpath(source.get("address_xpath", './/*[contains(@class,"bd-address")]//text()'))).split())
            href = urljoin(url, link.get("href", ""))
            if not name or urlsplit(href).hostname not in source["allowed_hosts"]:
                continue
            row = normalize({"name": name, "address": address, "source_record_id": href}, source)
            row["source_url"] = href
            page_rows.append(row)
        if not page_rows:
            warnings.append("Directory cards have no parsed identities")
            break
        fingerprint = hashlib.sha256(json.dumps(sorted(r["source_record_id"] for r in page_rows)).encode()).hexdigest()
        if fingerprint in page_fingerprints:
            warnings.append("Directory returned a repeated result page at a new URL")
            break
        page_fingerprints.add(fingerprint)
        if len(rows)+len(page_rows) > limit:
            warnings.append("Record cap holds entire next page for resumable retrieval")
            break
        rows.extend(page_rows)
        seen.add(url)
        pages += 1
        nexts = document.xpath(source.get("next_xpath", '//a[@rel="next"]/@href | //a[@aria-label="Next"]/@href'))
        next_url = urljoin(url, nexts[0]) if nexts else None
        if next_url and (next_url.startswith("javascript:") or "loadData(" in next_url):
            warnings.append("JavaScript/form pagination requires source-specific reviewed adapter")
            url = next_url
            break
        url = next_url
    complete = not url and not warnings and source.get("html_pagination_verified", False)
    return _result(source, transport, before, rows,
        status="completed" if complete else "partial", coverage_complete=complete,
        cursor_checkpoint={"next_url": url, "seen_urls": sorted(seen), "page_fingerprints": sorted(page_fingerprints)},
        source_query_exhausted=bool(not url and not warnings and source.get("html_pagination_verified", False)),
        pages=pages, warnings=warnings, expected_count=source.get("reported_count"),
        coverage_note="Public HTML traversal; absence of next link is complete only for a verified pagination contract",
        observed_at=_now())
