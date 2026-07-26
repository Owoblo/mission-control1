CREATE TABLE IF NOT EXISTS public.inventory_dimension_catalog (
  normalized_name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  cubic_feet NUMERIC NOT NULL CHECK (cubic_feet > 0),
  weight_lbs NUMERIC NOT NULL CHECK (weight_lbs > 0),
  confidence TEXT NOT NULL DEFAULT 'medium'
    CHECK (confidence IN ('high', 'medium', 'low')),
  review_status TEXT NOT NULL DEFAULT 'suggested'
    CHECK (review_status IN ('suggested', 'approved', 'rejected')),
  source TEXT NOT NULL DEFAULT 'ai'
    CHECK (source IN ('ai', 'operator', 'customer_confirmed', 'measured')),
  observation_count INTEGER NOT NULL DEFAULT 1 CHECK (observation_count > 0),
  notes TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_dimension_catalog_review
  ON public.inventory_dimension_catalog (review_status, updated_at DESC);

ALTER TABLE public.inventory_dimension_catalog ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.inventory_dimension_catalog IS
  'Persistent item-dimension learning catalog. AI suggestions remain reviewable; approved/operator measurements take precedence.';
