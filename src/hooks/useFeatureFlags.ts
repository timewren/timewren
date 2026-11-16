import { trpc } from "@/providers/trpc-provider";

export function useFeatureFlags() {
  const { data: flags, isLoading } = trpc.user.getFeatureFlags.useQuery(
    undefined,
    {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  );
  const { data: profile } = trpc.user.getProfile.useQuery();
  const isAdmin = profile?.role === "admin" || profile?.role === "supporter";

  return {
    flags: flags ?? {},
    isLoading,
    isAdmin,
    isEnabled: (key: string): boolean => {
      if (isAdmin) return true;
      if (!flags) return false;
      return flags[key] ?? false;
    },
  };
}
