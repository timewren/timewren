"use client";

import {
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Puzzle,
  RefreshCw,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import {
  BillyExportModal,
  type BillyExportSettings,
} from "@/components/invoices/BillyExportModal";
import {
  EconomicExportModal,
  type EconomicExportSettings,
} from "@/components/invoices/EconomicExportModal";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

type TabType = "import" | "export";
type ExportTarget = "billy" | "dinero" | "economic";

const exportTargetLabel: Record<ExportTarget, string> = {
  billy: "Billy",
  dinero: "Dinero",
  economic: "e-conomic",
};

export default function IntegrationsSyncPage() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("integrations.sync");
  const locale = useLocale();
  const _router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>("import");
  const [exportTarget, setExportTarget] = useState<ExportTarget>("billy");

  // Import state
  const [selectedBillyContacts, setSelectedBillyContacts] = useState<
    Set<string>
  >(new Set());
  const [selectedDineroContacts, setSelectedDineroContacts] = useState<
    Set<string>
  >(new Set());
  const [selectedEconomicContacts, setSelectedEconomicContacts] = useState<
    Set<string>
  >(new Set());
  const [showOnlyNewBilly, setShowOnlyNewBilly] = useState(true);
  const [_showOnlyNewDinero, _setShowOnlyNewDinero] = useState(true);

  // Export state
  const [selectedClientsToExport, setSelectedClientsToExport] = useState<
    Set<string>
  >(new Set());
  const [selectedInvoicesToExport, setSelectedInvoicesToExport] = useState<
    Set<string>
  >(new Set());
  const [exportingClients, setExportingClients] = useState(false);
  const [exportingInvoices, setExportingInvoices] = useState(false);
  const [exportResults, setExportResults] = useState<{
    success: number;
    failed: number;
    errors: string[];
  } | null>(null);

  // Billy export modal state
  const [showBillyExportModal, setShowBillyExportModal] = useState(false);

  // e-conomic export modal state
  const [showEconomicExportModal, setShowEconomicExportModal] = useState(false);
  const [economicExportSettings, setEconomicExportSettings] =
    useState<EconomicExportSettings | null>(null);

  // Queries
  const { data: integrationStatus } = trpc.user.getIntegrationStatus.useQuery();

  const { data: clients, isLoading: clientsLoading } =
    trpc.clients.list.useQuery(undefined, {
      enabled: activeTab === "export",
    });

  const { data: invoices, isLoading: invoicesLoading } =
    trpc.invoices.list.useQuery(
      // Eksport-fanen bruges til backfill af ÆLDRE fakturaer til
      // regnskabssystemet — brug maks-loftet (#186 review-fund)
      { limit: 1000 },
      { enabled: activeTab === "export" },
    );

  // Import mutations
  const importBillyMutation = trpc.integrations.importBillyContacts.useMutation(
    {
      onSuccess: (data) => {
        toast.success(t("m.foundBilly", { count: data.count }));
      },
      onError: (error) => {
        toast.error(error.message || t("m.fetchBillyFailed"));
      },
    },
  );

  const importDineroMutation =
    trpc.integrations.importDineroContacts.useMutation({
      onSuccess: (data) => {
        toast.success(t("m.foundDinero", { count: data.count }));
      },
      onError: (error) => {
        toast.error(error.message || t("m.fetchDineroFailed"));
      },
    });

  const syncBillyToTimeTrackMutation =
    trpc.integrations.syncBillyToTimeTrack.useMutation({
      onSuccess: (data) => {
        if (data.skipped > 0) {
          toast.success(
            t("m.importedFromBillySkipped", {
              imported: data.imported,
              skipped: data.skipped,
            }),
          );
        } else {
          toast.success(t("m.importedFromBilly", { imported: data.imported }));
        }
        setSelectedBillyContacts(new Set());
        // Refetch to update alreadyImported status
        importBillyMutation.mutate();
      },
      onError: (error) => {
        toast.error(error.message || t("m.importContactsFailed"));
      },
    });

  const syncDineroToTimeTrackMutation =
    trpc.integrations.syncDineroToTimeTrack.useMutation({
      onSuccess: (data) => {
        toast.success(t("m.importedFromDinero", { imported: data.imported }));
        setSelectedDineroContacts(new Set());
        // Refetch to update alreadyImported status
        importDineroMutation.mutate();
      },
      onError: (error) => {
        toast.error(error.message || t("m.importContactsFailed"));
      },
    });

  const importEconomicMutation =
    trpc.integrations.importEconomicCustomers.useMutation({
      onSuccess: (data) => {
        toast.success(t("m.foundEconomic", { count: data.count }));
      },
      onError: (error) => {
        toast.error(error.message || t("m.fetchEconomicFailed"));
      },
    });

  const syncEconomicToTimeTrackMutation =
    trpc.integrations.syncEconomicToTimeTrack.useMutation({
      onSuccess: (data) => {
        toast.success(t("m.importedFromEconomic", { imported: data.imported }));
        setSelectedEconomicContacts(new Set());
        importEconomicMutation.mutate();
      },
      onError: (error) => {
        toast.error(error.message || t("m.importClientsFailed"));
      },
    });

  // Export mutations
  const exportClientToBillyMutation =
    trpc.integrations.exportClientToBilly.useMutation();
  const exportClientToDineroMutation =
    trpc.integrations.exportClientToDinero.useMutation();
  const exportInvoiceToBillyMutation =
    trpc.integrations.exportInvoiceToBilly.useMutation();
  const exportInvoiceToDineroMutation =
    trpc.integrations.exportInvoiceToDinero.useMutation();
  const exportClientToEconomicMutation =
    trpc.integrations.exportClientToEconomic.useMutation();
  const exportInvoiceToEconomicMutation =
    trpc.integrations.exportInvoiceToEconomic.useMutation();

  // Handlers
  const handleImportFromBilly = async () => {
    await importBillyMutation.mutateAsync();
  };

  const handleImportFromDinero = async () => {
    await importDineroMutation.mutateAsync();
  };

  const handleImportFromEconomic = async () => {
    await importEconomicMutation.mutateAsync();
  };

  const handleSyncBillyToTimeTrack = async () => {
    if (selectedBillyContacts.size === 0) {
      toast.error(t("x001"));
      return;
    }
    await syncBillyToTimeTrackMutation.mutateAsync({
      contactIds: Array.from(selectedBillyContacts),
    });
  };

  const handleSyncDineroToTimeTrack = async () => {
    if (selectedDineroContacts.size === 0) {
      toast.error(t("x001"));
      return;
    }
    await syncDineroToTimeTrackMutation.mutateAsync({
      contactIds: Array.from(selectedDineroContacts),
    });
  };

  const handleSyncEconomicToTimeTrack = async () => {
    if (selectedEconomicContacts.size === 0) {
      toast.error(t("x002"));
      return;
    }
    await syncEconomicToTimeTrackMutation.mutateAsync({
      customerNumbers: Array.from(selectedEconomicContacts).map(Number),
    });
  };

  const toggleEconomicContact = (id: string) => {
    setSelectedEconomicContacts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllEconomicContacts = () => {
    if (!importEconomicMutation.data) return;
    const selectable = importEconomicMutation.data.customers
      .filter((c) => !c.alreadyImported)
      .map((c) => String(c.customerNumber));
    setSelectedEconomicContacts(new Set(selectable));
  };

  const handleExportClients = async () => {
    if (selectedClientsToExport.size === 0) {
      toast.error(t("x002"));
      return;
    }

    setExportingClients(true);
    setExportResults(null);

    const results = { success: 0, failed: 0, errors: [] as string[] };
    const clientIds = Array.from(selectedClientsToExport);

    for (const clientId of clientIds) {
      try {
        if (exportTarget === "billy") {
          await exportClientToBillyMutation.mutateAsync({ clientId });
        } else if (exportTarget === "dinero") {
          await exportClientToDineroMutation.mutateAsync({ clientId });
        } else {
          await exportClientToEconomicMutation.mutateAsync({
            clientId,
            customerGroupNumber: 1,
            paymentTermsNumber: economicExportSettings?.paymentTermsNumber || 1,
          });
        }
        results.success++;
      } catch (error) {
        results.failed++;
        const clientName =
          clients?.find((c) => c.id === clientId)?.name || clientId;
        results.errors.push(`${clientName}: ${(error as Error).message}`);
      }
    }

    setExportResults(results);
    setExportingClients(false);

    if (results.success > 0) {
      toast.success(
        t("m.clientsExported", {
          count: results.success,
          target: exportTargetLabel[exportTarget],
        }),
      );
      setSelectedClientsToExport(new Set());
    }
    if (results.failed > 0) {
      toast.error(t("m.clientsExportFailed", { count: results.failed }));
    }
  };

  const handleExportInvoices = async () => {
    if (selectedInvoicesToExport.size === 0) {
      toast.error(t("x003"));
      return;
    }

    // For Billy/e-conomic, show settings modal first
    if (exportTarget === "billy") {
      setShowBillyExportModal(true);
      return;
    }
    if (exportTarget === "economic") {
      setShowEconomicExportModal(true);
      return;
    }

    // For Dinero, export directly
    await executeInvoiceExport();
  };

  const executeInvoiceExport = async (
    billySettings?: BillyExportSettings,
    econSettings?: EconomicExportSettings,
  ) => {
    setExportingInvoices(true);
    setExportResults(null);

    const results = { success: 0, failed: 0, errors: [] as string[] };
    const invoiceIds = Array.from(selectedInvoicesToExport);

    for (const invoiceId of invoiceIds) {
      try {
        if (exportTarget === "billy" && billySettings) {
          await exportInvoiceToBillyMutation.mutateAsync({
            invoiceId,
            action: billySettings.action,
            productId: billySettings.productId,
            paymentTermsDays: billySettings.paymentTermsDays,
            contactMessage: billySettings.contactMessage || undefined,
            lineType: billySettings.lineType,
            lineTemplate: billySettings.lineTemplate,
          });
        } else if (exportTarget === "economic") {
          await exportInvoiceToEconomicMutation.mutateAsync({
            invoiceId,
            paymentTermsNumber: econSettings?.paymentTermsNumber,
            layoutNumber: econSettings?.layoutNumber,
            productNumber: econSettings?.productNumber,
            autoBook: econSettings?.autoBook ?? false,
          });
        } else {
          await exportInvoiceToDineroMutation.mutateAsync({
            invoiceId,
            autoBook: true,
          });
        }
        results.success++;
      } catch (error) {
        results.failed++;
        const invoice = invoices?.find((i) => i.id === invoiceId);
        const invoiceName = invoice?.invoiceNumber || invoiceId;
        results.errors.push(
          t("m.invoiceError", {
            name: invoiceName,
            message: (error as Error).message,
          }),
        );
      }
    }

    setExportResults(results);
    setExportingInvoices(false);

    if (results.success > 0) {
      toast.success(
        t("m.invoicesExported", {
          count: results.success,
          target: exportTargetLabel[exportTarget],
        }),
      );
      setSelectedInvoicesToExport(new Set());
    }
    if (results.failed > 0) {
      toast.error(t("m.invoicesExportFailed", { count: results.failed }));
    }
  };

  const handleBillyExport = (settings: BillyExportSettings) => {
    setShowBillyExportModal(false);
    executeInvoiceExport(settings);
  };

  const toggleBillyContact = (contactId: string) => {
    const newSelected = new Set(selectedBillyContacts);
    if (newSelected.has(contactId)) {
      newSelected.delete(contactId);
    } else {
      newSelected.add(contactId);
    }
    setSelectedBillyContacts(newSelected);
  };

  const toggleDineroContact = (contactId: string) => {
    const newSelected = new Set(selectedDineroContacts);
    if (newSelected.has(contactId)) {
      newSelected.delete(contactId);
    } else {
      newSelected.add(contactId);
    }
    setSelectedDineroContacts(newSelected);
  };

  const selectAllBillyContacts = () => {
    if (!importBillyMutation.data) return;
    const selectableContacts = importBillyMutation.data.contacts.filter(
      (c) => !c.alreadyImported,
    );
    if (selectedBillyContacts.size === selectableContacts.length) {
      setSelectedBillyContacts(new Set());
    } else {
      setSelectedBillyContacts(new Set(selectableContacts.map((c) => c.id)));
    }
  };

  const selectAllDineroContacts = () => {
    if (!importDineroMutation.data) return;
    const selectableContacts = importDineroMutation.data.contacts.filter(
      (c) => !c.alreadyImported,
    );
    if (selectedDineroContacts.size === selectableContacts.length) {
      setSelectedDineroContacts(new Set());
    } else {
      setSelectedDineroContacts(
        new Set(selectableContacts.map((c) => c.contactGuid || "")),
      );
    }
  };

  const toggleClientToExport = (clientId: string) => {
    const newSelected = new Set(selectedClientsToExport);
    if (newSelected.has(clientId)) {
      newSelected.delete(clientId);
    } else {
      newSelected.add(clientId);
    }
    setSelectedClientsToExport(newSelected);
  };

  const toggleInvoiceToExport = (invoiceId: string) => {
    const newSelected = new Set(selectedInvoicesToExport);
    if (newSelected.has(invoiceId)) {
      newSelected.delete(invoiceId);
    } else {
      newSelected.add(invoiceId);
    }
    setSelectedInvoicesToExport(newSelected);
  };

  const selectAllClients = () => {
    if (!clients) return;
    const exportableClients = clients.filter((c) =>
      exportTarget === "billy"
        ? !c.billyId
        : exportTarget === "dinero"
          ? !c.dineroId
          : !c.economicCustomerNumber,
    );
    if (selectedClientsToExport.size === exportableClients.length) {
      setSelectedClientsToExport(new Set());
    } else {
      setSelectedClientsToExport(new Set(exportableClients.map((c) => c.id)));
    }
  };

  const selectAllInvoices = () => {
    if (!invoices) return;
    const exportableInvoices = invoices.filter(
      (i) =>
        i.status === "sent" &&
        (exportTarget === "billy"
          ? !i.billyInvoiceId
          : exportTarget === "dinero"
            ? !i.dineroInvoiceGuid
            : !i.economicInvoiceNumber),
    );
    if (selectedInvoicesToExport.size === exportableInvoices.length) {
      setSelectedInvoicesToExport(new Set());
    } else {
      setSelectedInvoicesToExport(new Set(exportableInvoices.map((i) => i.id)));
    }
  };

  const hasAnyIntegration =
    integrationStatus?.billyConnected ||
    integrationStatus?.dineroConnected ||
    integrationStatus?.economicConnected;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {t("x004")}
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          {t("m.description", { brand: brand.name })}
        </p>
      </div>

      {/* Integration Status */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div
          className={`rounded-lg border p-4 ${
            integrationStatus?.billyConnected
              ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
              : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500">
                <span className="text-lg font-bold text-white">B</span>
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">
                  Billy
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {integrationStatus?.billyConnected
                    ? t("m.connected")
                    : t("m.notConnected")}
                </p>
              </div>
            </div>
            {integrationStatus?.billyConnected ? (
              <CheckCircle2 className="h-6 w-6 text-green-500" />
            ) : (
              <XCircle className="h-6 w-6 text-gray-400" />
            )}
          </div>
        </div>

        <div
          className={`rounded-lg border p-4 ${
            integrationStatus?.dineroConnected
              ? integrationStatus.dineroTokenExpired
                ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20"
                : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
              : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500">
                <span className="text-lg font-bold text-white">D</span>
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">
                  Dinero
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {integrationStatus?.dineroConnected
                    ? integrationStatus.dineroTokenExpired
                      ? t("m.connectionExpired")
                      : t("m.connected")
                    : t("m.notConnected")}
                </p>
              </div>
            </div>
            {integrationStatus?.dineroConnected ? (
              integrationStatus.dineroTokenExpired ? (
                <AlertCircle className="h-6 w-6 text-amber-500" />
              ) : (
                <CheckCircle2 className="h-6 w-6 text-green-500" />
              )
            ) : (
              <XCircle className="h-6 w-6 text-gray-400" />
            )}
          </div>
        </div>

        <div
          className={`rounded-lg border p-4 ${
            integrationStatus?.economicConnected
              ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
              : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500">
                <Puzzle className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-white">
                  e-conomic
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {integrationStatus?.economicConnected
                    ? t("m.connected")
                    : t("m.notConnected")}
                </p>
              </div>
            </div>
            {integrationStatus?.economicConnected ? (
              <CheckCircle2 className="h-6 w-6 text-green-500" />
            ) : (
              <XCircle className="h-6 w-6 text-gray-400" />
            )}
          </div>
        </div>
      </div>

      {!hasAnyIntegration ? (
        /* No integrations configured */
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-12 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
            {t("x005")}
          </h3>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {t("x006")}
          </p>
          <Link
            href="/dashboard/settings/integrations"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
          >
            {t("x007")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="border-b border-gray-200 dark:border-gray-700">
            <nav className="-mb-px flex gap-6" aria-label="Tabs">
              <button
                type="button"
                onClick={() => setActiveTab("import")}
                className={`flex items-center gap-2 border-b-2 pb-4 text-sm font-medium transition-colors ${
                  activeTab === "import"
                    ? "border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                <ArrowDownToLine className="h-4 w-4" />
                {t("m.tabImport", { brand: brand.name })}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("export")}
                className={`flex items-center gap-2 border-b-2 pb-4 text-sm font-medium transition-colors ${
                  activeTab === "export"
                    ? "border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                <ArrowUpFromLine className="h-4 w-4" />
                {t("m.tabExport", { brand: brand.name })}
              </button>
            </nav>
          </div>

          {/* Import Tab */}
          {activeTab === "import" && (
            <div className="space-y-4">
              {/* Billy Import */}
              {integrationStatus?.billyConnected && (
                <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                  <div className="mb-6 flex items-start justify-between">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                        {t("x008")}
                      </h2>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        {t("x009")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleImportFromBilly}
                      disabled={importBillyMutation.isPending}
                      className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {importBillyMutation.isPending ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          {t("x010")}
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4" />
                          {t("x011")}
                        </>
                      )}
                    </button>
                  </div>

                  {importBillyMutation.data && (
                    <>
                      {/* Summary and controls */}
                      <div className="mb-4 rounded-lg bg-green-50 dark:bg-green-900/20 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <p className="text-sm text-green-800 dark:text-green-300">
                            {t.rich("m.contactsFound", {
                              count: importBillyMutation.data.count,
                              system: "Billy",
                              b: (chunks) => <strong>{chunks}</strong>,
                            })}
                            {importBillyMutation.data.importedCount > 0 && (
                              <span>
                                {t("m.alreadyImported", {
                                  count: importBillyMutation.data.importedCount,
                                })}
                              </span>
                            )}
                          </p>
                          <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 text-sm text-green-800 dark:text-green-300">
                              <input
                                type="checkbox"
                                checked={showOnlyNewBilly}
                                onChange={(e) =>
                                  setShowOnlyNewBilly(e.target.checked)
                                }
                                className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-2 focus:ring-green-500"
                              />
                              {t("x012")}
                            </label>
                            <button
                              type="button"
                              onClick={selectAllBillyContacts}
                              className="text-sm font-medium text-green-700 dark:text-green-400 hover:underline"
                            >
                              {selectedBillyContacts.size ===
                              importBillyMutation.data.contacts.filter(
                                (c) => !c.alreadyImported,
                              ).length
                                ? t("m.deselectAll")
                                : t("m.selectAll")}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="max-h-96 space-y-2 overflow-y-auto">
                        {importBillyMutation.data.contacts
                          .filter(
                            (contact) =>
                              !showOnlyNewBilly || !contact.alreadyImported,
                          )
                          .map((contact) => (
                            <div
                              key={contact.id}
                              className={`flex items-center gap-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4 transition-colors ${
                                contact.alreadyImported
                                  ? "opacity-50"
                                  : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedBillyContacts.has(contact.id)}
                                onChange={() => toggleBillyContact(contact.id)}
                                disabled={contact.alreadyImported}
                                className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="font-medium text-gray-900 dark:text-white">
                                    {contact.name}
                                  </p>
                                  {contact.alreadyImported && (
                                    <span className="inline-flex items-center gap-1 rounded bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs text-green-700 dark:text-green-400">
                                      <Check className="h-3 w-3" />
                                      {t("x013")}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
                                  {contact.contactPersons?.[0]?.email && (
                                    <span>
                                      {contact.contactPersons[0].email}
                                    </span>
                                  )}
                                  {contact.phone && (
                                    <span>{contact.phone}</span>
                                  )}
                                  {contact.registrationNo && (
                                    <span className="tabular-nums">
                                      {t("m.vat", {
                                        number: contact.registrationNo,
                                      })}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>

                      {selectedBillyContacts.size > 0 && (
                        <div className="mt-6 flex items-center justify-between rounded-lg bg-green-50 dark:bg-green-900/20 p-4">
                          <p className="text-sm font-medium text-green-900 dark:text-green-300">
                            {t("m.contactsSelected", {
                              count: selectedBillyContacts.size,
                            })}
                          </p>
                          <button
                            type="button"
                            onClick={handleSyncBillyToTimeTrack}
                            disabled={syncBillyToTimeTrackMutation.isPending}
                            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {syncBillyToTimeTrackMutation.isPending ? (
                              <>
                                <RefreshCw className="h-4 w-4 animate-spin" />
                                {t("m.importing")}
                              </>
                            ) : (
                              <>
                                <ArrowRight className="h-4 w-4" />
                                {t("m.importToBrand", { brand: brand.name })}
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Dinero Import */}
              {integrationStatus?.dineroConnected && (
                <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                  <div className="mb-6 flex items-start justify-between">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                        {t("x014")}
                      </h2>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        {t("x015")}
                      </p>
                    </div>
                    {integrationStatus.dineroTokenExpired ? (
                      <Link
                        href="/dashboard/settings/integrations"
                        className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
                      >
                        <AlertCircle className="h-4 w-4" />
                        {t("m.reconnect")}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={handleImportFromDinero}
                        disabled={importDineroMutation.isPending}
                        className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {importDineroMutation.isPending ? (
                          <>
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            {t("x010")}
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4" />
                            {t("x011")}
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {integrationStatus.dineroTokenExpired && (
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 mb-4">
                      <p className="text-sm text-amber-800 dark:text-amber-300">
                        {t.rich("m.dineroExpired", {
                          label: t("x016"),
                          link: (chunks) => (
                            <Link
                              href="/dashboard/settings/integrations"
                              className="font-medium underline"
                            >
                              {chunks}
                            </Link>
                          ),
                        })}
                      </p>
                    </div>
                  )}

                  {importDineroMutation.data && (
                    <>
                      <div className="mb-4 flex items-center justify-between rounded-lg bg-brand-50 dark:bg-tt-gran-lys p-4">
                        <p className="text-sm text-brand-800 dark:text-brand-300">
                          {t.rich("m.contactsFound", {
                            count: importDineroMutation.data.count,
                            system: "Dinero",
                            b: (chunks) => <strong>{chunks}</strong>,
                          })}
                          {importDineroMutation.data.importedCount > 0 &&
                            t("m.alreadyImported", {
                              count: importDineroMutation.data.importedCount,
                            })}
                        </p>
                        <button
                          type="button"
                          onClick={selectAllDineroContacts}
                          className="text-sm font-medium text-brand-700 hover:text-brand-900 dark:text-brand-300 dark:hover:text-brand-100"
                        >
                          {t("x017")}
                        </button>
                      </div>

                      <div className="max-h-[600px] space-y-2 overflow-y-auto">
                        {importDineroMutation.data.contacts.map((contact) => (
                          <div
                            key={contact.contactGuid}
                            className={`flex items-center gap-4 rounded-lg border p-4 transition-colors ${
                              contact.alreadyImported
                                ? "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 opacity-60"
                                : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedDineroContacts.has(
                                contact.contactGuid || "",
                              )}
                              disabled={contact.alreadyImported}
                              onChange={() =>
                                toggleDineroContact(contact.contactGuid || "")
                              }
                              className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-2 focus:ring-brand-500 disabled:cursor-not-allowed"
                            />
                            <div className="flex-1">
                              <p className="font-medium text-gray-900 dark:text-white">
                                {contact.name}
                              </p>
                              <div className="mt-1 flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
                                {contact.email && <span>{contact.email}</span>}
                                {contact.phone && <span>{contact.phone}</span>}
                                {contact.vatNumber && (
                                  <span className="tabular-nums">
                                    {t("m.vat", { number: contact.vatNumber })}
                                  </span>
                                )}
                              </div>
                            </div>
                            {contact.alreadyImported && (
                              <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
                                {t("x013")}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>

                      {selectedDineroContacts.size > 0 && (
                        <div className="mt-6 flex items-center justify-between rounded-lg bg-brand-50 dark:bg-tt-gran-lys p-4">
                          <p className="text-sm font-medium text-brand-900 dark:text-brand-300">
                            {t("m.contactsSelected", {
                              count: selectedDineroContacts.size,
                            })}
                          </p>
                          <button
                            type="button"
                            onClick={handleSyncDineroToTimeTrack}
                            disabled={syncDineroToTimeTrackMutation.isPending}
                            className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {syncDineroToTimeTrackMutation.isPending ? (
                              <>
                                <RefreshCw className="h-4 w-4 animate-spin" />
                                {t("m.importing")}
                              </>
                            ) : (
                              <>
                                <ArrowRight className="h-4 w-4" />
                                {t("m.importToBrand", { brand: brand.name })}
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* e-conomic Import */}
              {integrationStatus?.economicConnected && (
                <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                  <div className="mb-6 flex items-start justify-between">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                        {t("x018")}
                      </h2>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        {t("x019")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleImportFromEconomic}
                      disabled={importEconomicMutation.isPending}
                      className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {importEconomicMutation.isPending ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          {t("x010")}
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4" />
                          {t("x020")}
                        </>
                      )}
                    </button>
                  </div>

                  {importEconomicMutation.data && (
                    <>
                      <div className="mb-4 flex items-center justify-between rounded-lg bg-purple-50 dark:bg-purple-900/20 p-4">
                        <p className="text-sm text-purple-800 dark:text-purple-300">
                          {t.rich("m.clientsFound", {
                            count: importEconomicMutation.data.count,
                            system: "e-conomic",
                            b: (chunks) => <strong>{chunks}</strong>,
                          })}
                          {importEconomicMutation.data.importedCount > 0 &&
                            t("m.alreadyImported", {
                              count: importEconomicMutation.data.importedCount,
                            })}
                        </p>
                        <button
                          type="button"
                          onClick={selectAllEconomicContacts}
                          className="text-sm font-medium text-purple-700 hover:text-purple-900 dark:text-purple-300 dark:hover:text-purple-100"
                        >
                          {t("x017")}
                        </button>
                      </div>

                      <div className="max-h-[600px] space-y-2 overflow-y-auto">
                        {importEconomicMutation.data.customers.map(
                          (customer) => (
                            <div
                              key={customer.customerNumber}
                              className={`flex items-center gap-4 rounded-lg border p-4 transition-colors ${
                                customer.alreadyImported
                                  ? "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 opacity-60"
                                  : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedEconomicContacts.has(
                                  String(customer.customerNumber),
                                )}
                                disabled={customer.alreadyImported}
                                onChange={() =>
                                  toggleEconomicContact(
                                    String(customer.customerNumber),
                                  )
                                }
                                className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-2 focus:ring-purple-500 disabled:cursor-not-allowed"
                              />
                              <div className="flex-1">
                                <p className="font-medium text-gray-900 dark:text-white">
                                  {customer.name}
                                </p>
                                <div className="mt-1 flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
                                  {customer.email && (
                                    <span>{customer.email}</span>
                                  )}
                                  {customer.cvr && (
                                    <span className="tabular-nums">
                                      {t("m.vat", { number: customer.cvr })}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {customer.alreadyImported && (
                                <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
                                  {t("x013")}
                                </span>
                              )}
                            </div>
                          ),
                        )}
                      </div>

                      {selectedEconomicContacts.size > 0 && (
                        <div className="mt-6 flex items-center justify-between rounded-lg bg-purple-50 dark:bg-purple-900/20 p-4">
                          <p className="text-sm font-medium text-purple-900 dark:text-purple-300">
                            {t("m.clientsSelected", {
                              count: selectedEconomicContacts.size,
                            })}
                          </p>
                          <button
                            type="button"
                            onClick={handleSyncEconomicToTimeTrack}
                            disabled={syncEconomicToTimeTrackMutation.isPending}
                            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {syncEconomicToTimeTrackMutation.isPending ? (
                              <>
                                <RefreshCw className="h-4 w-4 animate-spin" />
                                {t("m.importing")}
                              </>
                            ) : (
                              <>
                                <ArrowRight className="h-4 w-4" />
                                {t("m.importToBrand", { brand: brand.name })}
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Export Tab */}
          {activeTab === "export" && (
            <div className="space-y-4">
              {/* Export Target Selector */}
              <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  {t("x021")}
                </span>
                <div className="flex gap-4">
                  {integrationStatus?.billyConnected && (
                    <button
                      type="button"
                      onClick={() => setExportTarget("billy")}
                      className={`flex items-center gap-3 rounded-lg border-2 px-4 py-3 transition-colors ${
                        exportTarget === "billy"
                          ? "border-green-500 bg-green-50 dark:bg-green-900/20"
                          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      }`}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500">
                        <span className="font-bold text-white">B</span>
                      </div>
                      <span className="font-medium text-gray-900 dark:text-white">
                        Billy
                      </span>
                      {exportTarget === "billy" && (
                        <Check className="h-5 w-5 text-green-500" />
                      )}
                    </button>
                  )}
                  {integrationStatus?.dineroConnected && (
                    <button
                      type="button"
                      onClick={() => setExportTarget("dinero")}
                      className={`flex items-center gap-3 rounded-lg border-2 px-4 py-3 transition-colors ${
                        exportTarget === "dinero"
                          ? "border-brand-500 bg-brand-50 dark:bg-tt-gran-lys"
                          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      }`}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500">
                        <span className="font-bold text-white">D</span>
                      </div>
                      <span className="font-medium text-gray-900 dark:text-white">
                        Dinero
                      </span>
                      {exportTarget === "dinero" && (
                        <Check className="h-5 w-5 text-brand-500 dark:text-brand-400" />
                      )}
                    </button>
                  )}
                  {integrationStatus?.economicConnected && (
                    <button
                      type="button"
                      onClick={() => setExportTarget("economic")}
                      className={`flex items-center gap-3 rounded-lg border-2 px-4 py-3 transition-colors ${
                        exportTarget === "economic"
                          ? "border-purple-500 bg-purple-50 dark:bg-purple-900/20"
                          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      }`}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500">
                        <Puzzle className="h-4 w-4 text-white" />
                      </div>
                      <span className="font-medium text-gray-900 dark:text-white">
                        e-conomic
                      </span>
                      {exportTarget === "economic" && (
                        <Check className="h-5 w-5 text-purple-500" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Export Results */}
              {exportResults && (
                <div
                  className={`rounded-lg border p-4 ${
                    exportResults.failed === 0
                      ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
                      : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {exportResults.failed === 0 ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    )}
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {t("m.exportResult", {
                          success: exportResults.success,
                          failed: exportResults.failed,
                        })}
                      </p>
                      {exportResults.errors.length > 0 && (
                        <ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
                          {exportResults.errors.map((error, idx) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                            <li key={idx}>• {error}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Export Clients */}
              <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <div className="mb-6 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-gray-400" />
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                        {t("x022")}
                      </h2>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {t("m.sendClients", {
                          brand: brand.name,
                          target: exportTargetLabel[exportTarget],
                        })}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={selectAllClients}
                    className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
                  >
                    {clients &&
                    selectedClientsToExport.size ===
                      clients.filter((c) =>
                        exportTarget === "billy"
                          ? !c.billyId
                          : exportTarget === "dinero"
                            ? !c.dineroId
                            : !c.economicCustomerNumber,
                      ).length
                      ? t("m.deselectAll")
                      : t("m.selectAll")}
                  </button>
                </div>

                {clientsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : clients && clients.length > 0 ? (
                  <>
                    <div className="max-h-80 space-y-2 overflow-y-auto">
                      {clients.map((client) => {
                        const alreadyExported =
                          exportTarget === "billy"
                            ? !!client.billyId
                            : exportTarget === "dinero"
                              ? !!client.dineroId
                              : !!client.economicCustomerNumber;
                        return (
                          <div
                            key={client.id}
                            className={`flex items-center gap-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4 transition-colors ${
                              alreadyExported
                                ? "opacity-50"
                                : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedClientsToExport.has(client.id)}
                              onChange={() => toggleClientToExport(client.id)}
                              disabled={alreadyExported}
                              className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-gray-900 dark:text-white">
                                  {client.name}
                                </p>
                                {alreadyExported && (
                                  <span className="inline-flex items-center gap-1 rounded bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs text-green-700 dark:text-green-400">
                                    <Check className="h-3 w-3" />
                                    {t("m.alreadyExported")}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
                                {client.email && <span>{client.email}</span>}
                                {client.cvrNumber && (
                                  <span className="tabular-nums">
                                    {t("m.vat", { number: client.cvrNumber })}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {selectedClientsToExport.size > 0 && (
                      <div className="mt-6 flex items-center justify-between rounded-lg bg-brand-50 dark:bg-tt-gran-lys p-4">
                        <p className="text-sm font-medium text-brand-900 dark:text-brand-300">
                          {t("m.clientsSelected", {
                            count: selectedClientsToExport.size,
                          })}
                        </p>
                        <button
                          type="button"
                          onClick={handleExportClients}
                          disabled={exportingClients}
                          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            exportTarget === "billy"
                              ? "bg-green-600 hover:bg-green-700"
                              : exportTarget === "dinero"
                                ? "bg-brand-600 hover:bg-brand-700"
                                : "bg-purple-600 hover:bg-purple-700"
                          }`}
                        >
                          {exportingClients ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              {t("m.exporting")}
                            </>
                          ) : (
                            <>
                              <Upload className="h-4 w-4" />
                              {t("m.exportTo", {
                                target: exportTargetLabel[exportTarget],
                              })}
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="py-8 text-center text-gray-500 dark:text-gray-400">
                    {t("x023")}
                  </p>
                )}
              </div>

              {/* Export Invoices */}
              <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
                <div className="mb-6 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-gray-400" />
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                        {t("x024")}
                      </h2>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {t("m.sendInvoices", {
                          brand: brand.name,
                          target: exportTargetLabel[exportTarget],
                        })}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={selectAllInvoices}
                    className="text-sm text-brand-600 dark:text-brand-400 hover:underline"
                  >
                    {invoices &&
                    selectedInvoicesToExport.size ===
                      invoices.filter(
                        (i) =>
                          i.status === "sent" &&
                          (exportTarget === "billy"
                            ? !i.billyInvoiceId
                            : !i.dineroInvoiceGuid),
                      ).length
                      ? t("m.deselectAll")
                      : t("m.selectAll")}
                  </button>
                </div>

                {invoicesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                ) : invoices && invoices.length > 0 ? (
                  <>
                    <div className="max-h-80 space-y-2 overflow-y-auto">
                      {invoices
                        .filter(
                          (invoice) =>
                            invoice.status === "sent" ||
                            invoice.status === "paid",
                        )
                        .map((invoice) => {
                          const alreadyExported =
                            exportTarget === "billy"
                              ? !!invoice.billyInvoiceId
                              : exportTarget === "dinero"
                                ? !!invoice.dineroInvoiceGuid
                                : !!invoice.economicInvoiceNumber;
                          return (
                            <div
                              key={invoice.id}
                              className={`flex items-center gap-4 rounded-lg border border-gray-200 dark:border-gray-700 p-4 transition-colors ${
                                alreadyExported
                                  ? "opacity-50"
                                  : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedInvoicesToExport.has(
                                  invoice.id,
                                )}
                                onChange={() =>
                                  toggleInvoiceToExport(invoice.id)
                                }
                                disabled={alreadyExported}
                                className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="font-medium text-gray-900 dark:text-white">
                                    {t("m.invoiceNumber", {
                                      number: invoice.invoiceNumber,
                                    })}
                                  </p>
                                  {alreadyExported && (
                                    <span className="inline-flex items-center gap-1 rounded bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs text-green-700 dark:text-green-400">
                                      <Check className="h-3 w-3" />
                                      {t("m.alreadyExported")}
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
                                  <span>
                                    {(Array.isArray(invoice.client)
                                      ? invoice.client[0]
                                      : invoice.client
                                    )?.name || t("m.unknownClient")}
                                  </span>
                                  <span>
                                    {Number(invoice.amount).toLocaleString(
                                      toIntlLocale(locale),
                                    )}{" "}
                                    kr
                                  </span>
                                  <span>
                                    {new Date(
                                      invoice.issueDate,
                                    ).toLocaleDateString(toIntlLocale(locale))}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>

                    {selectedInvoicesToExport.size > 0 && (
                      <div className="mt-6 flex items-center justify-between rounded-lg bg-brand-50 dark:bg-tt-gran-lys p-4">
                        <p className="text-sm font-medium text-brand-900 dark:text-brand-300">
                          {t("m.invoicesSelected", {
                            count: selectedInvoicesToExport.size,
                          })}
                        </p>
                        <button
                          type="button"
                          onClick={handleExportInvoices}
                          disabled={exportingInvoices}
                          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                            exportTarget === "billy"
                              ? "bg-green-600 hover:bg-green-700"
                              : exportTarget === "dinero"
                                ? "bg-brand-600 hover:bg-brand-700"
                                : "bg-purple-600 hover:bg-purple-700"
                          }`}
                        >
                          {exportingInvoices ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              {t("m.exporting")}
                            </>
                          ) : (
                            <>
                              <Upload className="h-4 w-4" />
                              {t("m.exportTo", {
                                target: exportTargetLabel[exportTarget],
                              })}
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="py-8 text-center text-gray-500 dark:text-gray-400">
                    {t("x025")}
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Help */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 p-6">
        <div className="flex items-start gap-4">
          <AlertCircle className="h-5 w-5 shrink-0 text-gray-500 dark:text-gray-400 mt-0.5" />
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white">
              {t("x026")}
            </h3>
            <ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
              <li>• {t("m.tip1")}</li>
              <li>• {t("m.tip2")}</li>
              <li>• {t("m.tip3")}</li>
              <li>• {t("m.tip4")}</li>
            </ul>
            <Link
              href="/dashboard/settings/integrations"
              className="mt-3 inline-flex items-center gap-1 text-sm text-brand-600 dark:text-brand-400 hover:underline"
            >
              {t("m.configure")}
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Billy Export Modal */}
      <BillyExportModal
        isOpen={showBillyExportModal}
        onClose={() => setShowBillyExportModal(false)}
        onExport={handleBillyExport}
        invoiceId={Array.from(selectedInvoicesToExport)[0] || ""}
        isLoading={exportingInvoices}
      />

      {/* e-conomic Export Modal */}
      <EconomicExportModal
        isOpen={showEconomicExportModal}
        onClose={() => setShowEconomicExportModal(false)}
        onExport={(settings) => {
          setEconomicExportSettings(settings);
          setShowEconomicExportModal(false);
          executeInvoiceExport(undefined, settings);
        }}
        isLoading={exportingInvoices}
      />
    </div>
  );
}
