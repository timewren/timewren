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
