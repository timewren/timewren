"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AdminCommandPalette } from "@/components/admin/AdminCommandPalette";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminTopBar } from "@/components/admin/AdminTopBar";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { useSession } from "@/lib/auth-client";
import { trpc } from "@/providers/trpc-provider";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("adminShell");
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { data: session, isPending: sessionLoading } = useSession();
  const { data: userProfile, isLoading: profileLoading } =
    trpc.user.getProfile.useQuery(undefined, {
      enabled: !!session?.user,
    });

  const isLoading = sessionLoading || (!!session?.user && profileLoading);
  const userRole = userProfile?.role || "user";
  const hasAccess = userRole === "admin" || userRole === "supporter";

  // Redirect if not authorized
  useEffect(() => {
    if (!sessionLoading && !session?.user) {
      router.push("/dashboard");
      return;
    }
    if (!isLoading && userProfile && !hasAccess) {
      router.push("/dashboard");
    }
  }, [session, sessionLoading, isLoading, userProfile, hasAccess, router]);

  // Loading state
  if (isLoading || !userProfile) {
    return (
      <LoadingScreen fullScreen message={t("verifying")} showTip={false} />
    );
  }

  // Not authorized — don't render while redirecting
  if (!hasAccess) {
    return null;
  }

  const userName = userProfile.name || userProfile.email || "Admin";

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <AdminSidebar
        userName={userName}
        userRole={userRole}
        onOpenSearch={() => setPaletteOpen(true)}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <AdminTopBar onOpenSearch={() => setPaletteOpen(true)} />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
      <AdminCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
