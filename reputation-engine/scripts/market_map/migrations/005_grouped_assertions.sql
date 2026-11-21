-- Preserve the public field-level assertion contract while sharing immutable
-- entity/evidence metadata across a source observation's fields.
-- Existing rows remain intact; JSON1 is required for the compatibility view.
PRAGMA legacy_alter_table=ON;
ALTER TABLE field_assertions RENAME TO field_assertions_rows;
PRAGMA legacy_alter_table=OFF;

CREATE TABLE field_assertion_groups (
 id TEXT PRIMARY KEY,
 entity_id TEXT NOT NULL, entity_type TEXT NOT NULL,
 evidence_id TEXT NOT NULL REFERENCES evidence(id), observed_at TEXT NOT NULL,
 valid_from TEXT, valid_to TEXT, method TEXT NOT NULL DEFAULT 'source_assertion',
 confidence REAL, review_status TEXT NOT NULL DEFAULT 'unverified',
 fields_json TEXT NOT NULL CHECK(json_valid(fields_json))
);
CREATE INDEX assertion_group_lineage ON field_assertion_groups(entity_id,evidence_id);

CREATE VIEW field_assertions AS
 SELECT id,entity_id,entity_type,field_name,value_json,evidence_id,observed_at,
        valid_from,valid_to,method,confidence,review_status
 FROM field_assertions_rows
 UNION ALL
 SELECT json_extract(f.value,'$.id') AS id,g.entity_id,g.entity_type,
        f.key AS field_name,json_extract(f.value,'$.value_json') AS value_json,
        g.evidence_id,g.observed_at,g.valid_from,g.valid_to,g.method,g.confidence,g.review_status
 FROM field_assertion_groups g,json_each(g.fields_json) f
 WHERE NOT EXISTS (
  SELECT 1 FROM field_assertions_rows r WHERE r.id=json_extract(f.value,'$.id')
 );

-- Bulk consumers which only need provenance should not expand each JSON field.
CREATE VIEW field_assertion_lineage AS
 SELECT entity_id,entity_type,evidence_id,observed_at,valid_from,valid_to,method,confidence,review_status
 FROM field_assertions_rows
 UNION ALL
 SELECT entity_id,entity_type,evidence_id,observed_at,valid_from,valid_to,method,confidence,review_status
 FROM field_assertion_groups;

-- The normal standalone helper remains immediately visible and enforces the
-- legacy table's constraints. Generated IDs encode entity, field, value and
-- evidence, so a matching grouped ID is checked within its indexed lineage.
CREATE TRIGGER field_assertions_insert INSTEAD OF INSERT ON field_assertions
BEGIN
 INSERT OR IGNORE INTO field_assertions_rows(
  id,entity_id,entity_type,field_name,value_json,evidence_id,observed_at,
  valid_from,valid_to,method,confidence,review_status)
 SELECT NEW.id,NEW.entity_id,NEW.entity_type,NEW.field_name,NEW.value_json,
  NEW.evidence_id,NEW.observed_at,NEW.valid_from,NEW.valid_to,
  COALESCE(NEW.method,'source_assertion'),NEW.confidence,COALESCE(NEW.review_status,'unverified')
 WHERE NOT EXISTS (
  SELECT 1 FROM field_assertion_groups g,json_each(g.fields_json) f
  WHERE g.entity_id=NEW.entity_id AND g.entity_type=NEW.entity_type
   AND g.evidence_id=NEW.evidence_id AND json_extract(f.value,'$.id')=NEW.id
 );
END;
