"""Read-only cross-source site/name candidates, never identity resolutions.

Matching requires exact normalized published name, full address and locality.
Contact reuse, brands and shared premises provide review context only. Source
observations/dates remain separate; MAIN, ownership and outreach are untouched.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

VERSION = "exact-published-site-review/2026-10-26.1"
UNKNOWN = {"", "..", "...", "n/a", "na", "nan", "none", "null", "unknown", "not available"}
UNIT = re.compile(r"\b(?:unit|suite|ste|apt|apartment|room|rm)\.?\s*[:#-]?\s*([\w]+(?:[-/][\w]+)?)\b", re.I)
OBS_COLUMNS = ["id","input_id","source_id","source_record_id","source_record_id_basis","source_row_ordinal",
    "name_raw","address_raw","city_raw","name_key","address_key","city_key","site_key",
    "declared_unit_raw","address_unit_raw","unit_key","unit_status","unit_internal_conflict",
    "postal_raw","postal_key","postal_status","website_raw","domain","phones_json",
    "observed_at","published_at","reference_note","original_provider","source_url","eligible","held_reason","input_row_ordinal"]
CLUSTER_COLUMNS = ["review_cluster_id","review_lane","published_name_sample","published_address_sample","published_locality_sample",
    "normalized_published_name","normalized_full_address","normalized_locality","match_criteria","source_observation_count",
    "distinct_provider_GERS","distinct_historical_source_records","known_unit_values","unit_unknown_observations","known_postal_values",
    "postal_unknown_observations","same_name_distinct_observed_sites","same_address_distinct_published_names",
    "ambiguity_flags_json","emitted_observations","observations_truncated","identity_decision","campaign_ready"]
MEMBER_COLUMNS = ["review_cluster_id","review_lane","review_observation_id","source_id","source_record_id","source_record_id_basis",
    "source_row_ordinal","source_cohort","published_name","published_full_address","published_locality","declared_unit",
    "address_embedded_unit","unit_status","published_postal","postal_status","published_website","published_phones_json",
    "source_observed_at","source_published_at","source_reference_note","original_provider","source_url","input_file","input_sha256",
    "input_row_ordinal","ambiguity_flags_json","identity_decision","campaign_ready"]


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda:stream.read(1024*1024), b""):
            digest.update(block)
    return digest.hexdigest()


def safe(value):
    if value is None:
        return ""
    if isinstance(value,(int,float)) and not isinstance(value,bool):
        return value
    value = str(value)
    return "'"+value if value.lstrip().startswith(("=","+","-","@")) else value


def text(value):
    value = str(value or "").strip()
    # The frozen views document spreadsheet-formula escaping. Retain the view
    # value in raw fields; remove only that explicit escape for comparison.
    if value.startswith("'") and value[1:].lstrip().startswith(("=","+","-","@")):
        value = value[1:]
    return value


def key(value):
    value = unicodedata.normalize("NFKC",text(value)).casefold()
    return " ".join(re.sub(r"[^\w]+"," ",value,flags=re.UNICODE).replace("_"," ").split())


def known(value):
    return text(value).casefold() not in UNKNOWN


def unit_key(value):
    value = text(value)
    if not known(value):
        return ""
    return key(re.sub(r"^(?:unit|suite|ste|apt|apartment|room|rm)\.?\s*[:#-]?\s*","",value,flags=re.I).lstrip("#"))


def observation(row,spec,ordinal,detail=None):
    detail = detail or {}
    historical = spec["kind"] == "historical"
    identity = row.get("source_observation_id") if historical else row.get("provider_gers_id")
    source_id = spec.get("source_id") if historical else "overture-"+str(row.get("provider_release") or "unknown-release")
    name, address, city = row.get("name") or "", row.get("address") or "", row.get("city") or ""
    nk, ak, ck = (key(value) if known(value) else "" for value in (name,address,city))
    declared = detail.get("unit_raw") or row.get("unit") or ""
    declared = declared if known(declared) else ""
    embedded = UNIT.search(text(address))
    embedded = embedded.group(1) if embedded else ""
    declared_key, embedded_key = unit_key(declared), unit_key(embedded)
    conflict = bool(declared_key and embedded_key and declared_key != embedded_key)
    unit = declared_key or embedded_key
    unit_status = "conflicting_published_unit_fields" if conflict else "publisher_declared" if declared_key else "explicit_address_unit" if embedded_key else "not_published_or_not_parsed"
    postal = row.get("postal_code") or ""
    postal_key = re.sub(r"[^A-Z0-9]","",text(postal).upper()) if known(postal) else ""
    postal_status = "published" if re.fullmatch(r"[A-Z]\d[A-Z]\d[A-Z]\d",postal_key) else "unknown" if not postal_key else "unrecognised_published_format"
    website = row.get("website") or ""
    try:
        domain = (urlsplit(website if "://" in website else "https://"+website).hostname or "").casefold().removeprefix("www.")
    except ValueError:
        domain = ""
    held = [label for label,value in (("name",nk),("full_address",ak),("locality",ck),("source_record_id",identity)) if not value]
    return {"id":hashlib.sha256(json.dumps([spec["kind"],spec["cohort"],spec["sha256"],ordinal]).encode()).hexdigest(),"input_id":spec["input_id"],
        "source_id":source_id,"source_record_id":identity or "","source_record_id_basis":row.get("source_record_id_basis") or ("publisher_record_id_unspecified_scope" if historical else "publisher_GERS"),
        "source_row_ordinal":row.get("source_row_ordinal") or "","name_raw":name,"address_raw":address,"city_raw":city,
        "name_key":nk,"address_key":ak,"city_key":ck,"site_key":hashlib.sha256(json.dumps([ak,ck]).encode()).hexdigest(),
        "declared_unit_raw":declared,"address_unit_raw":embedded,"unit_key":unit,"unit_status":unit_status,"unit_internal_conflict":int(conflict),
        "postal_raw":postal,"postal_key":postal_key,"postal_status":postal_status,"website_raw":website,"domain":domain,
        "phones_json":row.get("phones_json") or "[]","observed_at":row.get("observed_at") or spec.get("observed_at") or "",
        "published_at":row.get("publication_date") if historical else str(row.get("provider_release") or "")[:10],
        "reference_note":spec.get("reference_note") or row.get("input_files_collected") or "Publisher snapshot; current operating status unverified",
        "original_provider":row.get("original_provider") or "Overture Maps Foundation and retained contributors",
        "source_url":row.get("source_url") or "","eligible":int(not held),"held_reason":";".join(held),"input_row_ordinal":ordinal}


def input_spec(path,kind,cohort,input_id):
    path = Path(path).resolve()
    digest = sha(path)
    spec = {"path":str(path),"sha256":digest,"kind":kind,"cohort":cohort,"input_id":input_id,
        "source_id":"statcan-odbus-2023-v1" if kind == "historical" else None}
    candidates = [path.parent/"manifest.json",path.parent/"odbus-historical-view-manifest.json",path.parent/"next-release-summary.json"]
    verified = False
    for candidate in candidates:
        if not candidate.exists():
            continue
        data = json.loads(candidate.read_text())
        files = data.get("output_files",[]) + ([data] if data.get("file") else [])
        item = next((item for item in files if item.get("file") == path.name),None)
        if item:
            if item["sha256"] != digest:
                raise ValueError("Input differs from frozen artifact manifest: "+str(path))
            spec["expected_rows"] = item["rows"]
            spec["manifest"] = str(candidate)
            verified = True
            break
    if not verified:
        raise ValueError("Review input requires its frozen count/hash manifest: "+str(path))
    if kind == "historical":
        report_path = path.parent/"statcan-odbus-inspection.json"
        if report_path.exists():
            report = json.loads(report_path.read_text())
            spec.update({"source_id":report["source_id"],"observed_at":report["observed_at"],
                "reference_note":report["reference_period"],"historical_metadata":str(report_path),
                "raw_details_file":str(path.parent/report["records_file"]),"raw_details_sha256":report["records_sha256"]})
    return spec


def capacity(folder,minimum=2*1024**3):
    available = shutil.disk_usage(Path(folder).resolve()).free
    if available < minimum:
        raise RuntimeError(f"Identity review paused: {available} free bytes; {minimum} required. MAIN and frozen inputs unchanged.")
    return available


def connect_scratch(path):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA cache_size=-32768")
    db.execute("PRAGMA temp_store=FILE")
    db.executescript("""CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS inputs(id INTEGER PRIMARY KEY,kind TEXT,cohort TEXT,path TEXT,sha256 TEXT,status TEXT,rows_loaded INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS historical_units(source_record_id TEXT PRIMARY KEY,unit_raw TEXT);
        CREATE TABLE IF NOT EXISTS observations(
          id TEXT NOT NULL,input_id INTEGER,source_id TEXT,source_record_id TEXT,source_record_id_basis TEXT,source_row_ordinal TEXT,
          name_raw TEXT,address_raw TEXT,city_raw TEXT,name_key TEXT,address_key TEXT,city_key TEXT,site_key TEXT,
          declared_unit_raw TEXT,address_unit_raw TEXT,unit_key TEXT,unit_status TEXT,unit_internal_conflict INTEGER,
          postal_raw TEXT,postal_key TEXT,postal_status TEXT,website_raw TEXT,domain TEXT,phones_json TEXT,
          observed_at TEXT,published_at TEXT,reference_note TEXT,original_provider TEXT,source_url TEXT,
          eligible INTEGER,held_reason TEXT,input_row_ordinal INTEGER,UNIQUE(input_id,input_row_ordinal));
    """)
    return db


def load_units(db,spec):
    path = spec.get("raw_details_file")
    if not path:
        return {"status":"not_available_units_remain_unknown","known_units":0}
    if sha(path) != spec["raw_details_sha256"]:
        raise ValueError("Frozen historical unit-detail source differs")
    marker = "historical_units_loaded:"+spec["raw_details_sha256"]
    if db.execute("SELECT 1 FROM metadata WHERE key=?",(marker,)).fetchone():
        return {"status":"replayed_verified_sidecar","known_units":db.execute("SELECT COUNT(*) FROM historical_units").fetchone()[0]}
    rows = []
    with gzip.open(path,"rt",encoding="utf-8") as stream:
        for line in stream:
            row=json.loads(line)
            value=(row.get("raw_payload") or {}).get("unit")
            if known(value):
                rows.append((row["source_record_id"],str(value)))
            if len(rows)>=1000:
                with db:db.executemany("INSERT OR REPLACE INTO historical_units VALUES(?,?)",rows)
                rows=[]
        with db:
            db.executemany("INSERT OR REPLACE INTO historical_units VALUES(?,?)",rows)
            db.execute("INSERT OR REPLACE INTO metadata VALUES(?,?)",(marker,"complete"))
    return {"status":"publisher_units_loaded_from_verified_frozen_sidecar","known_units":db.execute("SELECT COUNT(*) FROM historical_units").fetchone()[0]}


def load_input(db,spec,folder,progress=None):
    existing=db.execute("SELECT * FROM inputs WHERE id=?",(spec["input_id"],)).fetchone()
    if existing and existing["status"]=="complete":
        return {"input_id":spec["input_id"],"rows":existing["rows_loaded"],"replayed":True}
    with db:
        db.execute("INSERT OR IGNORE INTO inputs(id,kind,cohort,path,sha256,status) VALUES(?,?,?,?,?,'loading')",
            (spec["input_id"],spec["kind"],spec["cohort"],spec["path"],spec["sha256"]))
    checkpoint=existing["rows_loaded"] if existing else 0
    pending=[]
    sql="INSERT OR IGNORE INTO observations("+",".join(OBS_COLUMNS)+") VALUES("+",".join("?" for _ in OBS_COLUMNS)+")"
    ordinal=0
    def commit():
        capacity(folder,minimum=256*1024**2)
        with db:
            db.executemany(sql,pending)
            db.execute("UPDATE inputs SET rows_loaded=? WHERE id=?",(ordinal,spec["input_id"]))
        pending.clear()
    with gzip.open(spec["path"],"rt",encoding="utf-8",newline="") as stream:
        for ordinal,row in enumerate(csv.DictReader(stream),1):
            if ordinal<=checkpoint:
                continue
            detail=None
            if spec["kind"]=="historical":
                unit=db.execute("SELECT unit_raw FROM historical_units WHERE source_record_id=?",(row.get("source_observation_id"),)).fetchone()
                detail=dict(unit) if unit else None
            item=observation(row,spec,ordinal,detail)
            pending.append(tuple(item[column] for column in OBS_COLUMNS))
            if len(pending)>=1000:
                commit()
                if progress and ordinal%25000==0:progress({"input":spec["cohort"],"rows_loaded":ordinal})
        if pending:commit()
    if ordinal!=spec["expected_rows"]:
        raise ValueError("Frozen input count differs from parsed CSV: "+spec["path"])
    with db:db.execute("UPDATE inputs SET status='complete',rows_loaded=? WHERE id=?",(ordinal,spec["input_id"]))
    return {"input_id":spec["input_id"],"rows":ordinal,"replayed":False}


def writer(path,columns):
    raw=path.open("wb")
    compressed=gzip.GzipFile(fileobj=raw,filename="",mode="wb",mtime=0)
    stream=io.TextIOWrapper(compressed,encoding="utf-8",newline="")
    csv_writer=csv.DictWriter(stream,fieldnames=columns)
    csv_writer.writeheader()
    return csv_writer,stream,raw


def export_lane(db,output,provider_input,historical_input,lane,*,max_groups,max_members,max_total_members):
    output.mkdir(parents=True,exist_ok=True)
    group_path=output/"candidate-clusters.csv.gz"
    member_path=output/"source-observations-in-candidate-clusters.csv.gz"
    groups,group_stream,group_raw=writer(group_path.with_suffix(".gz.partial"),CLUSTER_COLUMNS)
    members,member_stream,member_raw=writer(member_path.with_suffix(".gz.partial"),MEMBER_COLUMNS)
    group_count=emitted=total_observations=0
    city_counts=Counter();flag_counts=Counter()
    summary_sql="""SELECT name_key,address_key,city_key,site_key,COUNT(*) AS n,
       COUNT(DISTINCT CASE WHEN input_id=? THEN source_id||':'||source_record_id END) AS providers,
       COUNT(DISTINCT CASE WHEN input_id=? THEN source_id||':'||source_record_id END) AS historical,
       COUNT(DISTINCT NULLIF(unit_key,'')) AS units,SUM(unit_key='') AS unit_unknown,
       SUM(unit_internal_conflict) AS unit_internal,COUNT(DISTINCT NULLIF(postal_key,'')) AS postals,
       SUM(postal_key='') AS postal_unknown,SUM(postal_status='unrecognised_published_format') AS postal_format
       FROM observations WHERE eligible=1 AND input_id IN (?,?)
       GROUP BY name_key,address_key,city_key
       HAVING SUM(input_id=?)>0 AND SUM(input_id=?)>0 ORDER BY city_key,name_key,address_key LIMIT ?"""
    cursor=db.execute(summary_sql,(provider_input,historical_input,provider_input,historical_input,provider_input,historical_input,max_groups+1))
    capped=False
    try:
        for cluster in cursor:
            if group_count>=max_groups or emitted>=max_total_members:
                capped=True;break
            key_parts=[VERSION,lane,cluster["name_key"],cluster["address_key"],cluster["city_key"]]
            cluster_id="review-cluster:"+hashlib.sha256(json.dumps(key_parts,ensure_ascii=False).encode()).hexdigest()[:32]
            name_context=db.execute("SELECT sites FROM name_context WHERE lane=? AND name_key=?",(lane,cluster["name_key"])).fetchone()
            site_context=db.execute("SELECT names FROM site_context WHERE lane=? AND site_key=?",(lane,cluster["site_key"])).fetchone()
            name_sites=name_context[0] if name_context else 1
            site_names=site_context[0] if site_context else 1
            flags=["historical_status_requires_current_verification","legal_identity_and_ownership_unresolved"]
            if cluster["units"]>1:flags.append("published_unit_conflict")
            if cluster["unit_unknown"]:flags.append("unit_not_published_or_not_parsed")
            if cluster["unit_internal"]:flags.append("unit_fields_disagree_within_source_observation")
            if cluster["postals"]>1:flags.append("published_postal_conflict")
            if cluster["postal_unknown"]:flags.append("postal_unknown")
            if cluster["postal_format"]:flags.append("postal_format_requires_review")
            if name_sites>1:flags.append("same_published_name_multiple_observed_sites_brand_or_franchise_role_unresolved")
            if site_names>1:flags.append("different_published_names_share_address_across_snapshots")
            if cluster["providers"]>1:flags.append("multiple_provider_GERS_at_same_published_key")
            if cluster["historical"]>1:flags.append("multiple_historical_licence_or_directory_observations")
            limit=min(max_members,max_total_members-emitted)
            rows=db.execute("""SELECT o.*,i.cohort,i.path AS input_file,i.sha256 AS input_sha256
                FROM observations o JOIN inputs i ON i.id=o.input_id WHERE o.eligible=1 AND o.input_id IN (?,?)
                AND o.name_key=? AND o.address_key=? AND o.city_key=?
                ORDER BY o.input_id,o.source_id,o.source_record_id,o.input_row_ordinal LIMIT ?""",
                (provider_input,historical_input,cluster["name_key"],cluster["address_key"],cluster["city_key"],limit)).fetchall()
            truncated=len(rows)<cluster["n"]
            if truncated:flags.append("member_view_truncated_all_observations_retained_in_scratch_and_frozen_inputs")
            sample=rows[0]
            record={"review_cluster_id":cluster_id,"review_lane":lane,"published_name_sample":sample["name_raw"],
                "published_address_sample":sample["address_raw"],"published_locality_sample":sample["city_raw"],
                "normalized_published_name":cluster["name_key"],"normalized_full_address":cluster["address_key"],"normalized_locality":cluster["city_key"],
                "match_criteria":"exact_normalized_published_name+full_address+locality","source_observation_count":cluster["n"],
                "distinct_provider_GERS":cluster["providers"],"distinct_historical_source_records":cluster["historical"],
                "known_unit_values":cluster["units"],"unit_unknown_observations":cluster["unit_unknown"],"known_postal_values":cluster["postals"],
                "postal_unknown_observations":cluster["postal_unknown"],"same_name_distinct_observed_sites":name_sites,
                "same_address_distinct_published_names":site_names,"ambiguity_flags_json":json.dumps(flags),"emitted_observations":len(rows),
                "observations_truncated":truncated,"identity_decision":"human_review_required_no_merge","campaign_ready":False}
            groups.writerow({column:safe(record.get(column)) for column in CLUSTER_COLUMNS})
            for row in rows:
                member={"review_cluster_id":cluster_id,"review_lane":lane,"review_observation_id":row["id"],
                    **{field:row[field] for field in ("source_id","source_record_id","source_record_id_basis","source_row_ordinal","source_url","input_file","input_sha256","input_row_ordinal","original_provider")},
                    "source_cohort":row["cohort"],"published_name":row["name_raw"],"published_full_address":row["address_raw"],"published_locality":row["city_raw"],
                    "declared_unit":row["declared_unit_raw"],"address_embedded_unit":row["address_unit_raw"],"unit_status":row["unit_status"],
                    "published_postal":row["postal_raw"],"postal_status":row["postal_status"],"published_website":row["website_raw"],"published_phones_json":row["phones_json"],
                    "source_observed_at":row["observed_at"],"source_published_at":row["published_at"],"source_reference_note":row["reference_note"],
                    "ambiguity_flags_json":json.dumps(flags),"identity_decision":"human_review_required_no_merge","campaign_ready":False}
                members.writerow({column:safe(member.get(column)) for column in MEMBER_COLUMNS})
            group_count+=1;emitted+=len(rows);total_observations+=cluster["n"]
            city_counts[sample["city_raw"]]+=1;flag_counts.update(flags)
    finally:
        group_stream.close();group_raw.close();member_stream.close();member_raw.close()
    files=[]
    for path,count in ((group_path,group_count),(member_path,emitted)):
        temporary=path.with_suffix(".gz.partial")
        with gzip.open(temporary,"rt",encoding="utf-8",newline="") as stream:
            if sum(1 for _ in csv.DictReader(stream))!=count:raise ValueError("Review CSV recovery count mismatch")
        temporary.replace(path)
        files.append({"file":str(path),"rows":count,"sha256":sha(path)})
    city=output/"city-summary.csv"
    with city.open("w",newline="",encoding="utf-8") as stream:
        out=csv.writer(stream);out.writerow(["published_locality_sample","candidate_review_clusters"])
        out.writerows((safe(value),count) for value,count in city_counts.most_common())
    files.append({"file":str(city),"rows":len(city_counts),"sha256":sha(city)})
    return {"review_lane":lane,"candidate_clusters":group_count,"source_observations_in_groups":total_observations,
        "emitted_observations":emitted,"view_cap_reached":capped,"ambiguity_flag_counts":dict(flag_counts),"output_files":files,
        "company_count_asserted":False,"merges_performed":0,"campaign_changes":0}


def prepare_context(db,provider,historical,lane):
    marker="contexts_prepared:"+lane
    if db.execute("SELECT 1 FROM metadata WHERE key=?",(marker,)).fetchone():
        return
    db.executescript("""CREATE TABLE IF NOT EXISTS name_context(lane TEXT,name_key TEXT,sites INTEGER,PRIMARY KEY(lane,name_key));
        CREATE TABLE IF NOT EXISTS site_context(lane TEXT,site_key TEXT,names INTEGER,PRIMARY KEY(lane,site_key));""")
    with db:
        db.execute("INSERT OR REPLACE INTO name_context SELECT ?,name_key,COUNT(DISTINCT site_key) FROM observations WHERE eligible=1 AND input_id IN (?,?) GROUP BY name_key",(lane,provider,historical))
        db.execute("INSERT OR REPLACE INTO site_context SELECT ?,site_key,COUNT(DISTINCT name_key) FROM observations WHERE eligible=1 AND input_id IN (?,?) GROUP BY site_key",(lane,provider,historical))
        db.execute("INSERT OR REPLACE INTO metadata VALUES(?,?)",(marker,"complete"))


def build_review(current,historical,output,*,next_release=None,max_groups=50000,max_members=200,max_total_members=250000,progress=None):
    if not 1<=max_groups<=50000 or not 1<=max_members<=500 or not 1<=max_total_members<=250000:
        raise ValueError("Explicit review export bounds required")
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    available=capacity(output)
    specs=[input_spec(current,"provider","current_first_release",1),input_spec(historical,"historical","historical_odbus_2023",2)]
    if next_release:specs.append(input_spec(next_release,"provider","next_release_staged",3))
    fingerprint=hashlib.sha256(json.dumps({"version":VERSION,"inputs":specs,"caps":[max_groups,max_members,max_total_members]},sort_keys=True).encode()).hexdigest()
    scratch=output/"observations.sqlite"
    if not scratch.exists() and scratch.with_suffix(".sqlite.gz").exists():
        raise RuntimeError("Derived scratch is losslessly archived; explicitly restore/verify it before rebuilding. Existing review outputs and frozen inputs remain intact.")
    if not scratch.exists():capacity(output)
    db=connect_scratch(scratch)
    try:
        prior=db.execute("SELECT value FROM metadata WHERE key='build_fingerprint'").fetchone()
        if prior and prior[0]!=fingerprint:raise ValueError("Input/version/cap fingerprint changed; preserve this review and select a new output folder")
        with db:db.execute("INSERT OR IGNORE INTO metadata VALUES('build_fingerprint',?)",(fingerprint,))
        units=load_units(db,specs[1])
        loaded=[load_input(db,spec,output,progress) for spec in specs]
        with db:
            db.execute("CREATE INDEX IF NOT EXISTS obs_match ON observations(eligible,name_key,address_key,city_key,input_id)")
        prepare_context(db,1,2,"first_release_auxiliary_only")
        lanes=[export_lane(db,output/"current-first-release",1,2,"first_release_auxiliary_only",max_groups=max_groups,max_members=max_members,max_total_members=max_total_members)]
        if next_release:
            prepare_context(db,3,2,"next_release_staged_auxiliary_only")
            lanes.append(export_lane(db,output/"next-release-staged",3,2,"next_release_staged_auxiliary_only",max_groups=max_groups,max_members=max_members,max_total_members=max_total_members))
        counts={"source_observations_in_scratch":db.execute("SELECT COUNT(*) FROM observations").fetchone()[0],
            "eligible_name_full_address_locality":db.execute("SELECT COUNT(*) FROM observations WHERE eligible=1").fetchone()[0],
            "held_missing_required_fields":db.execute("SELECT COUNT(*) FROM observations WHERE eligible=0").fetchone()[0]}
        report={"generated_at":datetime.now(timezone.utc).isoformat(),"version":VERSION,"build_fingerprint":fingerprint,
            "input_files":specs,"input_loading":loaded,"unit_provenance":units,"counts":counts,"review_lanes":lanes,
            "scratch_database":str(scratch),"caps":{"groups_per_lane":max_groups,"members_per_group":max_members,"total_members_per_lane":max_total_members},
            "storage_and_memory":{"minimum_preflight_free_bytes":2*1024**3,"observed_preflight_free_bytes":available,
                "sqlite_page_cache_kib":32768,"sqlite_temp_store":"FILE","python_ingest_batch_rows":1000},
            "normalisation":"Unicode NFKC, case folding, punctuation/whitespace token normalization. No street abbreviation, legal-suffix, locality-alias, fuzzy, unit-stripping or geographic inference.",
            "matching":"Exact normalized published name AND full address AND locality; shared name, domain or phone alone never matches.",
            "main_database_writes":0,"network_requests":0,"merges_performed":0,"campaign_changes":0,
            "limitations":["Review clusters are not verified companies, owners, franchises, current tenants or duplicate entities.",
                "Historical source files have varying older reference dates; publication/download dates do not certify present operation.",
                "Distinct units embedded in full addresses remain distinct keys; missing/contradictory separate units and postal codes remain explicit review flags.",
                "Shared-address names can occur at different historical times, not necessarily simultaneous occupancy.",
                "Strict keys intentionally omit spelling, street abbreviation, legal suffix and municipality alias variants.",
                "Current and staged next-release review lanes remain separate; no canonical data or frozen input is modified."]}
        (output/"manifest.json").write_text(json.dumps(report,indent=2)+"\n")
        return report
    finally:db.close()


def archive_scratch(output):
    """Archive only this completed derived DB after independent output QA."""
    output=Path(output)
    proof=json.loads((output/"actual-artifact-replay-proof.json").read_text())
    if not proof.get("passed") or not proof.get("output_hashes_identical"):
        raise ValueError("Completed output/count/hash QA required before archiving derived scratch")
    original=output/"observations.sqlite"
    destination=output/"observations.sqlite.gz"
    if original.is_symlink() or destination.is_symlink():
        raise ValueError("Refusing symlink derived scratch archives")
    if not original.exists():
        report=json.loads((output/"scratch-archive.json").read_text())
        if sha(destination)!=report["compressed_sha256"]:raise ValueError("Archived derived scratch hash differs")
        return {**report,"replayed":True}
    before=original.stat()
    original_hash=sha(original)
    temporary=destination.with_suffix(".gz.tmp")
    with original.open("rb") as source,temporary.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw,filename="",mode="wb",mtime=0,compresslevel=6) as handle:
            shutil.copyfileobj(source,handle,1024*1024)
        raw.flush();os.fsync(raw.fileno())
    recovered=hashlib.sha256();recovered_bytes=0
    with gzip.open(temporary,"rb") as stream:
        for block in iter(lambda:stream.read(1024*1024),b""):
            recovered.update(block);recovered_bytes+=len(block)
    after=original.stat()
    if recovered.hexdigest()!=original_hash or recovered_bytes!=before.st_size or (before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_ino,after.st_size,after.st_mtime_ns):
        raise ValueError("Derived scratch changed or failed whole-byte recovery; original preserved")
    temporary.replace(destination)
    report={"original_file":original.name,"original_bytes":before.st_size,"original_sha256":original_hash,
        "compressed_file":destination.name,"compressed_bytes":destination.stat().st_size,"compressed_sha256":sha(destination),
        "whole_decompressed_sha256_verified":True,"original_removed":True,
        "scope":"Self-owned completed derived review scratch only; all source raws/CSVs/manifests and review outputs retained."}
    (output/"scratch-archive.json").write_text(json.dumps(report,indent=2)+"\n")
    original.unlink()
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--current",type=Path,required=True);parser.add_argument("--historical",type=Path,required=True)
    parser.add_argument("--next-release",type=Path);parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    report=build_review(args.current,args.historical,args.output,next_release=args.next_release,progress=lambda value:print(json.dumps(value),flush=True))
    print(json.dumps({"counts":report["counts"],"lanes":[{key:lane[key] for key in ("review_lane","candidate_clusters","source_observations_in_groups","emitted_observations","view_cap_reached")} for lane in report["review_lanes"]]},indent=2))


if __name__=="__main__":main()
