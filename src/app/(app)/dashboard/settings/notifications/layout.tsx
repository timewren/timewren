"use client";

import { FeatureGate } from "@/components/FeatureGate";

export default function NotificationsSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <FeatureGate featureKey="notifications">{children}</FeatureGate>;
}
