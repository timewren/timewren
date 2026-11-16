import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { authenticateDevice } from "@/lib/desktop-auth";
import { getDesktopMembership, isOrgAdminRole } from "@/lib/desktop-org";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/desktop-rate-limit";
import {
  decryptSecretOrNull,
  encryptSecretOrNull,
  SECRET_PREFIX,
} from "@/lib/utils/encryption";

// Ruten læser brugertokens og svarer med API-nøgler. Aldrig statisk/prerenderet,
// og aldrig i et cache-lag på vejen.
export const dynamic = "force-dynamic";

/**
 * Nøglen i klartekst til enheden. Skrivevejene krypterer (enc:v1, #690);
 * `decryptSecret` tåler også ældre krypterede rækker og klartekst fra før
 * backfill. Kan en krypteret værdi ikke dekrypteres (fx skiftet
 * ENCRYPTION_KEY), svares der `null` — ciphertext sendes aldrig ud som nøgle,
 * og én ulæselig nøgle må ikke gøre resten af indstillingerne ulæselige.
 */
function reveal(value: string | null): string | null {
  try {
    const plain = decryptSecretOrNull(value);
    return plain === "" ? null : plain;
  } catch {
    return null;
  }
}

/**
 * Device-tokenets bruger, eller `null` når tokenet mangler, er udløbet eller
 * ikke er underskrevet af os. `authenticateDevice` kaster i alle tre tilfælde,
 * og en kaster/token-fejl må aldrig blive en 500 — appen kan ikke gøre noget
 * ved en fejlkode den ikke kender.
 */
async function authenticatedUserId(request: Request): Promise<string | null> {
  try {
    return (await authenticateDevice(request)).userId;
  } catch {
    return null;
  }
}

async function unauthorized() {
  return NextResponse.json(
    { error: await tr("serverErrors", "api.desktop.invalidDeviceToken") },
    { status: 401 },
  );
}

/**
 * GET /api/desktop/settings
 *
 * Header: Authorization: Bearer <device-token>
 * Query: organizationId (valgfri) — skal være den organisation enheden arbejder i
 *
 * Svarer med den *tokens egen bruger*s integrationsindstillinger: Billy-,
 * Dinero- og e-conomic-nøgler, de mappings og standard-konti appen skal bruge
 * til at oprette fakturalinjer, samt linjetemplates.
 *
 * Nøglerne ligger pr. bruger, ikke pr. organisation, så svaret er udelukkende
 * den kalderes egne — en organisation har ingen fælles nøglelager at læse fra,
 * og en kollega skal aldrig kunne hente en andens integrationsnøgle gennem
 * sin egen enhed.
 */
export async function GET(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`desktop-settings:${ip}`, 60, 60_000))) {
    return rateLimitResponse();
  }

  // Ethvert auth-problem er en 401 — en ugyldig signatur er ikke en 500.
  const userId = await authenticatedUserId(request);
  if (!userId) return unauthorized();

  try {
    const membership = await getDesktopMembership(userId);
    const orgId = membership?.organizationId ?? null;

    // Appen må pege på den org enheden arbejder i. Alt andet er en fremmed org —
    // selv om brugeren tilfældigvis også er medlem af den — fordi synken kun
    // dækker den ene.
    const requested = new URL(request.url).searchParams.get("organizationId");
    if (requested && requested !== orgId) {
      return NextResponse.json(
        { error: await tr("serverErrors", "common.notOrgMemberShort") },
        { status: 403 },
      );
    }

    const row = await db
      .select({
        billyApiKey: users.billyApiKey,
        billyOrganizationId: users.billyOrganizationId,
        billyDefaultAccountId: users.billyDefaultAccountId,
        billyDefaultProductId: users.billyDefaultProductId,
        billyKlippekortProductId: users.billyKlippekortProductId,
        billyLineType: users.billyLineType,
        billyLineTemplate: users.billyLineTemplate,
        dineroApiKey: users.dineroApiKey,
        dineroOrganizationId: users.dineroOrganizationId,
        dineroOrgName: users.dineroOrgName,
        dineroRefreshToken: users.dineroRefreshToken,
        dineroTokenExpiry: users.dineroTokenExpiry,
        dineroDefaultAccountNumber: users.dineroDefaultAccountNumber,
        dineroProductGuidTime: users.dineroProductGuidTime,
        dineroProductGuidKlippekort: users.dineroProductGuidKlippekort,
        dineroLineType: users.dineroLineType,
        dineroLineTemplate: users.dineroLineTemplate,
        economicAppSecretToken: users.economicAppSecretToken,
        economicAgreementGrantToken: users.economicAgreementGrantToken,
        economicDefaultLayoutNumber: users.economicDefaultLayoutNumber,
        economicDefaultProductNumber: users.economicDefaultProductNumber,
        economicKlippekortProductNumber: users.economicKlippekortProductNumber,
        economicDefaultPaymentTermsNumber:
          users.economicDefaultPaymentTermsNumber,
        economicLineType: users.economicLineType,
        economicLineTemplate: users.economicLineTemplate,
        timeopsApiKey: users.timeopsApiKey,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const settings = row[0];
    if (!settings) {
      return NextResponse.json(
        { error: await tr("serverErrors", "api.desktop.userNotFound") },
        { status: 404 },
      );
    }

    // `dineroRefreshToken` er et OAuth-refresh-token: det bruges af serverens
    // egen Dinero-klient og skal ikke stå i et svar til en enhed. Appen får
    // i stedet de to felter den skal vise brugeren.
    const body = {
      organizationId: orgId,
      role: membership?.role ?? null,
      settings: {
        billy: {
          apiKey: reveal(settings.billyApiKey),
          organizationId: settings.billyOrganizationId,
          defaultAccountId: settings.billyDefaultAccountId,
          defaultProductId: settings.billyDefaultProductId,
          klippekortProductId: settings.billyKlippekortProductId,
          lineType: settings.billyLineType,
          lineTemplate: settings.billyLineTemplate,
        },
        dinero: {
          apiKey: reveal(settings.dineroApiKey),
          organizationId: settings.dineroOrganizationId,
          orgName: settings.dineroOrgName,
          isOAuth: !!settings.dineroRefreshToken,
          tokenExpired: !!(
            settings.dineroRefreshToken &&
            settings.dineroTokenExpiry &&
            settings.dineroTokenExpiry < new Date()
          ),
          defaultAccountNumber: settings.dineroDefaultAccountNumber,
          productGuidTime: settings.dineroProductGuidTime,
          productGuidKlippekort: settings.dineroProductGuidKlippekort,
          lineType: settings.dineroLineType,
          lineTemplate: settings.dineroLineTemplate,
        },
        economic: {
          appSecretToken: reveal(settings.economicAppSecretToken),
          agreementGrantToken: reveal(settings.economicAgreementGrantToken),
          defaultLayoutNumber: settings.economicDefaultLayoutNumber,
          defaultProductNumber: settings.economicDefaultProductNumber,
          klippekortProductNumber: settings.economicKlippekortProductNumber,
          defaultPaymentTermsNumber: settings.economicDefaultPaymentTermsNumber,
          lineType: settings.economicLineType,
          lineTemplate: settings.economicLineTemplate,
        },
        timeops: { apiKey: reveal(settings.timeopsApiKey) },
      },
      serverTime: new Date().toISOString(),
    };

    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    // Nøglen fra en PUT-body må ikke havne i loggen.
    console.error(
      "[Desktop Settings] Læsning fejlede:",
      error instanceof Error ? error.message : "ukendt fejl",
    );
    return NextResponse.json(
      { error: await tr("serverErrors", "api.desktop.settingsReadFailed") },
      { status: 500 },
    );
  }
}

/**
 * Kun credentials er skrivbare herfra. Mappings, standard-konti og templates
 * redigeres i webens integrationsside, og en enhed skal ikke kunne bumpe dem
 * ved en fejlhæftig round-trip.
 */
// En nøgle skal komme i klartekst: GET svarer dekrypteret, så en allerede
// krypteret værdi tilbage ind er en klientfejl — afvis den som 400 i stedet for
// at dobbeltkryptere den.
const secretField = z
  .string()
  .max(500)
  .refine((value) => !value.startsWith(SECRET_PREFIX))
  .nullish();

const settingsWriteSchema = z.object({
  billyApiKey: secretField,
  billyOrganizationId: z.string().max(255).nullish(),
  dineroApiKey: secretField,
  dineroOrganizationId: z.string().max(255).nullish(),
  economicAppSecretToken: secretField,
  economicAgreementGrantToken: secretField,
  timeopsApiKey: secretField,
});

/** Felterne der er hemmeligheder og derfor krypteres at rest. */
const SECRET_FIELDS = new Set([
  "billyApiKey",
  "dineroApiKey",
  "economicAppSecretToken",
  "economicAgreementGrantToken",
  "timeopsApiKey",
]);

/**
 * PUT /api/desktop/settings
 *
 * Gemmer integrationscredentials for den kaldendes egen bruger. Kun medlemmer
 * med rollen owner/admin i den organisation enheden arbejder i må skrive — en
 * almindelig medarbejder skal kunne læse opsætningen, men ikke skifte
 * fakturasystemet ud.
 *
 * Et tomt felt (`""` eller `null`) rydder værdien, samme som webens
 * `user.updateIntegrations`.
 */
export async function PUT(request: Request) {
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`desktop-settings-write:${ip}`, 20, 60_000))) {
    return rateLimitResponse();
  }

  // Ethvert auth-problem er en 401 — en ugyldig signatur er ikke en 500.
  const userId = await authenticatedUserId(request);
  if (!userId) return unauthorized();

  try {
    const membership = await getDesktopMembership(userId);
    if (!membership) {
      return NextResponse.json(
        { error: await tr("serverErrors", "api.desktop.notInAnyOrg") },
        { status: 403 },
      );
    }
    if (!isOrgAdminRole(membership.role)) {
      return NextResponse.json(
        {
          error: await tr("serverErrors", "api.desktop.adminsOnlyIntegrations"),
        },
        { status: 403 },
      );
    }

    const requested = new URL(request.url).searchParams.get("organizationId");
    if (requested && requested !== membership.organizationId) {
      return NextResponse.json(
        { error: await tr("serverErrors", "common.notOrgMemberShort") },
        { status: 403 },
      );
    }

    // Ugyldig JSON er en klientfejl (400), ikke en serverfejl.
    const body = await request.json().catch(() => undefined);
    const parsed = settingsWriteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: await tr(
            "serverErrors",
            "api.desktop.invalidIntegrationSettings",
          ),
        },
        { status: 400 },
      );
    }

    // Kun de syv navngivne felter læses fra body — en `userId`, `role` eller
    // `organizationId` i payloaden kan ikke flytte skrivningen til en anden
    // bruger eller give dem rettigheder. Nøglerne krypteres som i webens
    // `user.updateIntegrations` (#690); mangler ENCRYPTION_KEY, kaster
    // encryptSecretOrNull, og intet gemmes i klartekst.
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    for (const field of [
      "billyApiKey",
      "billyOrganizationId",
      "dineroApiKey",
      "dineroOrganizationId",
      "economicAppSecretToken",
      "economicAgreementGrantToken",
      "timeopsApiKey",
    ] as const) {
      const value = parsed.data[field];
      if (value !== undefined) {
        updateData[field] = SECRET_FIELDS.has(field)
          ? encryptSecretOrNull(value)
          : value === ""
            ? null
            : value;
      }
    }

    await db.update(users).set(updateData).where(eq(users.id, userId));

    return NextResponse.json(
      { success: true, organizationId: membership.organizationId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "[Desktop Settings] Skrivning fejlede:",
      error instanceof Error ? error.message : "ukendt fejl",
    );
    return NextResponse.json(
      { error: await tr("serverErrors", "api.desktop.settingsSaveFailed") },
      { status: 500 },
    );
  }
}
