"use client";

import { ScenariosView } from "@/components/admin/views/ScenariosView";

export default function ScenariosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Scenarios</h1>
        <p className="mt-1 text-sm text-gray-500">
          What-if analyse: justér prissætning, churn og tilvækst for at se hvad
          det gør ved forretningen
        </p>
      </div>
      <ScenariosView />
    </div>
  );
}
