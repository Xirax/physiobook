CREATE TYPE "public"."block_kind" AS ENUM('appointment', 'time_off');--> statement-breakpoint
CREATE TYPE "public"."block_status" AS ENUM('active', 'cancelled', 'cancelled_by_admin');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "appointments_blockId_unique" UNIQUE("block_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"kind" "block_kind" NOT NULL,
	"period" "tstzrange" NOT NULL,
	"status" "block_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_blocks_period_bounded" CHECK (NOT isempty("calendar_blocks"."period")
        AND NOT lower_inf("calendar_blocks"."period") AND NOT upper_inf("calendar_blocks"."period")
        AND lower_inc("calendar_blocks"."period") AND NOT upper_inc("calendar_blocks"."period")),
	CONSTRAINT "calendar_blocks_appointment_on_the_hour" CHECK ("calendar_blocks"."kind" <> 'appointment' OR (
        date_trunc('hour', lower("calendar_blocks"."period"), 'UTC') = lower("calendar_blocks"."period")
        AND upper("calendar_blocks"."period") = lower("calendar_blocks"."period") + interval '1 hour'
      ))
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_block_id_calendar_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."calendar_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_blocks" ADD CONSTRAINT "calendar_blocks_practitioner_id_users_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_user_id_idx" ON "appointments" USING btree ("user_id");