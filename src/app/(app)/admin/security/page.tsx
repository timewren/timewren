"use client";

import { SecurityView } from "@/components/admin/views/SecurityView";

export default function SecurityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Sikkerhed</h1>
        <p className="mt-1 text-sm text-gray-500">
          Login-aktivitet, sikkerhedshandlinger og flag-status (seneste 14 dage)
        </p>
      </div>
      <SecurityView />
    </div>
  );
}
