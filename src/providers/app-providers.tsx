"use client";

import { ThemeProvider } from "./theme-provider";
import { TRPCProvider } from "./trpc-provider";

/**
 * tRPC/React Query + ThemeProvider (som synker temaet med databasen) til de
 * indloggede flader. Ligger bevidst IKKE i root-layoutet: så slap hele
 * tRPC-/React Query-/superjson-bundtet ud på de offentlige marketingsider,
 * og ThemeProvider fyrede et user.getTheme-kald af for hver anonym besøgende.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <TRPCProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </TRPCProvider>
  );
}
