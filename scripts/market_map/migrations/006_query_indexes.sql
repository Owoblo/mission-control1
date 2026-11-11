-- Keep account/street lookups and provenance joins practical at city scale.
CREATE INDEX IF NOT EXISTS source_identity_organisation ON source_identities(organisation_id,location_id);
CREATE INDEX IF NOT EXISTS source_identity_location ON source_identities(location_id);
CREATE INDEX IF NOT EXISTS source_items_location ON source_run_items(location_id,run_id);
CREATE INDEX IF NOT EXISTS source_items_organisation ON source_run_items(organisation_id,run_id);
CREATE INDEX IF NOT EXISTS relationship_object ON relationships(object_id,predicate);
CREATE INDEX IF NOT EXISTS review_status_created ON review_queue(status,created_at);
CREATE INDEX IF NOT EXISTS domain_organisation ON domains(organisation_id);
