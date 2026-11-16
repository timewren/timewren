"use client";

import { FeatureGate } from "@/components/FeatureGate";

export default function AISettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <FeatureGate featureKey="ai">{children}</FeatureGate>;
}
