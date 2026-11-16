"use client";

import { FeatureGate } from "@/components/FeatureGate";
import { SettingsShell } from "@/components/settings/SettingsShell";

export default function OrganizationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Organisationssiderne er indstillinger: samme venstremenu og søgning
  return (
    <FeatureGate featureKey="organizations">
      <SettingsShell>{children}</SettingsShell>
    </FeatureGate>
  );
}
