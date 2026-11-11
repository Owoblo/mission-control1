-- Additive only: historical channels and identity recipes remain unchanged.
CREATE TABLE IF NOT EXISTS phone_channel_details (
 channel_id TEXT PRIMARY KEY REFERENCES contact_channels(id),
 raw_value TEXT NOT NULL, e164 TEXT NOT NULL, extension TEXT NOT NULL,
 format_status TEXT NOT NULL, normalizer_version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS phone_observations (
 id TEXT PRIMARY KEY, organisation_id TEXT NOT NULL REFERENCES organisations(id),
 evidence_id TEXT NOT NULL REFERENCES evidence(id), channel_id TEXT REFERENCES contact_channels(id),
 raw_value TEXT NOT NULL, extension TEXT NOT NULL, format_status TEXT NOT NULL,
 reason TEXT NOT NULL, normalizer_version TEXT NOT NULL, channel_kind TEXT NOT NULL
);
