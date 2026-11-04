ALTER TABLE workspace_settings
ADD COLUMN IF NOT EXISTS background_effect text
CHECK (background_effect IS NULL OR background_effect = 'vignette-bloom');
