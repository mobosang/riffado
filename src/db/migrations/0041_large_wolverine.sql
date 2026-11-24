CREATE TABLE "status_job_runs" (
	"job" varchar(40) PRIMARY KEY NOT NULL,
	"last_success_at" timestamp,
	"last_error_at" timestamp,
	"failing_since" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_minute_buckets" (
	"part" varchar(40) NOT NULL,
	"minute" timestamp NOT NULL,
	"ok" integer DEFAULT 0 NOT NULL,
	"err" integer DEFAULT 0 NOT NULL,
	"latency_buckets" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"verdict_ok" text,
	"verdict_slow" text,
	"verdict_down" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "status_minute_buckets_part_minute_pk" PRIMARY KEY("part","minute")
);
--> statement-breakpoint
CREATE TABLE "storage_deletion_queue" (
	"storage_key" text PRIMARY KEY NOT NULL,
	"source" varchar(40) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"claim_token" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plaud_connections" ADD COLUMN "refresh_token" text;--> statement-breakpoint
ALTER TABLE "plaud_connections" ADD COLUMN "access_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "plaud_connections" ADD COLUMN "session_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "speaker_diarization" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "diarization_speaker_count" integer;--> statement-breakpoint
CREATE INDEX "status_minute_buckets_minute_idx" ON "status_minute_buckets" USING btree ("minute");--> statement-breakpoint
CREATE INDEX "storage_deletion_queue_due_idx" ON "storage_deletion_queue" USING btree ("status","next_attempt_at");