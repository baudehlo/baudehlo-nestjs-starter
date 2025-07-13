-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "cube";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "earthdistance";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS deleted_record (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    data jsonb NOT NULL,
    deleted_at timestamptz NOT NULL DEFAULT current_timestamp,
    object_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT current_timestamp
);

CREATE OR REPLACE FUNCTION deleted_record_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
    BEGIN
        EXECUTE 'INSERT INTO deleted_record (data, object_id, table_name) VALUES ($1, $2, $3)'
        USING to_jsonb(OLD.*), OLD.id, TG_TABLE_NAME;

        RETURN OLD;
    END;
$$;

DO $$
DECLARE
    _sql varchar;
BEGIN
    FOR _sql in SELECT CONCAT (
        'CREATE OR REPLACE TRIGGER tg_',
        quote_ident(table_name),
        '_after_delete AFTER DELETE ON "${schema}".',
        quote_ident(table_name),
        ' FOR EACH ROW EXECUTE PROCEDURE "${schema}".deleted_record_insert ();'
    )
    FROM
        information_schema.tables
    WHERE
        table_schema = '${schema}'
    LOOP
        EXECUTE _sql;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION nanoid(
    prefix text DEFAULT null,
    size int DEFAULT 21
)
RETURNS text AS $$
DECLARE
id text := '';
    i int := 0;
    urlAlphabet char(64) := 'ModuleSymbhasOwnPr0123456789ABCDEFGHNRVabfgctiUvzKqYTJkLxpZXIjQW';
    bytes bytea := public.gen_random_bytes(size);
    byte int;
    pos int;
BEGIN
    WHILE i < size LOOP
    byte := get_byte(bytes, i);
    pos := (byte & 63) + 1; -- + 1 because substr starts at 1 for some reason
    id := id || substr(urlAlphabet, pos, 1);
    i = i + 1;
END LOOP;
IF prefix IS NULL THEN
    RETURN id;
ELSE
    RETURN CONCAT(LOWER(prefix), id);
END IF;
END
$$ LANGUAGE PLPGSQL VOLATILE;

CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL DEFAULT nanoid('tok'),
    "description" TEXT NOT NULL,
    "token" TEXT NOT NULL DEFAULT public.gen_random_uuid() || '-' || public.gen_random_uuid(),
    "expires" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_tokens_token_expires_idx" ON "api_tokens"("token", "expires");