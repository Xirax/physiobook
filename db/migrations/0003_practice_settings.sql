CREATE TABLE "practice_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"timezone" text NOT NULL,
	"slot_duration_minutes" integer DEFAULT 60 NOT NULL,
	"reminder_lead_hours" integer DEFAULT 24 NOT NULL,
	"cancellation_cutoff_hours" integer DEFAULT 24 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_settings_singleton" CHECK ("practice_settings"."id" = 1)
);
