CREATE TABLE "db_properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"database_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "db_relations" (
	"property_id" uuid NOT NULL,
	"from_row" uuid NOT NULL,
	"to_row" uuid NOT NULL,
	"position" text DEFAULT 'a0' NOT NULL,
	CONSTRAINT "db_relations_property_id_from_row_to_row_pk" PRIMARY KEY("property_id","from_row","to_row")
);
--> statement-breakpoint
CREATE TABLE "db_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"database_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'table' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "props" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "db_properties" ADD CONSTRAINT "db_properties_database_id_pages_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_relations" ADD CONSTRAINT "db_relations_property_id_db_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."db_properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_relations" ADD CONSTRAINT "db_relations_from_row_pages_id_fk" FOREIGN KEY ("from_row") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_relations" ADD CONSTRAINT "db_relations_to_row_pages_id_fk" FOREIGN KEY ("to_row") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "db_views" ADD CONSTRAINT "db_views_database_id_pages_id_fk" FOREIGN KEY ("database_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "db_properties_database_idx" ON "db_properties" USING btree ("database_id");--> statement-breakpoint
CREATE INDEX "db_relations_from_idx" ON "db_relations" USING btree ("from_row");--> statement-breakpoint
CREATE INDEX "db_views_database_idx" ON "db_views" USING btree ("database_id");