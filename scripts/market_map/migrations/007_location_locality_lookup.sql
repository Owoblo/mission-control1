-- Community-context reconciliation uses an exact searchable locality form.
CREATE INDEX IF NOT EXISTS location_city_normalized ON locations(city_normalized);
