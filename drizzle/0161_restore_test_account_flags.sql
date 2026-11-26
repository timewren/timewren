-- Same guarded block as 0160, kept so databases that recorded 0160 without the
-- column still get it back. When the column exists, saved flags are never
-- rewritten from the audit log; only the metadata marker below can raise one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organizations'
      AND column_name = 'is_test_account'
  ) THEN
    ALTER TABLE "organizations" ADD COLUMN "is_test_account" boolean DEFAULT false NOT NULL;

    IF to_regclass('public.admin_activity_logs') IS NOT NULL THEN
      WITH latest_flags AS (
        SELECT DISTINCT ON ("details"->>'organizationId')
          "details"->>'organizationId' AS organization_id,
          "details"->'testAccount' = 'true'::jsonb AS test_account
        FROM "admin_activity_logs"
        WHERE "action" = 'set_test_account_flag'
          AND jsonb_typeof("details"->'testAccount') = 'boolean'
        ORDER BY "details"->>'organizationId', "created_at" DESC, "id" DESC
      )
      UPDATE "organizations"
      SET "is_test_account" = latest_flags.test_account
      FROM latest_flags
      WHERE "organizations"."id" = latest_flags.organization_id;
    END IF;
  END IF;

  -- Databases that recorded 0160 before the flags were restored hold the column
  -- at its default. Saved flags are never lowered or rewritten: an unflagged
  -- organization is raised only when the older metadata marker still marks it
  -- AND its latest audit entry says test account. Metadata alone, or an audit
  -- entry alone (a deleted administrator can leave it stale), changes nothing.
  IF to_regclass('public.admin_activity_logs') IS NOT NULL THEN
    UPDATE "organizations"
    SET "is_test_account" = true
    WHERE NOT "is_test_account"
      AND ("metadata" #>> '{}') ~ '^\s*\{'
      AND (CASE WHEN jsonb_typeof("metadata") = 'string'
           THEN ("metadata" #>> '{}')::jsonb ELSE "metadata" END)
          @> '{"testAccount":true}'::jsonb
      AND coalesce((
        SELECT "details"->'testAccount' = 'true'::jsonb
        FROM "admin_activity_logs"
        WHERE "action" = 'set_test_account_flag'
          AND jsonb_typeof("details"->'testAccount') = 'boolean'
          AND "details"->>'organizationId' = "organizations"."id"
        ORDER BY "created_at" DESC, "id" DESC
        LIMIT 1
      ), false);
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "test_alunta_subscriptions" (
  "subscription_id" varchar(255) PRIMARY KEY
);
