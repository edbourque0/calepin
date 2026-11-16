-- Accent-insensitive search: "ete" finds "Été".
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'calepin') THEN
    CREATE TEXT SEARCH CONFIGURATION calepin (COPY = simple);
    ALTER TEXT SEARCH CONFIGURATION calepin ALTER MAPPING FOR hword, hword_part, word WITH unaccent, simple;
  END IF;
END $$;
