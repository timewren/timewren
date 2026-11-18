import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs/config";
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import {
  buildContentSecurityPolicy,
  originOf,
} from "./src/lib/security-headers";

// Only use standalone output on Linux/CI (Windows has issues with node:inspector filenames containing colons)
const isWindows = process.platform === "win32";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: process.env.CI_SKIP_TYPECHECK === "true",
  },

  // Enable standalone output for Docker (disabled on Windows due to filename issues)
  output: isWindows ? undefined : "standalone",
  // install.sh serveres fra scripts/, og TimeWren-docs (llms.txt, .md-ruterne
  // og sitemap'en) læser content/docs ved kørsel (src/lib/timewren-docs/
  // content.ts), så filerne skal med i standalone.
  outputFileTracingIncludes: {
    "/timewren-site/install.sh": ["./scripts/install.sh"],
    "/timewren-site/**/*": ["./content/docs/**/*"],
  },

  // Kun kode er sider. createMDX (TimeWren-docs) ville ellers også gøre
  // .md/.mdx-filer under src/app til ruter.
  pageExtensions: ["tsx", "ts", "jsx", "js"],

  // Avoid bundling node-only deps that include test assets not compatible with Next build
  // takumi-pdf laster sin WASM-fil fra node_modules ved runtime — må ikke bundles
  serverExternalPackages: [
    "imapflow",
    "pino",
    "thread-stream",
    "takumi-pdf",
    "@takumi-rs/helpers",
    // Køb i appen: node-only (node-fetch, jsrsasign) — loades fra node_modules
    "@apple/app-store-server-library",
  ],

  // Production optimizations
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error", "warn"] }
        : false,
  },

  // Image optimization
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.your-objectstorage.com",
      },
      // OAuth-avatarer (Better-Auth gemmer udbyderens billed-URL i user.image).
      // Bevidst KUN lh3 — et wildcard ville gøre /_next/image til en åben
      // proxy for vilkårligt Google-hostet indhold.
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
      },
    ],
  },

  // Compression
  compress: true,

  // Ensure Turbopack uses this repo root (avoid parent lockfile detection)
  turbopack: {
    root: path.resolve(__dirname),
  },

  // React strict mode for better development
  reactStrictMode: true,

  // Redirects
  async redirects() {
    return [
      {
        source: "/signup",
        destination: "/register",
        permanent: true,
      },
      {
        source: "/sikkerhed",
        destination: "/tillid",
        permanent: true,
      },
      {
        // Kort adresse til AI/MCP-siden; én kanonisk side om emnet (#701).
        source: "/ai",
        destination: "/integrations/ai",
        permanent: true,
      },
    ];
  },

  // Remove powered by header
  poweredByHeader: false,

  // Headers for better caching and security
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "origin-when-cross-origin",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Link",
            value: [
              '</.well-known/api-catalog>; rel="api-catalog"',
              '</api/v1/openapi.json>; rel="service-desc"; type="application/json"',
              '</api/v1/docs>; rel="service-doc"',
              '</llms.txt>; rel="describedby"; type="text/plain"',
            ].join(", "),
          },
          {
            key: "Content-Security-Policy",
            value: buildContentSecurityPolicy({
              isDevelopment: process.env.NODE_ENV === "development",
              marketingOrigin: originOf(
                process.env.NEXT_PUBLIC_MARKETING_URL,
                process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
              ),
              umamiCollectOrigin: originOf(
                process.env.NEXT_PUBLIC_UMAMI_COLLECT_URL,
                "",
              ),
              umamiOrigin: originOf(
                process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL,
                "",
              ),
              plausibleOrigin: originOf(
                process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL,
                "",
              ),
            }),
          },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, must-revalidate",
          },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/",
          },
        ],
      },
      {
        source: "/manifest.json",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600",
          },
          {
            key: "Content-Type",
            value: "application/manifest+json",
          },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Fumadocs MDX: kompilerer TimeWren-docs (content/docs) via makroen i
// src/lib/timewren-docs/source.ts. Yderst, så Next venter på dens init.
const withMDX = createMDX();

const isSentryEnabled =
  Boolean(process.env.SENTRY_AUTH_TOKEN) && process.env.SENTRY_DISABLED !== "1";

export default withMDX(
  isSentryEnabled
    ? withSentryConfig(withNextIntl(nextConfig), {
        // For all available options, see:
        // https://github.com/getsentry/sentry-webpack-plugin#options

        org: "mahope",
        project: "timetrack",

        // Only print logs for uploading source maps in CI
        silent: !process.env.CI,

        // For all available options, see:
        // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

        // Upload a larger set of source maps for prettier stack traces (increases build time)
        widenClientFileUpload: true,

        // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
        // This can increase your server load as well as your hosting bill.
        // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
        // side errors will fail.
        tunnelRoute: "/monitoring",

        // Sourcemaps configuration
        sourcemaps: {
          deleteSourcemapsAfterUpload: true,
        },

        // Annotate React components so breadcrumbs show their full name. Top-level
        // in v11 (webpack.reactComponentAnnotation is deprecated) and also covers
        // Turbopack builds.
        reactComponentAnnotation: {
          enabled: true,
        },

        // Webpack-specific options
        webpack: {
          // Automatically tree-shake Sentry logger statements to reduce bundle size
          treeshake: {
            removeDebugLogging: true,
          },
          // Enables automatic instrumentation of Vercel Cron Monitors
          automaticVercelMonitors: true,
        },
      })
    : withNextIntl(nextConfig),
);
