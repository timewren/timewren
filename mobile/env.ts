import z from 'zod';

import { timewren } from './config/brands';
import packageJSON from './package.json';

export { timewren };

const isTimeWren = process.env.APP_VARIANT === 'timewren';
if (process.env.APP_VARIANT && !['timetrack', 'timewren'].includes(process.env.APP_VARIANT))
  throw new Error('Unknown APP_VARIANT');

// Single unified environment schema
const envSchema = z.object({
  EXPO_PUBLIC_APP_ENV: z.enum(['development', 'preview', 'production']),
  EXPO_PUBLIC_NAME: z.string(),
  EXPO_PUBLIC_SCHEME: z.string(),
  EXPO_PUBLIC_BUNDLE_ID: z.string(),
  EXPO_PUBLIC_PACKAGE: z.string(),
  EXPO_PUBLIC_VERSION: z.string(),
  EXPO_PUBLIC_API_URL: z.string().url(),
  EXPO_PUBLIC_ASSOCIATED_DOMAIN: z.string().url().optional(),

  // RevenueCat (valgfrit - skabelonen kører uden nøgler, se src/lib/payments.ts)
  EXPO_PUBLIC_PAYMENTS_ENABLED: z.boolean(),

  // Crash-rapportering (valgfri — appen kører uden). Sæt DSN fra Sentry-projektet.
  EXPO_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY: z.string().optional(),
  EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY: z.string().optional(),

  // only available for app.config.ts usage
  APP_BUILD_ONLY_VAR: z.string().optional(),
});

// Config records per environment
const EXPO_PUBLIC_APP_ENV = (process.env.EXPO_PUBLIC_APP_ENV
  ?? 'development') as z.infer<typeof envSchema>['EXPO_PUBLIC_APP_ENV'];

const BUNDLE_IDS = {
  development: 'dk.timetrack.app.development',
  preview: 'dk.timetrack.app.preview',
  production: 'dk.timetrack.app',
} as const;

const PACKAGES = {
  development: 'dk.timetrack.app.development',
  preview: 'dk.timetrack.app.preview',
  production: 'dk.timetrack.app',
} as const;

const SCHEMES = {
  development: 'timetrack',
  preview: 'timetrack.preview',
  production: 'timetrack',
} as const;

const NAME = 'TimeTrack';

// Check if strict validation is required (before prebuild)
const STRICT_ENV_VALIDATION = process.env.STRICT_ENV_VALIDATION === '1';

// Build env object
const _env: z.infer<typeof envSchema> = {
  EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_NAME: isTimeWren ? timewren.name : NAME,
  EXPO_PUBLIC_SCHEME: isTimeWren ? timewren.scheme : SCHEMES[EXPO_PUBLIC_APP_ENV],
  EXPO_PUBLIC_BUNDLE_ID: isTimeWren ? timewren.applicationId : BUNDLE_IDS[EXPO_PUBLIC_APP_ENV],
  EXPO_PUBLIC_PACKAGE: isTimeWren ? timewren.applicationId : PACKAGES[EXPO_PUBLIC_APP_ENV],
  EXPO_PUBLIC_VERSION: packageJSON.version,
  EXPO_PUBLIC_API_URL: isTimeWren ? timewren.cloudUrl : process.env.EXPO_PUBLIC_API_URL ?? '',
  EXPO_PUBLIC_ASSOCIATED_DOMAIN: process.env.EXPO_PUBLIC_ASSOCIATED_DOMAIN,
  EXPO_PUBLIC_PAYMENTS_ENABLED:
    process.env.EXPO_PUBLIC_PAYMENTS_ENABLED === 'true',
  EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN || undefined,
  EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY:
    process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY,
  EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY:
    process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY,
  APP_BUILD_ONLY_VAR: process.env.APP_BUILD_ONLY_VAR,
};

function getValidatedEnv(env: z.infer<typeof envSchema>) {
  const parsed = envSchema.safeParse(env);

  if (parsed.success === false) {
    const errorMessage
      = `❌ Invalid environment variables:${
        JSON.stringify(parsed.error.flatten().fieldErrors, null, 2)
      }\n❌ Missing variables in .env file for APP_ENV=${EXPO_PUBLIC_APP_ENV}`
      + `\n💡 Tip: If you recently updated the .env file, try restarting with -c flag to clear the cache.`;

    if (STRICT_ENV_VALIDATION) {
      console.error(errorMessage);
      throw new Error('Invalid environment variables');
    }
  }
  else {
    console.log('✅ Environment variables validated successfully');
  }

  return parsed.success ? parsed.data : env;
}

const Env = STRICT_ENV_VALIDATION ? getValidatedEnv(_env) : _env;

export default Env;
