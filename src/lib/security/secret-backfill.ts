/**
 * Backfill: kryptér integrations-tokens/-secrets der stadig ligger i klartekst
 * (#690). Kernen er DB-uafhængig (SecretStore), så den kan unit-testes; selve
 * kørslen sker via scripts/backfill-encrypt-secrets.ts.
 *
 * Sikkerhedsregler:
 * - Idempotent: kun klartekst-værdier røres. Allerede krypterede (præfiks
 *   "enc:v1:" eller ældre iv:authTag:ciphertext) springes over.
 * - Rigtig nøgle: før der skrives noget, dekrypteres alle eksisterende
 *   krypterede rækker. Kan de ikke dekrypteres, er nøglen forkert, og der
 *   afbrydes — ellers ville klartekst blive krypteret med en nøgle appen ikke
 *   har. Tjekket sker pr. codec: ENCRYPTION_KEY ("enc:v1:") og
 *   BETTER_AUTH_SECRET (better-auths OAuth-token-format, #710).
 * - Intet tab: hver ny værdi dekrypteres og sammenlignes med originalen før
 *   den skrives. Fejler round-trip, skrives intet for den række.
 * - Ingen lost updates: der skrives kun hvis kolonnen stadig har den værdi vi
 *   læste (compare-and-set), så en samtidig token-refresh ikke overskrives.
 * - Uden gyldig nøgle (ENCRYPTION_KEY/BETTER_AUTH_SECRET) afbrydes før første
 *   række.
 */

import { betterAuthTokenCodec } from "@/lib/security/oauth-token-crypto";
import {
  decryptSecret,
  detectSecretFormat,
  encryptSecret,
  type SecretFormat,
} from "@/lib/utils/encryption";

/**
 * Hvordan en kolonne krypteres. Backfill skal skrive i præcis det format den
 * kode der læser kolonnen forventer.
 */
export interface SecretCodec {
  /** Nøglens navn — nøgle-verifikation sker pr. codec. */
  name: string;
  detect(stored: string): SecretFormat;
  encrypt(plaintext: string): Promise<string>;
  decrypt(stored: string): Promise<string>;
}

/** encryptSecret/decryptSecret med ENCRYPTION_KEY ("enc:v1:"). */
export const appSecretCodec: SecretCodec = {
  name: "ENCRYPTION_KEY",
  detect: detectSecretFormat,
  encrypt: async (plaintext) => encryptSecret(plaintext),
  decrypt: async (stored) => decryptSecret(stored),
};

export interface SecretTarget {
  /** SQL-tabelnavn */
  table: string;
  /** SQL-kolonne med secret */
  column: string;
  /** Primærnøgle-kolonne */
  idColumn: string;
  /** Valgfrit ekstra filter (kolonne = værdi), fx provider = 'google' */
  filter?: { column: string; equals: string };
  /**
   * Bruges kun til at verificere nøglen (krypterede rækker dekrypteres), men
   * klartekst-rækker røres ikke.
   */
  verifyOnly?: boolean;
  /** Krypteringsformat. Default: appSecretCodec (ENCRYPTION_KEY). */
  codec?: SecretCodec;
}

/**
 * Webhook-hemmeligheder (#711). Læses og skrives via
 * src/lib/notifications/webhook-secrets.ts.
 */
export const WEBHOOK_SECRET_TARGETS: SecretTarget[] = [
  {
    table: "notification_channels",
    column: "discord_webhook_url",
    idColumn: "id",
  },
  {
    table: "notification_channels",
    column: "slack_webhook_url",
    idColumn: "id",
  },
  { table: "notification_channels", column: "slack_bot_token", idColumn: "id" },
  {
    table: "org_notification_settings",
    column: "teams_webhook_url",
    idColumn: "id",
  },
];

/** Alle kolonner backfill dækker. Holdes i sync med skrive-stierne. */
export const SECRET_TARGETS: SecretTarget[] = [
  ...WEBHOOK_SECRET_TARGETS,
  {
    table: "calendar_connections",
    column: "access_token",
    idColumn: "id",
    filter: { column: "provider", equals: "google" },
  },
  {
    table: "calendar_connections",
    column: "refresh_token",
    idColumn: "id",
    filter: { column: "provider", equals: "google" },
  },
  { table: "user", column: "billy_api_key", idColumn: "id" },
  { table: "user", column: "dinero_api_key", idColumn: "id" },
  { table: "user", column: "dinero_refresh_token", idColumn: "id" },
  { table: "user", column: "economic_app_secret_token", idColumn: "id" },
  { table: "user", column: "economic_agreement_grant_token", idColumn: "id" },
  { table: "user", column: "timeops_api_key", idColumn: "id" },
  { table: "user", column: "ai_api_key", idColumn: "id" },
  { table: "email_integrations", column: "imap_password", idColumn: "id" },
  { table: "imports", column: "credentials", idColumn: "id" },
  // Signeringssecret for udgående webhooks (#712).
  { table: "outgoing_webhooks", column: "secret", idColumn: "id" },
  // OAuth-login-tokens (#710): access/refresh i better-auths eget format
  // (encryptOAuthTokens), idToken med ENCRYPTION_KEY (databaseHooks i auth.ts).
  {
    table: "account",
    column: "accessToken",
    idColumn: "id",
    codec: betterAuthTokenCodec,
  },
  {
    table: "account",
    column: "refreshToken",
    idColumn: "id",
    codec: betterAuthTokenCodec,
  },
  { table: "account", column: "idToken", idColumn: "id" },
  // iCloud-passwords er altid krypteret (ældre format) — kun nøgle-verifikation.
  {
    table: "calendar_connections",
    column: "access_token",
    idColumn: "id",
    filter: { column: "provider", equals: "apple" },
    verifyOnly: true,
  },
];

export interface SecretRow {
  id: string;
  value: string;
}

export interface SecretStore {
  /** Rækker hvor kolonnen er udfyldt (må gerne inkludere krypterede). */
  listRows(target: SecretTarget): Promise<SecretRow[]>;
  /**
   * Skriv newValue hvis kolonnen stadig er oldValue. Returnerer true hvis
   * rækken blev opdateret.
   */
  updateIfUnchanged(
    target: SecretTarget,
    id: string,
    oldValue: string,
    newValue: string,
  ): Promise<boolean>;
}

export interface TargetReport {
  target: string;
  scanned: number;
  alreadyEncrypted: number;
  legacyEncrypted: number;
  /** Krypterede rækker der IKKE kunne dekrypteres med den aktuelle nøgle. */
  unreadable: number;
  plaintext: number;
  encrypted: number;
  changedConcurrently: number;
  failed: number;
}

type Totals = Omit<TargetReport, "target">;

export interface BackfillReport {
  apply: boolean;
  /** Antal eksisterende krypterede rækker der blev dekrypteret med nøglen. */
  keyVerifiedRows: number;
  /** Rækker der ikke kunne dekrypteres, som "tabel.kolonne id=…". */
  unreadableRows: string[];
  targets: TargetReport[];
  totals: Totals;
}

export interface BackfillOptions {
  apply: boolean;
  targets?: SecretTarget[];
  /**
   * Tillad --apply selvom der ikke findes nogen krypteret række at verificere
   * nøglen mod (fx en helt ny database).
   */
  allowUnverifiedKey?: boolean;
  /**
   * Fortsæt selvom enkelte krypterede rækker ikke kan dekrypteres — kun hvis
   * mindst én anden række beviser at nøglen er rigtig.
   */
  ignoreUnreadable?: boolean;
}

export class BackfillAbortedError extends Error {
  constructor(
    message: string,
    readonly report: BackfillReport,
  ) {
    super(message);
    this.name = "BackfillAbortedError";
  }
}

function emptyTotals(): Totals {
  return {
    scanned: 0,
    alreadyEncrypted: 0,
    legacyEncrypted: 0,
    unreadable: 0,
    plaintext: 0,
    encrypted: 0,
    changedConcurrently: 0,
    failed: 0,
  };
}

interface PendingWrite {
  target: SecretTarget;
  report: TargetReport;
  id: string;
  oldValue: string;
  newValue: string;
}

/**
 * Kør backfill. Med apply=false (dry-run) tælles, nøgle-verificeres og
 * round-trip-testes alt, men intet skrives.
 */
export async function backfillSecrets(
  store: SecretStore,
  options: BackfillOptions,
): Promise<BackfillReport> {
  const targets = options.targets ?? SECRET_TARGETS;

  // Fail fast: uden gyldig nøgle kaster dette (EncryptionKeyError) før vi
  // læser en eneste række.
  const codecs = [...new Set(targets.map(codecOf))];
  for (const codec of codecs) {
    const probe = await codec.decrypt(await codec.encrypt("backfill-probe"));
    if (probe !== "backfill-probe") {
      throw new Error(
        `Krypterings-selvtest fejlede (${codec.name}) — afbryder backfill`,
      );
    }
  }
  /** Pr. codec: rækker der beviste nøglen / ikke kunne dekrypteres. */
  const verifiedByCodec = new Map<SecretCodec, number>();
  const unreadableByCodec = new Map<SecretCodec, number>();
  const bump = (map: Map<SecretCodec, number>, codec: SecretCodec) =>
    map.set(codec, (map.get(codec) ?? 0) + 1);

  const report: BackfillReport = {
    apply: options.apply,
    keyVerifiedRows: 0,
    unreadableRows: [],
    targets: [],
    totals: emptyTotals(),
  };
  const pending: PendingWrite[] = [];

  // Fase 1: læs alt, verificér nøglen og forbered krypterede værdier.
  for (const target of targets) {
    const t: TargetReport = {
      target: describeTarget(target),
      ...emptyTotals(),
    };
    report.targets.push(t);
    const codec = codecOf(target);
    const rows = await store.listRows(target);

    for (const row of rows) {
      if (!row.value) continue;
      t.scanned++;
      const format = codec.detect(row.value);

      if (format !== "plaintext") {
        if (format === "prefixed") t.alreadyEncrypted++;
        else t.legacyEncrypted++;
        try {
          await codec.decrypt(row.value);
          report.keyVerifiedRows++;
          bump(verifiedByCodec, codec);
        } catch {
          t.unreadable++;
          bump(unreadableByCodec, codec);
          report.unreadableRows.push(`${t.target} id=${row.id}`);
        }
        continue;
      }

      if (target.verifyOnly) continue;

      t.plaintext++;
      try {
        const encrypted = await codec.encrypt(row.value);
        if ((await codec.decrypt(encrypted)) !== row.value) {
          throw new Error("round-trip gav en anden værdi");
        }
        if (codec.detect(encrypted) === "plaintext") {
          throw new Error("krypteret værdi ville blive læst som klartekst");
        }
        pending.push({
          target,
          report: t,
          id: row.id,
          oldValue: row.value,
          newValue: encrypted,
        });
      } catch (error) {
        t.failed++;
        console.error(
          `[backfill] ${t.target} id=${row.id}: kryptering/verifikation fejlede, rækken er urørt:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  // Nøgle-tjek før der skrives noget — pr. codec, da hver codec har sin egen
  // nøgle (ENCRYPTION_KEY hhv. BETTER_AUTH_SECRET).
  if (options.apply) {
    const writingCodecs = new Set(pending.map((p) => codecOf(p.target)));
    for (const codec of writingCodecs) {
      const unreadable = unreadableByCodec.get(codec) ?? 0;
      const verified = verifiedByCodec.get(codec) ?? 0;
      if (unreadable > 0 && verified === 0) {
        sumTotals(report);
        throw new BackfillAbortedError(
          `Ingen af ${unreadable} krypterede rækker kan dekrypteres — ${codec.name} er sandsynligvis forkert. Intet er skrevet.`,
          report,
        );
      }
      if (unreadable > 0 && !options.ignoreUnreadable) {
        sumTotals(report);
        throw new BackfillAbortedError(
          `${unreadable} krypterede rækker (${codec.name}) kan ikke dekrypteres (se listen). Undersøg dem, eller kør med --ignore-unreadable. Intet er skrevet.`,
          report,
        );
      }
      if (verified === 0 && !options.allowUnverifiedKey) {
        sumTotals(report);
        throw new BackfillAbortedError(
          `Der findes ingen krypterede rækker at verificere ${codec.name} mod. Bekræft at nøglen er den samme som appens, og kør med --allow-unverified-key. Intet er skrevet.`,
          report,
        );
      }
    }
  }

  // Fase 2: skriv (compare-and-set).
  if (options.apply) {
    for (const write of pending) {
      const updated = await store.updateIfUnchanged(
        write.target,
        write.id,
        write.oldValue,
        write.newValue,
      );
      if (updated) write.report.encrypted++;
      else write.report.changedConcurrently++;
    }
  }

  sumTotals(report);
  return report;
}

function codecOf(target: SecretTarget): SecretCodec {
  return target.codec ?? appSecretCodec;
}

function sumTotals(report: BackfillReport) {
  report.totals = emptyTotals();
  for (const t of report.targets) {
    for (const key of Object.keys(report.totals) as Array<keyof Totals>) {
      report.totals[key] += t[key];
    }
  }
}

export function describeTarget(target: SecretTarget): string {
  const filter = target.filter
    ? ` [${target.filter.column}=${target.filter.equals}]`
    : "";
  return `${target.table}.${target.column}${filter}`;
}
