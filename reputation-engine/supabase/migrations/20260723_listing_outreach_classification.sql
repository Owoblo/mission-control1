-- Separate market intelligence from postcard eligibility. These fields retain
-- the classifier's actionable conclusion as well as its supporting evidence.
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS market_segment TEXT,
  ADD COLUMN IF NOT EXISTS listing_categories TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS occupancy_state TEXT,
  ADD COLUMN IF NOT EXISTS outreach_target TEXT,
  ADD COLUMN IF NOT EXISTS property_signals TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS classification_confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS classification_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS property_classified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS property_classification_method TEXT;
CREATE INDEX IF NOT EXISTS idx_listings_market_segment
  ON listings (market_segment);
CREATE INDEX IF NOT EXISTS idx_listings_outreach_target
  ON listings (outreach_target);
COMMENT ON COLUMN listings.market_segment IS
  'owner_occupied, investor_flip, student_housing, rental, new_construction, land_lot, or unknown';
COMMENT ON COLUMN listings.listing_categories IS
  'Multi-label categories; for example a listing can be both student_housing and rental';
COMMENT ON COLUMN listings.occupancy_state IS
  'furnished, partially_furnished, empty, construction, not_applicable, or unknown';
COMMENT ON COLUMN listings.outreach_target IS
  'homeowner, realtor, builder_developer, landlord_property_manager, leasing_agent, or unknown';
