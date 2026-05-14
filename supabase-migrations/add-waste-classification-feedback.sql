-- Migration: create waste_classification_feedback table for human feedback loop
-- This migration is idempotent.

CREATE TABLE IF NOT EXISTS public.waste_classification_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    platform TEXT NOT NULL,
    app_version TEXT,
    model_version TEXT NOT NULL,
    predicted_label_key TEXT NOT NULL,
    predicted_confidence DOUBLE PRECISION NOT NULL,
    predicted_scores JSONB,
    is_correct BOOLEAN NOT NULL,
    correct_label_key TEXT,
    consent_image_upload BOOLEAN NOT NULL DEFAULT FALSE,
    image_path TEXT,
    image_sha256 TEXT,
    CHECK (predicted_label_key IN ('cardboard', 'glass', 'metal', 'paper', 'plastic', 'trash')),
    CHECK (correct_label_key IS NULL OR correct_label_key IN ('cardboard', 'glass', 'metal', 'paper', 'plastic', 'trash'))
);

CREATE INDEX IF NOT EXISTS idx_waste_feedback_user_created
    ON public.waste_classification_feedback (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_waste_feedback_model_version
    ON public.waste_classification_feedback (model_version);

CREATE INDEX IF NOT EXISTS idx_waste_feedback_predicted_label
    ON public.waste_classification_feedback (predicted_label_key);

CREATE INDEX IF NOT EXISTS idx_waste_feedback_is_correct
    ON public.waste_classification_feedback (is_correct);

ALTER TABLE public.waste_classification_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own waste feedback" ON public.waste_classification_feedback;
CREATE POLICY "Users can insert own waste feedback" ON public.waste_classification_feedback
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can view own waste feedback" ON public.waste_classification_feedback;
CREATE POLICY "Users can view own waste feedback" ON public.waste_classification_feedback
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());
