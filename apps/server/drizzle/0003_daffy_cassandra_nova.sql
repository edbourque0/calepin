ALTER TABLE "pages" drop column "search";--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('calepin'::regconfig, coalesce("title", '')), 'A') || setweight(to_tsvector('calepin'::regconfig, coalesce("content_text", '')), 'B')) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pages_search_idx" ON "pages" USING gin ("search");
