ALTER TABLE messages
ADD COLUMN IF NOT EXISTS citations jsonb DEFAULT '[]'::jsonb;
