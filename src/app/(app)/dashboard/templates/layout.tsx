"use client";

import { FeatureGate } from "@/components/FeatureGate";

export default function TemplatesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <FeatureGate featureKey="recurringTemplates">{children}</FeatureGate>;
}
