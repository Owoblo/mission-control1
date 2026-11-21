-- Create city_populations table for dynamic pricing calculation
CREATE TABLE IF NOT EXISTS city_populations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_name TEXT NOT NULL,
  state_province TEXT NOT NULL,
  state_province_code TEXT NOT NULL,
  country TEXT NOT NULL,
  country_code TEXT NOT NULL,
  population INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(city_name, state_province_code, country_code)
);
-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_city_populations_lookup ON city_populations(city_name, country_code);
CREATE INDEX IF NOT EXISTS idx_city_populations_country ON city_populations(country_code);
CREATE INDEX IF NOT EXISTS idx_city_populations_state ON city_populations(state_province_code);
-- Add calculated pricing columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS calculated_monthly_price DECIMAL(10,2);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS selected_tier TEXT DEFAULT 'basic';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS price_calculated_at TIMESTAMPTZ;
-- Seed Canadian cities with population data
INSERT INTO city_populations (city_name, state_province, state_province_code, country, country_code, population) VALUES
-- Ontario
('Toronto', 'Ontario', 'ON', 'Canada', 'CA', 2930000),
('Hamilton', 'Ontario', 'ON', 'Canada', 'CA', 536917),
('London', 'Ontario', 'ON', 'Canada', 'CA', 383822),
('Kitchener-Waterloo', 'Ontario', 'ON', 'Canada', 'CA', 470015),
('Ottawa', 'Ontario', 'ON', 'Canada', 'CA', 1017449),
('Windsor', 'Ontario', 'ON', 'Canada', 'CA', 229660),
-- Alberta
('Calgary', 'Alberta', 'AB', 'Canada', 'CA', 1306784),
('Edmonton', 'Alberta', 'AB', 'Canada', 'CA', 1017449),
-- British Columbia
('Vancouver', 'British Columbia', 'BC', 'Canada', 'CA', 675218),
('Victoria', 'British Columbia', 'BC', 'Canada', 'CA', 92000),
-- Quebec
('Montreal', 'Quebec', 'QC', 'Canada', 'CA', 1780000),
('Quebec City', 'Quebec', 'QC', 'Canada', 'CA', 549459),
-- Manitoba
('Winnipeg', 'Manitoba', 'MB', 'Canada', 'CA', 705244),
-- Nova Scotia
('Halifax', 'Nova Scotia', 'NS', 'Canada', 'CA', 403131),
-- Saskatchewan
('Saskatoon', 'Saskatchewan', 'SK', 'Canada', 'CA', 295095),
('Regina', 'Saskatchewan', 'SK', 'Canada', 'CA', 215106),
-- Newfoundland and Labrador
('St. John''s', 'Newfoundland and Labrador', 'NL', 'Canada', 'CA', 108860)
ON CONFLICT (city_name, state_province_code, country_code) DO UPDATE SET
  population = EXCLUDED.population,
  updated_at = NOW();
-- Enable RLS
ALTER TABLE city_populations ENABLE ROW LEVEL SECURITY;
-- Allow read access to all authenticated users
CREATE POLICY "Allow read access to city populations"
  ON city_populations
  FOR SELECT
  TO authenticated
  USING (true);
-- Allow public read access for pricing display
CREATE POLICY "Allow public read access to city populations"
  ON city_populations
  FOR SELECT
  TO anon
  USING (true);
