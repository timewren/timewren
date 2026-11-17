import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build, defineConfig, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

/**
 * Content scripts er klassiske scripts og kan ikke importere delte chunks.
 * Gmail-scriptet bygges derfor for sig som én selvstændig IIFE (med sit eget
 * udsnit af i18n-laget: src/i18n/catalog-modules.gmail.ts), efter at
 * hovedbygget er færdigt.
 */
function gmailContentScript(outDir: string): Plugin {
  return {
    name: "timetrack-gmail-iife",
    apply: "build",
    async closeBundle() {
      await build({
        configFile: false,
        logLevel: "warn",
        resolve: {
          alias: [
            // Kun Gmail-scriptets navneområder, ikke hele kataloget i alle sprog.
            {
              find: /^\.\/catalog-modules$/,
              replacement: resolve(
                __dirname,
                "src/i18n/catalog-modules.gmail.ts",
              ),
            },
            { find: "@", replacement: resolve(__dirname, "src") },
          ],
        },
        build: {
          outDir,
          emptyOutDir: false,
          sourcemap: false,
          minify: "esbuild",
          lib: {
            entry: resolve(__dirname, "src/content/gmail.ts"),
            formats: ["iife"],
            name: "TimeTrackGmail",
            fileName: () => "gmail.js",
          },
        },
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const isFirefox = mode === "firefox";
  const outDir = isFirefox ? "dist-firefox" : "dist";

  return {
    plugins: [
      tailwindcss(),
      react(),
      gmailContentScript(resolve(__dirname, outDir)),
      viteStaticCopy({
        targets: [
          {
            src: isFirefox ? "manifest.firefox.json" : "manifest.json",
            dest: ".",
            rename: "manifest.json",
          },
          {
            src: "public/icons/*",
            dest: "icons",
          },
          {
            src: "_locales",
            dest: ".",
          },
        ],
      }),
    ],
    base: "./",
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
      minify: "esbuild",
      rollupOptions: {
        input: {
          popup: resolve(__dirname, "popup.html"),
          newtab: resolve(__dirname, "newtab.html"),
          background: resolve(__dirname, "src/background/index.ts"),
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name].[hash].js",
          assetFileNames: "assets/[name].[ext]",
        },
      },
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
  };
});
