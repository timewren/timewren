import {
  Environment,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
  SignedDataVerifier,
} from "@apple/app-store-server-library";
import { APPLE_ROOT_CERTS_BASE64 } from "./apple-root-certs";
import { APPLE_APP_APPLE_ID, STORE_APP_ID } from "./products";

/**
 * Lokal verificering af Apples signerede data (StoreKit 2-transaktioner og
 * App Store Server Notifications V2) mod Apples rodcertifikater. Ingen kald
 * til App Store Server API. Injicerbar, så tests kan bruge en falsk verifier.
 */
export interface AppleVerifier {
  verifyTransaction(jws: string): Promise<JWSTransactionDecodedPayload>;
  verifyRenewalInfo(jws: string): Promise<JWSRenewalInfoDecodedPayload>;
  verifyNotification(
    signedPayload: string,
  ): Promise<ResponseBodyV2DecodedPayload>;
}

/**
 * Læser `environment` fra JWS'ens payload UDEN at verificere — kun til at
 * vælge hvilken verifier (Production/Sandbox) der skal verificere. Begge
 * verificerer signaturen mod Apples rødder og afviser et miljø der ikke
 * matcher, så en forfalsket claim giver ikke adgang.
 */
export function peekAppleEnvironment(jws: string): Environment {
  try {
    const part = jws.split(".")[1] ?? "";
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    const env =
      payload?.environment ??
      payload?.data?.environment ??
      payload?.summary?.environment;
    return env === Environment.SANDBOX
      ? Environment.SANDBOX
      : Environment.PRODUCTION;
  } catch {
    return Environment.PRODUCTION;
  }
}

export function createAppleVerifier(): AppleVerifier {
  const roots = Object.values(APPLE_ROOT_CERTS_BASE64).map((b64) =>
    Buffer.from(b64, "base64"),
  );
  // enableOnlineChecks: certifikatkæden tjekkes mod nuværende tidspunkt og
  // OCSP-tilbagekaldelse (Apples anbefaling). Resultatet caches af biblioteket.
  const verifiers = {
    [Environment.PRODUCTION]: new SignedDataVerifier(
      roots,
      true,
      Environment.PRODUCTION,
      STORE_APP_ID,
      APPLE_APP_APPLE_ID,
    ),
    [Environment.SANDBOX]: new SignedDataVerifier(
      roots,
      true,
      Environment.SANDBOX,
      STORE_APP_ID,
      APPLE_APP_APPLE_ID,
    ),
  } as const;
  const pick = (jws: string) =>
    verifiers[
      peekAppleEnvironment(jws) === Environment.SANDBOX
        ? Environment.SANDBOX
        : Environment.PRODUCTION
    ];
  return {
    verifyTransaction: (jws) => pick(jws).verifyAndDecodeTransaction(jws),
    verifyRenewalInfo: (jws) => pick(jws).verifyAndDecodeRenewalInfo(jws),
    verifyNotification: (payload) =>
      pick(payload).verifyAndDecodeNotification(payload),
  };
}

let instance: AppleVerifier | null = null;

export function getAppleVerifier(): AppleVerifier {
  instance ??= createAppleVerifier();
  return instance;
}

/** Kun til tests. */
export function setAppleVerifierForTests(v: AppleVerifier | null) {
  instance = v;
}
