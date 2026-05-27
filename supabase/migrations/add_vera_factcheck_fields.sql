-- Migration: Add VERA fact-check status fields to ai_analyses
-- Idempotent: uses IF NOT EXISTS

ALTER TABLE public.ai_analyses
  ADD COLUMN IF NOT EXISTS fact_check_status TEXT NOT NULL DEFAULT 'pending_factcheck',
  ADD COLUMN IF NOT EXISTS fact_check_result JSONB,
  ADD COLUMN IF NOT EXISTS fact_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ai_analyses_fact_check_status
  ON public.ai_analyses(fact_check_status)
  WHERE fact_check_status = 'pending_factcheck';
