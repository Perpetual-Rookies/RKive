CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"storage_path" text NOT NULL,
	"checksum" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"created_by" text
);

CREATE TABLE IF NOT EXISTS "ingestion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"started_at" timestamptz,
	"finished_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
