-- Local commercial discovery store. Keep IDs and evidence portable to PostgreSQL.
CREATE TABLE IF NOT EXISTS geographies (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'unknown',
 parent_id TEXT REFERENCES geographies(id), province TEXT DEFAULT 'ON', country TEXT DEFAULT 'CA',
 official_id TEXT, discovery_status TEXT NOT NULL DEFAULT 'not_searched', notes TEXT
);
CREATE TABLE IF NOT EXISTS geography_aliases (
 id TEXT PRIMARY KEY, geography_id TEXT NOT NULL REFERENCES geographies(id), alias TEXT NOT NULL,
 alias_normalized TEXT NOT NULL, source TEXT, UNIQUE(geography_id,alias_normalized)
);
CREATE INDEX IF NOT EXISTS geography_alias_lookup ON geography_aliases(alias_normalized);
CREATE TABLE IF NOT EXISTS sources (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, publisher TEXT, source_url TEXT NOT NULL,
 source_type TEXT DEFAULT 'unknown', geography_scope TEXT DEFAULT '[]', sector_scope TEXT DEFAULT '[]',
 access_method TEXT DEFAULT 'manual_import', retrieval_status TEXT DEFAULT 'discovered',
 rights_status TEXT DEFAULT 'unreviewed', terms_url TEXT, robots_checked_at TEXT,
 cost_model TEXT DEFAULT 'free', pagination_method TEXT, reported_count INTEGER, count_definition TEXT,
 source_date TEXT, last_checked_at TEXT, last_success_at TEXT, refresh_interval INTEGER DEFAULT 90,
 adapter_name TEXT, notes TEXT, config_json TEXT DEFAULT '{}', publisher_origin TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_runs (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), started_at TEXT NOT NULL,
 completed_at TEXT, status TEXT NOT NULL, cursor_checkpoint TEXT,
 fetched_count INTEGER NOT NULL DEFAULT 0, parsed_count INTEGER NOT NULL DEFAULT 0,
 candidate_count INTEGER NOT NULL DEFAULT 0, inserted_count INTEGER NOT NULL DEFAULT 0,
 updated_count INTEGER NOT NULL DEFAULT 0, duplicate_count INTEGER NOT NULL DEFAULT 0,
 quarantined_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0,
 bytes_fetched INTEGER NOT NULL DEFAULT 0, estimated_cost REAL NOT NULL DEFAULT 0 CHECK(estimated_cost>=0),
 requests INTEGER NOT NULL DEFAULT 0, browser_pages INTEGER NOT NULL DEFAULT 0,
 token_count INTEGER NOT NULL DEFAULT 0, model_tokens INTEGER NOT NULL DEFAULT 0,
 elapsed_seconds REAL, runtime_seconds REAL,
 coverage_complete INTEGER NOT NULL DEFAULT 0, expected_count INTEGER, adapter_name TEXT,
 parser_version TEXT, fingerprint TEXT, metadata_json TEXT NOT NULL DEFAULT '{}',
 result_json TEXT NOT NULL DEFAULT '{}', error_message TEXT
);
CREATE INDEX IF NOT EXISTS source_run_lookup ON source_runs(source_id,started_at);
CREATE TABLE IF NOT EXISTS raw_records (
 id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id),
 run_id TEXT NOT NULL REFERENCES source_runs(id), source_record_id TEXT,
 source_page_url TEXT, fetched_at TEXT NOT NULL, source_published_at TEXT,
 payload_hash TEXT NOT NULL, original_payload_reference TEXT NOT NULL,
 parser_version TEXT, payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS raw_record_source ON raw_records(source_id,source_record_id);
CREATE TABLE IF NOT EXISTS evidence (
 id TEXT PRIMARY KEY, source_url TEXT NOT NULL, fetched_at TEXT NOT NULL,
 short_supporting_excerpt TEXT, content_hash TEXT NOT NULL, source_date TEXT,
 raw_record_id TEXT REFERENCES raw_records(id)
);
CREATE TABLE IF NOT EXISTS organisations (
 id TEXT PRIMARY KEY, legal_name TEXT, trading_name TEXT NOT NULL, description TEXT,
 status TEXT NOT NULL DEFAULT 'provisional', entity_type TEXT NOT NULL DEFAULT 'company',
 organisation_size_band TEXT, size_evidence TEXT, primary_domain TEXT, country TEXT DEFAULT 'CA',
 first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
 name_normalized TEXT NOT NULL, registration_id TEXT, registration_jurisdiction TEXT,
 manually_verified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS organisation_name ON organisations(name_normalized);
CREATE INDEX IF NOT EXISTS organisation_registration ON organisations(registration_jurisdiction,registration_id);
CREATE TABLE IF NOT EXISTS organisation_aliases (
 id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), alias TEXT NOT NULL,
 alias_type TEXT NOT NULL DEFAULT 'source_name', evidence_id TEXT REFERENCES evidence(id),
 UNIQUE(organisation_id,alias,alias_type,evidence_id)
);
CREATE TABLE IF NOT EXISTS locations (
 id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id), location_name TEXT,
 location_type TEXT NOT NULL DEFAULT 'unknown', address_raw TEXT, street TEXT, unit TEXT,
 city_raw TEXT, municipality_id TEXT REFERENCES geographies(id), region TEXT, province TEXT DEFAULT 'ON',
 postal_code TEXT, country TEXT DEFAULT 'CA', latitude REAL, longitude REAL, coordinates_source TEXT,
 status TEXT NOT NULL DEFAULT 'provisional', first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
 address_normalized TEXT, city_normalized TEXT, manually_verified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS location_identity ON locations(address_normalized,city_normalized);
CREATE INDEX IF NOT EXISTS location_geography ON locations(municipality_id);
CREATE INDEX IF NOT EXISTS location_organisation ON locations(organisation_id);
CREATE TABLE IF NOT EXISTS properties (
 id TEXT PRIMARY KEY, property_name TEXT, address TEXT,
 municipality_id TEXT REFERENCES geographies(id), property_type TEXT DEFAULT 'unknown'
);
CREATE TABLE IF NOT EXISTS domains (
 id TEXT PRIMARY KEY, domain TEXT NOT NULL, organisation_id TEXT NOT NULL REFERENCES organisations(id),
 relationship_to_organisation TEXT NOT NULL DEFAULT 'source_reported', evidence_id TEXT REFERENCES evidence(id)
);
CREATE INDEX IF NOT EXISTS domain_lookup ON domains(domain);
CREATE TABLE IF NOT EXISTS relationships (
 id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, subject_type TEXT NOT NULL, predicate TEXT NOT NULL,
 object_id TEXT NOT NULL, object_type TEXT NOT NULL, asserted_by_source_id TEXT REFERENCES sources(id),
 evidence_id TEXT NOT NULL REFERENCES evidence(id), confidence REAL CHECK(confidence BETWEEN 0 AND 1),
 observed_at TEXT NOT NULL, valid_from TEXT, valid_to TEXT, review_status TEXT NOT NULL DEFAULT 'unverified'
);
CREATE INDEX IF NOT EXISTS relationship_subject ON relationships(subject_id,predicate);
CREATE TABLE IF NOT EXISTS classifications (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, entity_type TEXT NOT NULL, taxonomy TEXT NOT NULL,
 category TEXT NOT NULL, classification_method TEXT NOT NULL DEFAULT 'source_assertion',
 confidence REAL CHECK(confidence BETWEEN 0 AND 1), evidence_id TEXT NOT NULL REFERENCES evidence(id),
 review_status TEXT NOT NULL DEFAULT 'unverified'
);
CREATE INDEX IF NOT EXISTS classification_lookup ON classifications(entity_id,taxonomy,category);
CREATE TABLE IF NOT EXISTS contact_channels (
 id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
 location_id TEXT REFERENCES locations(id), channel_type TEXT NOT NULL, value TEXT NOT NULL,
 published_context TEXT, source_url TEXT NOT NULL, observed_at TEXT NOT NULL,
 verification_status TEXT NOT NULL DEFAULT 'source_reported',
 outreach_eligibility TEXT NOT NULL DEFAULT 'research_only', suppression_status TEXT NOT NULL DEFAULT 'unknown',
 evidence_id TEXT NOT NULL REFERENCES evidence(id)
);
CREATE INDEX IF NOT EXISTS contact_channel_lookup ON contact_channels(channel_type,value);
CREATE TABLE IF NOT EXISTS people (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, employer_organisation_id TEXT REFERENCES organisations(id),
 role_title TEXT, role_function TEXT, authority_scope TEXT DEFAULT 'unknown', source_url TEXT,
 observed_at TEXT, verification_status TEXT NOT NULL DEFAULT 'unverified'
);
CREATE TABLE IF NOT EXISTS purchasing_routes (
 id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
 location_id TEXT REFERENCES locations(id), service_tag TEXT DEFAULT 'unknown', route_type TEXT NOT NULL,
 department TEXT, portal_url TEXT, procurement_contact_id TEXT REFERENCES people(id), onboarding_notes TEXT,
 verified_at TEXT, evidence_id TEXT NOT NULL REFERENCES evidence(id), confidence REAL CHECK(confidence BETWEEN 0 AND 1)
);
CREATE TABLE IF NOT EXISTS discovery_queue (
 id TEXT PRIMARY KEY, target_url_or_query TEXT NOT NULL, task_type TEXT NOT NULL,
 discovered_from_entity_id TEXT, discovered_from_evidence_id TEXT REFERENCES evidence(id),
 traversal_depth INTEGER NOT NULL DEFAULT 0, priority REAL NOT NULL DEFAULT 50,
 status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT, dedupe_key TEXT NOT NULL UNIQUE, lease_token TEXT, lease_until TEXT,
 last_error TEXT, domain TEXT, wave INTEGER NOT NULL DEFAULT 1, wave_id TEXT,
 metadata_json TEXT NOT NULL DEFAULT '{}', payload_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS discovery_pending ON discovery_queue(status,next_attempt_at,priority);
CREATE TABLE IF NOT EXISTS coverage_cells (
 geography_id TEXT NOT NULL REFERENCES geographies(id), sector_id TEXT NOT NULL, source_lane TEXT NOT NULL,
 search_status TEXT NOT NULL DEFAULT 'not_searched', source_count INTEGER NOT NULL DEFAULT 0,
 unique_organisations INTEGER NOT NULL DEFAULT 0, unique_locations INTEGER NOT NULL DEFAULT 0,
 benchmark_count INTEGER, benchmark_definition TEXT, benchmark_date TEXT,
 comparability_notes TEXT, last_reviewed_at TEXT,
 PRIMARY KEY(geography_id,sector_id,source_lane)
);
CREATE TABLE IF NOT EXISTS review_queue (
 id TEXT PRIMARY KEY, issue_type TEXT NOT NULL, candidate_ids TEXT NOT NULL DEFAULT '[]',
 evidence_ids TEXT NOT NULL DEFAULT '[]', reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
 resolution TEXT, created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS field_assertions (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, entity_type TEXT NOT NULL, field_name TEXT NOT NULL,
 value_json TEXT NOT NULL, evidence_id TEXT NOT NULL REFERENCES evidence(id), observed_at TEXT NOT NULL,
 valid_from TEXT, valid_to TEXT, method TEXT NOT NULL DEFAULT 'source_assertion',
 confidence REAL, review_status TEXT NOT NULL DEFAULT 'unverified'
);
CREATE INDEX IF NOT EXISTS assertion_entity ON field_assertions(entity_id,field_name);
CREATE TABLE IF NOT EXISTS source_identities (
 source_id TEXT NOT NULL REFERENCES sources(id), source_record_id TEXT NOT NULL,
 organisation_id TEXT NOT NULL REFERENCES organisations(id), location_id TEXT REFERENCES locations(id),
 identity_json TEXT NOT NULL, first_evidence_id TEXT NOT NULL REFERENCES evidence(id),
 last_evidence_id TEXT NOT NULL REFERENCES evidence(id), PRIMARY KEY(source_id,source_record_id)
);
CREATE TABLE IF NOT EXISTS external_ids (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, entity_type TEXT NOT NULL,
 namespace TEXT NOT NULL, external_id TEXT NOT NULL, evidence_id TEXT REFERENCES evidence(id),
 UNIQUE(entity_type,namespace,external_id)
);
CREATE TABLE IF NOT EXISTS identity_audit (
 id TEXT PRIMARY KEY, action TEXT NOT NULL, entity_id TEXT NOT NULL, related_entity_id TEXT,
 evidence_id TEXT REFERENCES evidence(id), reason TEXT NOT NULL, before_json TEXT,
 after_json TEXT, observed_at TEXT NOT NULL, reversed_at TEXT, reversal_reason TEXT
);
CREATE TABLE IF NOT EXISTS source_run_items (
 run_id TEXT NOT NULL REFERENCES source_runs(id), source_record_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL, raw_record_id TEXT NOT NULL REFERENCES raw_records(id),
 organisation_id TEXT REFERENCES organisations(id), location_id TEXT REFERENCES locations(id),
 outcome TEXT NOT NULL, PRIMARY KEY(run_id,source_record_id,payload_hash)
);
