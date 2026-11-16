"use client";

import { FeatureGate } from "@/components/FeatureGate";

export default function PortalSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <FeatureGate featureKey="clientPortal">{children}</FeatureGate>;
}
