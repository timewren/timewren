"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ClipboardList,
  Crown,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Shield,
  Trash2,
  UserCog,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { ConfirmDialog, Modal } from "@/components/ui";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { toIntlLocale } from "@/i18n/format-locale";
import { authClient, useSession } from "@/lib/auth-client";
import { clearPrivateCaches } from "@/lib/pwa/private-caches";
import { getAllowedDomains, parseOrgMetadata } from "@/lib/utils/org-metadata";
import { trpc } from "@/providers/trpc-provider";

// Role colors
const roleColors: Record<string, string> = {
  owner: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  admin: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  member: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, member: 2 };

const btnPrimary =
  "inline-flex items-center gap-2 rounded-lg bg-tt-gran px-3 py-1.5 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-50";
const btnSecondary =
  "inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800";
const inputCls =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-500";
const labelCls =
  "mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300";
const card =
  "rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900";

function RoleBadge({ role }: { role: string }) {
  const t = useTranslations("organization.page");
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${roleColors[role] ?? roleColors.member}`}
    >
      {role === "owner" && <Crown className="h-3 w-3" />}
      {role === "admin" && <Shield className="h-3 w-3" />}
      {["owner", "admin", "member"].includes(role) ? t(`role.${role}`) : role}
    </span>
  );
}

export default function OrganizationPage() {
  const t = useTranslations("organization.page");
  const intlLocale = toIntlLocale(useLocale());
  const roleLabel = (role: string) =>
    ["owner", "admin", "member"].includes(role) ? t(`role.${role}`) : role;
  const { data: session, isPending: sessionLoading } = useSession();
  const queryClient = useQueryClient();
  const utils = trpc.useUtils();
  const searchParams = useSearchParams();
  const { data: seatInfo } = trpc.organization.checkSeatAvailability.useQuery();
  const logAuditMutation = trpc.orgAudit.logAudit.useMutation();
  const transferMutation = trpc.organization.transferOwnership.useMutation({
    onSuccess: () => {
      toast.success(t("o001"));
      window.location.reload();
    },
    onError: (err) => toast.error(err.message),
  });

  // Organization state - types match Better-Auth API response
  type Organization = {
    id: string;
    name: string;
    slug: string;
    logo?: string | null;
    metadata?: Record<string, unknown>;
    createdAt: Date;
  };

  type Member = {
    id: string;
    userId: string;
    organizationId?: string;
    role: string;
    createdAt?: Date;
    user: {
      id: string;
      name: string;
      email: string;
      image?: string;
    };
  };

  type Invitation = {
    id: string;
    email: string;
    role: string;
    status: string;
    expiresAt: Date;
  };

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeOrg, setActiveOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [userRole, setUserRole] = useState<string | null>(null);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  // Dobbeltklik på "Send igen" må ikke sende to invitationsmails
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [memberMenuOpen, setMemberMenuOpen] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [removeMemberConfirmId, setRemoveMemberConfirmId] = useState<
    string | null
  >(null);
  const [transferTarget, setTransferTarget] = useState<{
    userId: string;
    name: string;
  } | null>(null);
  const [switching, setSwitching] = useState(false);

  // Form state
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgSlug, setNewOrgSlug] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [allowedDomains, setAllowedDomains] = useState("");
  const [orgName, setOrgName] = useState("");
  const [restrictClientAccess, setRestrictClientAccess] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  const isExpired = (inv: Invitation) =>
    !!inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now();

  const fetchOrgDetails = async (orgId: string) => {
    try {
      const result = await authClient.organization.getFullOrganization({
        query: { organizationId: orgId },
      });
      if (result.data) {
        setMembers(result.data.members || []);
        const currentMember = result.data.members?.find(
          (m) => m.userId === session?.user.id,
        );
        setUserRole(currentMember?.role || null);
        if (result.data.invitations) {
          setInvitations(result.data.invitations as unknown as Invitation[]);
        } else {
          setInvitations([]);
        }
      }
    } catch (error) {
      console.error("Failed to fetch org details:", error);
    }
  };

  // Fetch organizations
  // biome-ignore lint/correctness/useExhaustiveDependencies: kører kun, når brugerens id skifter; session og fetchOrgDetails får ny identitet hver render
  useEffect(() => {
    if (!session) return;

    const fetchOrganizations = async () => {
      try {
        const result = await authClient.organization.list();
        if (result.data) {
          setOrganizations(result.data);

          if (result.data.length > 0) {
            // Check if session already has an active org that's in our list
            const sessionData = session as Record<string, unknown>;
            const currentActiveId = sessionData.activeOrganizationId as
              | string
              | undefined;
            const activeInList = currentActiveId
              ? result.data.find((o) => o.id === currentActiveId)
              : null;

            const orgToActivate = activeInList || result.data[0];

            // Only call setActive if we need to change
            if (!activeInList) {
              window.dispatchEvent(new Event("org-switch-start"));
              await authClient.organization.setActive({
                organizationId: orgToActivate.id,
              });
              window.dispatchEvent(new Event("org-switch-end"));
            }

            setActiveOrg(orgToActivate);
            await fetchOrgDetails(orgToActivate.id);
          }
        }
      } catch (error) {
        console.error("Failed to fetch organizations:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchOrganizations();
  }, [session?.user?.id]);

  useEffect(() => {
    if (searchParams.get("create") === "true") {
      setShowCreateModal(true);
    }
  }, [searchParams]);

  // Luk medlemsmenuen ved klik udenfor / Escape
  useEffect(() => {
    if (!memberMenuOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-member-menu]")) setMemberMenuOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMemberMenuOpen(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [memberMenuOpen]);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await authClient.organization.create({
        name: newOrgName,
        slug: newOrgSlug || newOrgName.toLowerCase().replace(/\s+/g, "-"),
      });

      if (result.error) {
        toast.error(result.error.message || t("createFailed"));
        return;
      }

      const created = result.data;
      if (created) {
        setOrganizations((prev) => [...prev, created]);
        setActiveOrg(created);
        setShowCreateModal(false);
        setNewOrgName("");
        setNewOrgSlug("");
        toast.success(t("o002"));
        await fetchOrgDetails(result.data.id);
      }
    } catch (_error) {
      toast.error(t("o003"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg) return;

    setIsLoading(true);

    try {
      const result = await authClient.organization.inviteMember({
        email: inviteEmail,
        role: inviteRole as "admin" | "member",
        organizationId: activeOrg.id,
      });

      if (result.error) {
        toast.error(result.error.message || t("inviteFailed"));
        return;
      }

      toast.success(t("inviteSent", { email: inviteEmail }));
      logAuditMutation.mutate({
        action: "member_invited",
        targetEmail: inviteEmail,
        metadata: { role: inviteRole },
      });
      setShowInviteModal(false);
      setInviteEmail("");
      setInviteRole("member");
      await fetchOrgDetails(activeOrg.id);
      // A pending invitation consumes a seat — refresh the seat counter.
      utils.organization.checkSeatAvailability.invalidate();
    } catch (_error) {
      toast.error(t("o003"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveMember = (memberId: string) => {
    if (!activeOrg) return;
    setRemoveMemberConfirmId(memberId);
  };

  const handleCancelInvitation = async (invitationId: string) => {
    if (!activeOrg) return;

    try {
      await authClient.organization.cancelInvitation({
        invitationId,
      });
      toast.success(t("invitationCancelled"));
      const cancelledInv = invitations.find((i) => i.id === invitationId);
      logAuditMutation.mutate({
        action: "invitation_cancelled",
        targetEmail: cancelledInv?.email,
      });
      await fetchOrgDetails(activeOrg.id);
      // Cancelling frees the seat the pending invite held.
      utils.organization.checkSeatAvailability.invalidate();
    } catch (_error) {
      toast.error(t("o004"));
    }
  };

  const handleResendInvitation = async (invitation: Invitation) => {
    if (!activeOrg || resendingId) return;
    setResendingId(invitation.id);
    try {
      // Better-Auth genbruger kun en stadig gyldig invitation ved resend — en
      // udløbet ville ellers blive liggende som "pending" ved siden af den nye.
      if (isExpired(invitation)) {
        await authClient.organization.cancelInvitation({
          invitationId: invitation.id,
        });
      }
      const result = await authClient.organization.inviteMember({
        email: invitation.email,
        role: invitation.role as "admin" | "member",
        organizationId: activeOrg.id,
        resend: true,
      });
      if (result.error) {
        toast.error(result.error.message || t("resendFailed"));
        return;
      }
      toast.success(t("resent", { email: invitation.email }));
      await fetchOrgDetails(activeOrg.id);
      utils.organization.checkSeatAvailability.invalidate();
    } catch (_error) {
      toast.error(t("o005"));
    } finally {
      setResendingId(null);
    }
  };

  const handleUpdateDomains = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg) return;

    const domains = allowedDomains
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d);

    try {
      await authClient.organization.update({
        organizationId: activeOrg.id,
        data: {
          name: orgName,
          metadata: {
            // Parse first — Better-Auth stores metadata as a JSON string, and
            // spreading that string would corrupt it (wiping allowedDomains).
            ...parseOrgMetadata(activeOrg.metadata),
            allowedDomains: domains.length > 0 ? domains : undefined,
            restrictClientAccess,
          },
        },
      });
      toast.success(t("o006"));
      logAuditMutation.mutate({
        action: "org_updated",
        metadata: { field: "allowedDomains", domains },
      });
      setShowSettingsModal(false);
    } catch (_error) {
      toast.error(t("o007"));
    }
  };

  const handleUpdateMemberRole = async (newRole: "admin" | "member") => {
    if (!activeOrg || !selectedMember) return;

    try {
      await authClient.organization.updateMemberRole({
        organizationId: activeOrg.id,
        memberId: selectedMember.id,
        role: newRole,
      });
      toast.success(t("roleUpdated", { role: roleLabel(newRole) }));
      logAuditMutation.mutate({
        action: "member_role_changed",
        targetUserId: selectedMember.userId,
        metadata: {
          name: selectedMember.user.name,
          oldRole: selectedMember.role,
          newRole,
        },
      });
      setShowRoleModal(false);
      setSelectedMember(null);
      await fetchOrgDetails(activeOrg.id);
    } catch (_error) {
      toast.error(t("o008"));
    }
  };

  const handleDeleteOrganization = async () => {
    if (!activeOrg || deleteConfirmName !== activeOrg.name) return;

    try {
      await authClient.organization.delete({
        organizationId: activeOrg.id,
      });
      toast.success(t("o009"));
      setShowDeleteModal(false);
      setDeleteConfirmName("");

      // Remove from local state and switch to another org
      const remainingOrgs = organizations.filter((o) => o.id !== activeOrg.id);
      setOrganizations(remainingOrgs);

      if (remainingOrgs.length > 0) {
        setActiveOrg(remainingOrgs[0]);
        window.dispatchEvent(new Event("org-switch-start"));
        await authClient.organization.setActive({
          organizationId: remainingOrgs[0].id,
        });
        window.dispatchEvent(new Event("org-switch-end"));
        queryClient.clear();
        await fetchOrgDetails(remainingOrgs[0].id);
      } else {
        setActiveOrg(null);
        setMembers([]);
        setInvitations([]);
        // Clear active org from session to return to freelance mode
        try {
          await authClient.organization.setActive({ organizationId: "" });
        } catch {
          // Better-Auth may not support null/empty — that's OK,
          // isAuthed will fall back to makePermissiveModules
        }
        queryClient.clear();
      }
    } catch (_error) {
      toast.error(t("o010"));
    }
  };

  const handleLeaveOrganization = async () => {
    if (!activeOrg) return;

    try {
      // Find current user's member ID
      const currentMember = members.find((m) => m.userId === session?.user.id);
      if (!currentMember) {
        toast.error(t("o011"));
        return;
      }

      await authClient.organization.removeMember({
        organizationId: activeOrg.id,
        memberIdOrEmail: currentMember.id,
      });

      toast.success(t("o012"));
      setShowLeaveModal(false);

      // Remove from local state and switch to another org
      const remainingOrgs = organizations.filter((o) => o.id !== activeOrg.id);
      setOrganizations(remainingOrgs);

      if (remainingOrgs.length > 0) {
        setActiveOrg(remainingOrgs[0]);
        window.dispatchEvent(new Event("org-switch-start"));
        await authClient.organization.setActive({
          organizationId: remainingOrgs[0].id,
        });
        window.dispatchEvent(new Event("org-switch-end"));
        queryClient.clear();
        await fetchOrgDetails(remainingOrgs[0].id);
      } else {
        setActiveOrg(null);
        setMembers([]);
        setInvitations([]);
        // Clear active org from session to return to freelance mode
        try {
          await authClient.organization.setActive({ organizationId: "" });
        } catch {
          // Better-Auth may not support null/empty — that's OK,
          // isAuthed will fall back to makePermissiveModules
        }
        queryClient.clear();
      }
    } catch (_error) {
      toast.error(t("o013"));
    }
  };

  const switchOrganization = async (orgId: string) => {
    const org = organizations.find((o) => o.id === orgId);
    if (!org) return;

    setSwitching(true);
    window.dispatchEvent(new Event("org-switch-start"));
    try {
      await authClient.organization.setActive({ organizationId: orgId });
      await clearPrivateCaches();
      window.location.reload();
    } catch (_error) {
      toast.error(t("o014"));
      setSwitching(false);
      window.dispatchEvent(new Event("org-switch-end"));
    }
  };

  if (sessionLoading || isLoading || switching) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const canManageMembers = userRole === "owner" || userRole === "admin";
  const canManageSettings = userRole === "owner";

  // Søgning på tværs af aktive medlemmer + afventende invitationer (navn/email).
  const memberQuery = memberSearch.trim().toLowerCase();
  const filteredMembers = (
    memberQuery
      ? members.filter(
          (m) =>
            m.user.name?.toLowerCase().includes(memberQuery) ||
            m.user.email?.toLowerCase().includes(memberQuery),
        )
      : members
  )
    .slice()
    // Ejer øverst, så admins, så medlemmer — og alfabetisk indenfor rollen
    .sort(
      (a, b) =>
        (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) ||
        ((a.user.name || a.user.email) ?? "").localeCompare(
          (b.user.name || b.user.email) ?? "",
          "da",
        ),
    );
  const pendingInvitations = invitations.filter(
    (inv) =>
      inv.status === "pending" &&
      (!memberQuery || inv.email?.toLowerCase().includes(memberQuery)),
  );
  // Samme kilde som pladstallet (serveren filtrerer udløbne, #565), så de
  // to nøgletal ikke kan være uenige; lokal optælling kun som fallback.
  const activeInvitationCount =
    seatInfo?.pendingInvites ??
    invitations.filter((inv) => inv.status === "pending" && !isExpired(inv))
      .length;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title={t("o015")}
        description={t("o016")}
        actions={
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className={btnSecondary}
          >
            <Plus className="h-4 w-4" />
            {t("o017")}
          </button>
        }
      />

      {organizations.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
          <Building2 className="mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {t("o018")}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("o019")}
          </p>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className={`${btnPrimary} mt-4`}
          >
            <Plus className="h-4 w-4" />
            {t("o020")}
          </button>
        </div>
      ) : (
        <>
          {organizations.length > 1 && (
            <div className={`${card} flex flex-wrap items-center gap-3 p-4`}>
              <label
                htmlFor="activeOrg"
                className="text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                {t("o021")}
              </label>
              <select
                id="activeOrg"
                value={activeOrg?.id || ""}
                onChange={(e) => switchOrganization(e.target.value)}
                className={`${inputCls} max-w-xs appearance-none pr-8`}
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {activeOrg && (
            <>
              {/* Organisation */}
              <div className={`${card} p-5`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                      <Building2 className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                          {activeOrg.name}
                        </h2>
                        <RoleBadge role={userRole || "member"} />
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        @{activeOrg.slug}
                        {activeOrg.createdAt &&
                          t("createdOn", {
                            date: new Date(
                              activeOrg.createdAt,
                            ).toLocaleDateString(intlLocale),
                          })}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canManageMembers && (
                      <>
                        <Link
                          href="/dashboard/organization/permissions"
                          className={btnSecondary}
                        >
                          <KeyRound className="h-4 w-4" />
                          {t("o022")}
                        </Link>
                        <Link
                          href="/dashboard/organization/audit"
                          className={btnSecondary}
                        >
                          <ClipboardList className="h-4 w-4" />
                          {t("o023")}
                        </Link>
                      </>
                    )}
                    {canManageSettings && (
                      <button
                        type="button"
                        onClick={() => {
                          const domains = getAllowedDomains(activeOrg.metadata);
                          setAllowedDomains(domains.join(", "));
                          setOrgName(activeOrg.name);
                          setRestrictClientAccess(
                            parseOrgMetadata(activeOrg.metadata)
                              .restrictClientAccess === true,
                          );
                          setShowSettingsModal(true);
                        }}
                        className={btnSecondary}
                      >
                        <Settings className="h-4 w-4" />
                        {t("o024")}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Nøgletal */}
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-gray-200 lg:grid-cols-4 dark:bg-gray-800">
                <div className="bg-white p-4 dark:bg-gray-900">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t("o025")}
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
                    {members.length}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {t("adminCount", {
                      count: members.filter((m) => m.role !== "member").length,
                    })}
                  </div>
                </div>
                <div className="bg-white p-4 dark:bg-gray-900">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t("o026")}
                  </div>
                  <div
                    className={`mt-1 text-2xl font-bold tabular-nums ${
                      activeInvitationCount > 0
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-gray-900 dark:text-white"
                    }`}
                  >
                    {activeInvitationCount}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {t("o027")}
                  </div>
                </div>
                <div className="bg-white p-4 dark:bg-gray-900">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t("o028")}
                  </div>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
                    {seatInfo ? (
                      <>
                        {seatInfo.seatsUsed}
                        <span className="text-base font-normal text-gray-400 dark:text-gray-500">
                          {" "}
                          {seatInfo.billingEnabled !== false &&
                            t("seatsMax", { max: seatInfo.maxSeats })}
                        </span>
                      </>
                    ) : (
                      "–"
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {seatInfo?.canAutoExpand
                      ? t("seatsAutoExpand")
                      : seatInfo && !seatInfo.canInvite
                        ? t("seatsNone")
                        : t("seatsInUse")}
                  </div>
                </div>
                {seatInfo?.billingEnabled !== false && (
                  <div className="bg-white p-4 dark:bg-gray-900">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {t("o029")}
                    </div>
                    <div className="mt-1 text-2xl font-bold capitalize text-gray-900 dark:text-white">
                      {seatInfo?.planTier ?? "–"}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      <Link
                        href="/dashboard/settings/subscription"
                        className="hover:underline"
                      >
                        {t("o030")}
                      </Link>
                    </div>
                  </div>
                )}
              </div>

              {/* Medlemmer */}
              <div className={`${card} overflow-hidden`}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-gray-400" />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                      {t("o025")}
                    </h3>
                    <span className="text-xs tabular-nums text-gray-400">
                      {members.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {(members.length > 5 || memberQuery) && (
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                        <input
                          type="search"
                          value={memberSearch}
                          onChange={(e) => setMemberSearch(e.target.value)}
                          placeholder={t("o031")}
                          aria-label={t("o032")}
                          className={`${inputCls} w-56 py-1 pl-8 text-xs`}
                        />
                      </div>
                    )}
                    {canManageMembers && (
                      <button
                        type="button"
                        onClick={() => setShowInviteModal(true)}
                        className={btnPrimary}
                      >
                        <UserPlus className="h-4 w-4" />
                        {t("inviteShort")}
                      </button>
                    )}
                  </div>
                </div>

                <div className="divide-y divide-gray-100 dark:divide-gray-800/50">
                  <div
                    aria-hidden="true"
                    className="flex items-center px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                  >
                    <div className="min-w-0 flex-1">{t("o033")}</div>
                    <div className="hidden w-32 text-right md:block">
                      {t("o034")}
                    </div>
                    <div className="w-32 text-right">{t("o035")}</div>
                    {canManageMembers && <div className="w-9" />}
                  </div>
                  {filteredMembers.length === 0 && (
                    <p className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                      {t("noMemberMatch", { query: memberSearch })}
                    </p>
                  )}
                  {filteredMembers.map((member) => {
                    const isSelf = member.userId === session?.user.id;
                    const canEdit =
                      canManageMembers && member.role !== "owner" && !isSelf;
                    return (
                      <div
                        key={member.id}
                        className="flex items-center px-4 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3 pr-3">
                          <UserAvatar
                            name={member.user.name}
                            image={member.user.image}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                              {member.user.name}
                              {isSelf && (
                                <span className="ml-1.5 text-xs font-normal text-gray-400">
                                  {t("youLabel")}
                                </span>
                              )}
                            </p>
                            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                              {member.user.email}
                            </p>
                          </div>
                        </div>
                        <div className="hidden w-32 text-right text-xs tabular-nums text-gray-500 md:block dark:text-gray-400">
                          {member.createdAt
                            ? new Date(member.createdAt).toLocaleDateString(
                                intlLocale,
                              )
                            : "–"}
                        </div>
                        <div className="flex w-32 justify-end">
                          <RoleBadge role={member.role} />
                        </div>
                        {canManageMembers && (
                          <div className="flex w-9 justify-end">
                            {canEdit && (
                              <div className="relative" data-member-menu>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setMemberMenuOpen(
                                      memberMenuOpen === member.id
                                        ? null
                                        : member.id,
                                    )
                                  }
                                  aria-label={t("memberActions", {
                                    name:
                                      member.user?.name ||
                                      member.user?.email ||
                                      "",
                                  })}
                                  aria-expanded={memberMenuOpen === member.id}
                                  aria-haspopup="menu"
                                  className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </button>
                                {memberMenuOpen === member.id && (
                                  <div
                                    role="menu"
                                    className="absolute right-0 z-10 mt-1 w-48 rounded-xl border border-gray-200/80 bg-white py-1 shadow-lg dark:border-gray-800 dark:bg-gray-900"
                                  >
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setSelectedMember(member);
                                        setShowRoleModal(true);
                                        setMemberMenuOpen(null);
                                      }}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                                    >
                                      <UserCog className="h-4 w-4" />
                                      {t("o036")}
                                    </button>
                                    {userRole === "owner" && (
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          setMemberMenuOpen(null);
                                          setTransferTarget({
                                            userId: member.userId,
                                            name:
                                              member.user?.name ||
                                              member.user?.email ||
                                              "ukendt",
                                          });
                                        }}
                                        disabled={transferMutation.isPending}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
                                      >
                                        <Crown className="h-4 w-4" />
                                        {t("o037")}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        handleRemoveMember(member.id);
                                        setMemberMenuOpen(null);
                                      }}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                                    >
                                      <UserMinus className="h-4 w-4" />
                                      {t("o038")}
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Afventende invitationer */}
              {pendingInvitations.length > 0 && (
                <div className={`${card} overflow-hidden`}>
                  <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                    <Mail className="h-4 w-4 text-gray-400" />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                      {t("pendingInvitations")}
                    </h3>
                    <span className="text-xs tabular-nums text-gray-400">
                      {pendingInvitations.length}
                    </span>
                  </div>
                  <div className="divide-y divide-gray-100 dark:divide-gray-800/50">
                    {pendingInvitations.map((invitation) => {
                      const expired = isExpired(invitation);
                      return (
                        <div
                          key={invitation.id}
                          className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${
                            expired ? "border-l-[3px] border-l-amber-500" : ""
                          }`}
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                            <Mail className="h-3.5 w-3.5 text-gray-400" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                              {invitation.email}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {t("invitedAs", {
                                role: roleLabel(invitation.role),
                              })}
                              {invitation.expiresAt && (
                                <>
                                  {" · "}
                                  {expired ? (
                                    <span className="font-medium text-amber-600 dark:text-amber-400">
                                      {t("expiredOn", {
                                        date: new Date(
                                          invitation.expiresAt,
                                        ).toLocaleDateString(intlLocale),
                                      })}
                                    </span>
                                  ) : (
                                    t("expiresOn", {
                                      date: new Date(
                                        invitation.expiresAt,
                                      ).toLocaleDateString(intlLocale),
                                    })
                                  )}
                                </>
                              )}
                            </p>
                          </div>
                          {expired && (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              {t("o039")}
                            </span>
                          )}
                          {canManageMembers && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  handleResendInvitation(invitation)
                                }
                                disabled={resendingId === invitation.id}
                                className="rounded-md px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50 dark:text-brand-400 dark:hover:bg-tt-gran-lys"
                              >
                                {resendingId === invitation.id
                                  ? t("sending")
                                  : t("resend")}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCancelInvitation(invitation.id)
                                }
                                className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                              >
                                {t("o040")}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <PeriodLockCard />

              {/* Farezone */}
              {(userRole !== "owner" || canManageSettings) && (
                <div className={`${card} p-5`}>
                  <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
                    {t("o041")}
                  </h3>
                  <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                    {userRole !== "owner" && (
                      <div className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">
                            {t("o042")}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {t("o043")}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowLeaveModal(true)}
                          className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20"
                        >
                          <LogOut className="h-4 w-4" />
                          {t("o044")}
                        </button>
                      </div>
                    )}
                    {canManageSettings && (
                      <div className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">
                            {t("o045")}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {t("o046")}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowDeleteModal(true)}
                          className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20"
                        >
                          <Trash2 className="h-4 w-4" />
                          {t("o047")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Opret organisation */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title={t("o048")}
        description={t("o049")}
      >
        <form onSubmit={handleCreateOrg} className="space-y-4">
          <div>
            <label htmlFor="newOrgName" className={labelCls}>
              {t("o050")}
            </label>
            <input
              id="newOrgName"
              type="text"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              required
              className={inputCls}
              placeholder={t("orgNamePlaceholder")}
            />
          </div>
          <div>
            <label htmlFor="newOrgSlug" className={labelCls}>
              {t("slugOptional")}
            </label>
            <input
              id="newOrgSlug"
              type="text"
              value={newOrgSlug}
              onChange={(e) =>
                setNewOrgSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))
              }
              className={inputCls}
              placeholder="min-virksomhed"
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-800">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className={btnSecondary}
            >
              {t("o040")}
            </button>
            <button type="submit" disabled={isLoading} className={btnPrimary}>
              {isLoading ? t("creating") : t("create")}
            </button>
          </div>
        </form>
      </Modal>

      {/* Invitér medlem */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title={t("o051")}
        description={t("o052")}
      >
        <form onSubmit={handleInviteMember} className="space-y-4">
          {seatInfo && (
            <div
              className={`rounded-lg px-3 py-2 text-xs ${
                seatInfo.canInvite
                  ? "bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  : "bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
              }`}
            >
              <span className="tabular-nums">
                {seatInfo.billingEnabled === false
                  ? seatInfo.seatsUsed
                  : t("seatsUsedOf", {
                      used: seatInfo.seatsUsed,
                      max: seatInfo.maxSeats,
                    })}
              </span>{" "}
              {t("seatsInUseLabel")}
              {seatInfo.pendingInvites > 0 && (
                <span className="text-gray-500 dark:text-gray-400">
                  {" "}
                  {t("pendingOf", { count: seatInfo.pendingInvites })}
                </span>
              )}
              .
              {/* Team/Business køber bare flere pladser — "opgrader"
                  fik en bruger (kunde A, Team) til at tro at kun en
                  dyrere plan gav flere brugere. */}
              {seatInfo.canAutoExpand &&
                seatInfo.seatsUsed >= seatInfo.maxSeats && (
                  <span>
                    {" "}
                    {t("autoExpandInfo", {
                      price: seatInfo.seatPrice,
                      period:
                        seatInfo.seatPriceCycle === "yearly"
                          ? t("periodYear")
                          : t("periodMonth"),
                    })}
                  </span>
                )}
              {!seatInfo.canInvite &&
                (seatInfo.planTier === "team" ||
                seatInfo.planTier === "business" ? (
                  <Link
                    href="/dashboard/settings/subscription#pladser"
                    className="ml-1 font-medium underline"
                  >
                    {t("o053")}
                  </Link>
                ) : (
                  <Link
                    href="/dashboard/settings/subscription"
                    className="ml-1 font-medium underline"
                  >
                    {seatInfo.planTier === "free"
                      ? t("freeSeats", { max: seatInfo.maxSeats })
                      : t("switchToTeam")}
                  </Link>
                ))}
            </div>
          )}
          <div>
            <label htmlFor="inviteEmail" className={labelCls}>
              {t("o054")}
            </label>
            <input
              id="inviteEmail"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              className={inputCls}
              placeholder="kollega@email.dk"
            />
          </div>
          <div>
            <label htmlFor="inviteRole" className={labelCls}>
              {t("o035")}
            </label>
            <select
              id="inviteRole"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className={`${inputCls} appearance-none pr-8`}
            >
              <option value="member">{t("o033")}</option>
              <option value="admin">{t("o055")}</option>
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {inviteRole === "admin"
                ? t("adminRoleHint")
                : t("memberRoleHint")}
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-800">
            <button
              type="button"
              onClick={() => setShowInviteModal(false)}
              className={btnSecondary}
            >
              {t("o040")}
            </button>
            <button
              type="submit"
              disabled={isLoading || (!!seatInfo && !seatInfo.canInvite)}
              className={btnPrimary}
            >
              {isLoading ? t("sending") : t("sendInvitation")}
            </button>
          </div>
        </form>
      </Modal>

      {/* Indstillinger */}
      <Modal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        title={t("o056")}
      >
        <form onSubmit={handleUpdateDomains} className="space-y-4">
          <div>
            <label htmlFor="orgName" className={labelCls}>
              {t("o050")}
            </label>
            <input
              id="orgName"
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              required
              className={inputCls}
              placeholder={t("o057")}
            />
          </div>
          <div>
            <label htmlFor="allowedDomains" className={labelCls}>
              {t("o058")}
            </label>
            <input
              id="allowedDomains"
              type="text"
              value={allowedDomains}
              onChange={(e) => setAllowedDomains(e.target.value)}
              className={inputCls}
              placeholder={t("domainsPlaceholder")}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t("o059")}
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <input
              type="checkbox"
              checked={restrictClientAccess}
              onChange={(e) => setRestrictClientAccess(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900 dark:text-white">
                {t("o060")}
              </span>
              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                {t("o061")}
              </span>
            </span>
          </label>

          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-800">
            <button
              type="button"
              onClick={() => setShowSettingsModal(false)}
              className={btnSecondary}
            >
              {t("o040")}
            </button>
            <button type="submit" className={btnPrimary}>
              {t("o062")}
            </button>
          </div>
        </form>
      </Modal>

      {/* Skift rolle */}
      <Modal
        isOpen={showRoleModal && !!selectedMember}
        onClose={() => {
          setShowRoleModal(false);
          setSelectedMember(null);
        }}
        title={
          selectedMember
            ? t("changeRoleFor", { name: selectedMember.user.name })
            : t("changeRole")
        }
        description={
          selectedMember
            ? t("currentRole", { role: roleLabel(selectedMember.role) })
            : undefined
        }
      >
        {selectedMember && (
          <div className="space-y-2">
            {(
              [
                {
                  role: "admin",
                  icon: Shield,
                  title: t("role.admin"),
                  text: t("roleAdminText"),
                },
                {
                  role: "member",
                  icon: Users,
                  title: t("role.member"),
                  text: t("roleMemberText"),
                },
              ] as const
            ).map((opt) => {
              const current = selectedMember.role === opt.role;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.role}
                  type="button"
                  onClick={() => handleUpdateMemberRole(opt.role)}
                  disabled={current}
                  aria-pressed={current}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    current
                      ? "cursor-default border-brand-500 bg-brand-50 dark:bg-tt-gran-lys"
                      : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
                  <span>
                    <span className="block text-sm font-medium text-gray-900 dark:text-white">
                      {opt.title}
                      {current && (
                        <span className="ml-1.5 text-xs font-normal text-gray-400">
                          {t("o063")}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {opt.text}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Modal>

      {/* Slet organisation */}
      <ConfirmDialog
        isOpen={showDeleteModal && !!activeOrg}
        onClose={() => {
          setShowDeleteModal(false);
          setDeleteConfirmName("");
        }}
        onConfirm={handleDeleteOrganization}
        title={t("deleteTitle", {
          name: activeOrg?.name ?? t("organisationFallback"),
        })}
        description={
          <div className="space-y-3">
            <p>{t("o064")}</p>
            <div>
              <label htmlFor="deleteConfirmName" className={labelCls}>
                {t.rich("typeToConfirm", {
                  name: activeOrg?.name ?? "",
                  b: (chunks) => (
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {chunks}
                    </span>
                  ),
                })}
              </label>
              <input
                id="deleteConfirmName"
                type="text"
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                className={inputCls}
                placeholder={t("o050")}
              />
            </div>
          </div>
        }
        confirmLabel={t("o065")}
        variant="danger"
        confirmDisabled={!activeOrg || deleteConfirmName !== activeOrg.name}
      />

      {/* Forlad organisation */}
      <ConfirmDialog
        isOpen={showLeaveModal && !!activeOrg}
        onClose={() => setShowLeaveModal(false)}
        onConfirm={handleLeaveOrganization}
        title={t("leaveTitle", {
          name: activeOrg?.name ?? t("theOrganisation"),
        })}
        description={t("o066")}
        confirmLabel={t("o042")}
        variant="warning"
      />

      {/* Overfør ejerskab */}
      <ConfirmDialog
        isOpen={!!transferTarget}
        onClose={() => setTransferTarget(null)}
        onConfirm={() => {
          if (!transferTarget) return;
          transferMutation.mutate({ targetUserId: transferTarget.userId });
          setTransferTarget(null);
        }}
        title={t("o037")}
        description={
          <p>
            {t.rich("transferBody", {
              name: transferTarget?.name ?? "",
              b: (chunks) => (
                <span className="font-medium text-gray-900 dark:text-white">
                  {chunks}
                </span>
              ),
            })}
          </p>
        }
        confirmLabel={t("o037")}
        variant="warning"
        isLoading={transferMutation.isPending}
      />

      {/* Fjern medlem */}
      <ConfirmDialog
        isOpen={!!removeMemberConfirmId}
        onClose={() => setRemoveMemberConfirmId(null)}
        onConfirm={async () => {
          if (!activeOrg || !removeMemberConfirmId) return;
          try {
            await authClient.organization.removeMember({
              memberIdOrEmail: removeMemberConfirmId,
              organizationId: activeOrg.id,
            });
            toast.success(t("o067"));
            const removedMember = members.find(
              (m) => m.id === removeMemberConfirmId,
            );
            logAuditMutation.mutate({
              action: "member_removed",
              targetUserId: removedMember?.userId,
              metadata: { name: removedMember?.user?.name },
            });
            await fetchOrgDetails(activeOrg.id);
            // Removing a member frees a seat.
            utils.organization.checkSeatAvailability.invalidate();
          } catch (_error) {
            toast.error(t("o068"));
          }
          setRemoveMemberConfirmId(null);
        }}
        title={t("o038")}
        description={
          <p>
            {t("removeBody", {
              name:
                members.find((m) => m.id === removeMemberConfirmId)?.user
                  .name ?? t("memberFallback"),
            })}
          </p>
        }
        confirmLabel={t("o069")}
        variant="danger"
      />
    </div>
  );
}

/** Org-periodelås (#144): "luk marts" — kun owner/admin kan sætte den */
function PeriodLockCard() {
  const t = useTranslations("organization.page");
  const intlLocale = toIntlLocale(useLocale());
  const utils = trpc.useUtils();
  const { data: lock } = trpc.organization.getPeriodLock.useQuery();
  const [draft, setDraft] = useState("");
  const setLock = trpc.organization.setPeriodLock.useMutation({
    onSuccess: () => {
      utils.organization.getPeriodLock.invalidate();
      toast.success(t("o070"));
      setDraft("");
    },
    onError: (e) => toast.error(e.message),
  });

  if (!lock) return null;

  return (
    <div className={`${card} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("o071")}
        </h2>
        {lock.lockedBefore ? (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            {t("lockedBefore", {
              date: new Date(lock.lockedBefore).toLocaleDateString(intlLocale),
            })}
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {t("o072")}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {t("o073")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={draft}
          aria-label={t("o074")}
          onChange={(e) => setDraft(e.target.value)}
          className={inputCls.replace("w-full ", "")}
        />
        <button
          type="button"
          disabled={!draft || setLock.isPending}
          onClick={() => setLock.mutate({ lockedBefore: draft })}
          className={btnPrimary}
        >
          {t("o075")}
        </button>
        {lock.lockedBefore && (
          <button
            type="button"
            disabled={setLock.isPending}
            onClick={() => setLock.mutate({ lockedBefore: null })}
            className={btnSecondary}
          >
            {t("o076")}
          </button>
        )}
      </div>
    </div>
  );
}
