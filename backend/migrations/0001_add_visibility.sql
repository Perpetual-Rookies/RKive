ALTER TABLE documents
ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'Org Level (Public)';
