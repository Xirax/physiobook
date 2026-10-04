CREATE TABLE "business_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day_of_week" smallint NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	CONSTRAINT "business_hours_day_of_week" CHECK ("business_hours"."day_of_week" BETWEEN 0 AND 6),
	CONSTRAINT "business_hours_closes_after_opens" CHECK ("business_hours"."closes_at" > "business_hours"."opens_at")
);
