CREATE TABLE IF NOT EXISTS sales_academy_progress (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  completed_lessons JSONB NOT NULL DEFAULT '[]'::jsonb,
  scenario_answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_version TEXT,
  last_opened_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_academy_progress_user_module
  ON sales_academy_progress (user_id, module_id);

CREATE INDEX IF NOT EXISTS idx_sales_academy_progress_user
  ON sales_academy_progress (user_id);

CREATE INDEX IF NOT EXISTS idx_sales_academy_progress_updated
  ON sales_academy_progress (updated_at DESC);

ALTER TABLE sales_academy_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_academy_progress_full_access" ON sales_academy_progress;
CREATE POLICY "sales_academy_progress_full_access"
  ON sales_academy_progress
  FOR ALL
  USING (true)
  WITH CHECK (true);

