"use client";

import { FeatureGate } from "@/components/FeatureGate";

export default function KlippekortLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <FeatureGate featureKey="prepaidPackages">{children}</FeatureGate>;
}
