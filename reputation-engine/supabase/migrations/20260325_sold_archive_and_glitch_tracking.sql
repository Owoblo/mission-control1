-- Sold archive: stores listings after sold postcards have been sent
-- Prevents duplicate sold sends and enables glitch detection
CREATE TABLE IF NOT EXISTS sold_archive (
  zpid bigint PRIMARY KEY,
  addressstreet text,
  addresscity text,
  city text,
  addressstate text,
  addresszipcode text,
  unformattedprice numeric,
  status text,
  region text,
  first_seen_at timestamptz,
  lastseenat timestamptz,
  is_furnished boolean,
  furniture_confidence numeric,
  archived_at timestamptz DEFAULT now()
);
-- Glitch flag: listing reappeared on Zillow after already being archived as sold
ALTER TABLE listings ADD COLUMN IF NOT EXISTS glitch_suspected boolean DEFAULT false;
-- Photo retry counter: tracks how many times we tried fetching photos for a just_listed with 1 photo
ALTER TABLE listings ADD COLUMN IF NOT EXISTS photo_fetch_attempts smallint DEFAULT 0;
