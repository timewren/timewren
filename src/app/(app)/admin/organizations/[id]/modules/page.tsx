"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui";
import {
  MODULE_DESCRIPTIONS,
  MODULE_LABELS,
  type ModuleKey,
} from "@/lib/modules/constants";
import { trpc } from "@/providers/trpc-provider";

export default function OrganizationModulesAdminPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const t = useTranslations("adminShell");
  const utils = trpc.useUtils();
  const [showEmptyBundleConfirm, setShowEmptyBundleConfirm] = useState(false);
  const { data: modules, isLoading } =
    trpc.admin.organizationModules.list.useQuery({ organizationId: id });

  const { data: testAccount } =
    trpc.admin.organizationModules.getTestAccountFlag.useQuery({
      organizationId: id,
    });
  const setTestAccount =
    trpc.admin.organizationModules.setTestAccountFlag.useMutation({
      onSuccess: () => utils.admin.invalidate(),
      onError: (error) => toast.error(error.message),
    });

  const setAvailability =
    trpc.admin.organizationModules.setAvailability.useMutation({
      onSuccess: () => {
        toast.success("Modul opdateret");
        utils.admin.organizationModules.list.invalidate({ organizationId: id });
      },
      onError: (e) => toast.error(e.message),
    });

  const applyBundle = trpc.admin.organizationModules.applyBundle.useMutation({
    onSuccess: () => {
      toast.success("Bundle anvendt");
      utils.admin.organizationModules.list.invalidate({ organizationId: id });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Moduler
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Styr hvilke moduler organisationen har adgang til.
        </p>
      </div>

      {testAccount !== undefined && (
        <label className="flex min-h-11 w-fit items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={testAccount}
            disabled={setTestAccount.isPending}
            onChange={(event) =>
              setTestAccount.mutate({
                organizationId: id,
                testAccount: event.target.checked,
              })
            }
          />
          {t("markTestOrganization")}
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          onClick={() =>
            applyBundle.mutate({ organizationId: id, bundle: "freelance" })
          }
          disabled={applyBundle.isPending}
        >
          Anvend freelance-bundle
        </button>
        <button
          type="button"
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          onClick={() =>
            applyBundle.mutate({ organizationId: id, bundle: "enterprise" })
          }
          disabled={applyBundle.isPending}
        >
          Anvend enterprise-bundle
        </button>
        <button
          type="button"
          className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/20"
          onClick={() => setShowEmptyBundleConfirm(true)}
          disabled={applyBundle.isPending}
        >
          Anvend tom bundle
        </button>
      </div>

      <ConfirmDialog
        isOpen={showEmptyBundleConfirm}
        onClose={() => setShowEmptyBundleConfirm(false)}
        onConfirm={() => {
          applyBundle.mutate({ organizationId: id, bundle: "empty" });
          setShowEmptyBundleConfirm(false);
        }}
        title="Slet alle moduler?"
        description="Alle modul-rækker fjernes for denne organisation. Ved næste deploy bliver freelance-orgs automatisk re-populeret med standard-bundle. Enterprise-orgs bliver IKKE regranted."
        confirmLabel="Slet alle"
        cancelLabel="Annuller"
        variant="danger"
        isLoading={applyBundle.isPending}
      />

      <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900 dark:border-brand-600 dark:bg-tt-gran-lys dark:text-brand-200">
        <strong>Sådan virker det:</strong> Tilgængelig betyder at modulet kan
        bruges af organisationen. Organisationens ejer skal stadig aktivere
        modulet i deres egne indstillinger (
        <code>/dashboard/settings/modules</code>) for at det slår igennem. Dette
        gør det muligt at tildele moduler uden at ændre organisationens
        nuværende opsætning.
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-gray-200 p-6 text-sm text-gray-500 dark:border-gray-700">
          Indlæser moduler...
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Modul
                </th>
                <th className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Tilgængelig
                </th>
                <th className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Aktiveret af org
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900">
              {modules?.map((m) => (
                <tr key={m.key}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      {MODULE_LABELS[m.key as ModuleKey]}
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {MODULE_DESCRIPTIONS[m.key as ModuleKey]}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={m.isAvailable}
                      disabled={setAvailability.isPending}
                      onChange={(e) =>
                        setAvailability.mutate({
                          organizationId: id,
                          moduleKey: m.key as ModuleKey,
                          isAvailable: e.target.checked,
                        })
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-600 dark:text-gray-400">
                    {m.isAvailable ? (m.isEnabled ? "Ja" : "Nej") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
