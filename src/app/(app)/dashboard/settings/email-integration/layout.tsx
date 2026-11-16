"use client";

import { FeatureGate } from "@/components/FeatureGate";

export default function EmailIntegrationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <FeatureGate featureKey="emailToTask">{children}</FeatureGate>;
}
