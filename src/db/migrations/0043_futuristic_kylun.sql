CREATE TABLE "speaker_libraries" (
	"user_id" text PRIMARY KEY NOT NULL,
	"provider" text,
	"profiles" text
);
--> statement-breakpoint
ALTER TABLE "speaker_libraries" ADD CONSTRAINT "speaker_libraries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;