-- better-auth 1.7 finder adgangskode-kontoen med account."accountId" = user.id
-- (api/routes/sign-in: accounts.find(providerId === "credential" && accountId === user.id)).
-- 14 credential-rækker fra importen 14/4-2026 har accountId = e-mail og ville
-- ikke kunne logge ind. better-auth 1.6 slår op på userId alene, så rettelsen
-- virker også med den kode, der kører før deploy. Idempotent.
UPDATE "account"
SET "accountId" = "userId", "updatedAt" = now()
WHERE "providerId" = 'credential'
  AND "accountId" <> "userId";
