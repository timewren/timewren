"use client";

import { trpc } from "@/providers/trpc-provider";

export function usePermission(moduleKey: string) {
  const { data: permissions, isLoading } =
    trpc.rolePermissions.getMyPermissions.useQuery(undefined, {
      staleTime: 60_000,
    });

  if (isLoading || !permissions) {
    return {
      canRead: false,
      canWrite: false,
      accessLevel: "none" as const,
      isLoading: true,
    };
  }

  const perm = permissions.find((p) => p.moduleKey === moduleKey);
  const accessLevel = perm?.accessLevel ?? "write";

  return {
    canRead: accessLevel === "read" || accessLevel === "write",
    canWrite: accessLevel === "write",
    accessLevel,
    isLoading: false,
  };
}
