"use client";

import { OnboardingFunnelView } from "@/components/admin/views/OnboardingFunnelView";
import { useBrand } from "@/components/BrandContext";

export default function OnboardingFunnelPage() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          Onboarding funnel
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Hvor dropper brugerne fra i deres første tid på {brand.name}?
        </p>
      </div>
      <OnboardingFunnelView />
    </div>
  );
}
