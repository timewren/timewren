"use client";

import { GdprView } from "@/components/admin/views/GdprView";

export default function AdminGdprPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          GDPR-anmodninger
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Data export og sletning. GDPR Art. 12: maks 30 dage til at svare.
        </p>
      </div>
      <GdprView />
    </div>
  );
}
