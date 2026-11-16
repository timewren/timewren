import { Clock } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
  goToShortcutFor,
  goToShortcuts,
  isAclLoading,
  isNavItemVisible,
  mainNavGroups,
  mobileBottomNavItems,
  type NavItem,
  resolveEnterpriseMember,
  settingsNavItem,
} from "./navigation-config";

const base: NavItem = { name: "Test", href: "/x", icon: Clock };
const allOn = { isFlagEnabled: () => true, isModuleEnabled: () => true };
const allOff = { isFlagEnabled: () => false, isModuleEnabled: () => false };

describe("isNavItemVisible", () => {
  it("viser items uden flag eller modul", () => {
    expect(isNavItemVisible(base, allOff)).toBe(true);
  });

  it("skjuler item når feature-flag er slukket", () => {
    const item = { ...base, featureFlag: "ai" };
    expect(isNavItemVisible(item, allOff)).toBe(false);
    expect(isNavItemVisible(item, allOn)).toBe(true);
  });

  it("skjuler item når modul er slukket", () => {
    const item = { ...base, requiresModule: "klippekort" as const };
    expect(isNavItemVisible(item, allOff)).toBe(false);
    expect(isNavItemVisible(item, allOn)).toBe(true);
  });

  it("kræver at BÅDE flag og modul er tændt", () => {
    const item = {
      ...base,
      featureFlag: "prepaidPackages",
      requiresModule: "klippekort" as const,
    };
    expect(
      isNavItemVisible(item, {
        isFlagEnabled: () => true,
        isModuleEnabled: () => false,
      }),
    ).toBe(false);
  });

  describe("minRole", () => {
    const managerItem: NavItem = { ...base, minRole: "manager" };
    const adminItem: NavItem = { ...base, minRole: "admin" };

    it("skjuler manager-items for member og ukendt rolle", () => {
      expect(isNavItemVisible(managerItem, { ...allOn, role: "member" })).toBe(
        false,
      );
      expect(isNavItemVisible(managerItem, allOn)).toBe(false);
    });

    it("viser manager-items for manager, admin og owner", () => {
      expect(isNavItemVisible(managerItem, { ...allOn, role: "manager" })).toBe(
        true,
      );
      expect(isNavItemVisible(managerItem, { ...allOn, role: "admin" })).toBe(
        true,
      );
      expect(isNavItemVisible(managerItem, { ...allOn, role: "owner" })).toBe(
        true,
      );
    });

    it("skjuler admin-items for manager, viser for admin/owner", () => {
      expect(isNavItemVisible(adminItem, { ...allOn, role: "manager" })).toBe(
        false,
      );
      expect(isNavItemVisible(adminItem, { ...allOn, role: "admin" })).toBe(
        true,
      );
      expect(isNavItemVisible(adminItem, { ...allOn, role: "owner" })).toBe(
        true,
      );
    });
  });

  describe("freelancerOnly", () => {
    const item: NavItem = { ...base, freelancerOnly: true };

    it("skjules for member/manager i enterprise-profil", () => {
      expect(
        isNavItemVisible(item, {
          ...allOn,
          role: "member",
          orgProfile: "enterprise",
        }),
      ).toBe(false);
      expect(
        isNavItemVisible(item, {
          ...allOn,
          role: "manager",
          orgProfile: "enterprise",
        }),
      ).toBe(false);
    });

    it("vises for admin/owner i enterprise-profil", () => {
      expect(
        isNavItemVisible(item, {
          ...allOn,
          role: "admin",
          orgProfile: "enterprise",
        }),
      ).toBe(true);
      expect(
        isNavItemVisible(item, {
          ...allOn,
          role: "owner",
          orgProfile: "enterprise",
        }),
      ).toBe(true);
    });

    it("vises for alle roller i freelance-profil", () => {
      for (const role of ["member", "manager", "admin", "owner"] as const) {
        expect(
          isNavItemVisible(item, { ...allOn, role, orgProfile: "freelance" }),
        ).toBe(true);
      }
      expect(isNavItemVisible(item, allOn)).toBe(true);
    });
  });
});

describe("mainNavGroups", () => {
  it("gater Enterprise-lederpunkter med minRole", () => {
    const enterprise = mainNavGroups.find((g) => g.label === "Enterprise");
    const minRoleOf = (href: string) =>
      enterprise?.items.find((i) => i.href === href)?.minRole;
    expect(minRoleOf("/dashboard/enterprise/team")).toBe("manager");
    expect(minRoleOf("/dashboard/enterprise/reports")).toBe("manager");
    expect(minRoleOf("/dashboard/enterprise/employees")).toBe("manager");
    expect(minRoleOf("/dashboard/enterprise/settings")).toBe("admin");
    // Medarbejderens egne sider har ingen rollegate
    expect(minRoleOf("/dashboard/enterprise/timesheet")).toBeUndefined();
    expect(minRoleOf("/dashboard/enterprise/overtime")).toBeUndefined();
    expect(minRoleOf("/dashboard/enterprise/absence")).toBeUndefined();
  });

  it("har et Projekter-punkt i Kunder-gruppen der peger på projektlisten", () => {
    const clientsGroup = mainNavGroups.find((g) => g.label === "Kunder");
    const projectsItem = clientsGroup?.items.find(
      (i) => i.href === "/dashboard/projects",
    );
    expect(projectsItem).toBeDefined();
    expect(projectsItem?.name).toBe("Projekter");
    expect(projectsItem?.requiresModule).toBe("projects");
  });

  it("giver Kunder/Økonomi neutrale overskrifter i enterprise-profil", () => {
    const labelOf = (label: string) =>
      mainNavGroups.find((g) => g.label === label)?.enterpriseLabel;
    expect(labelOf("Kunder")).toBe("Projekter");
    expect(labelOf("Økonomi")).toBe("Rapporter");
    expect(labelOf("Enterprise")).toBeUndefined();
  });
});

describe("mobileBottomNavItems", () => {
  it("skjuler Hjem for enterprise-medarbejdere (freelancerOnly)", () => {
    const home = mobileBottomNavItems.find((i) => i.href === "/dashboard");
    expect(home?.freelancerOnly).toBe(true);
    expect(
      isNavItemVisible(home as NavItem, {
        ...allOn,
        role: "member",
        orgProfile: "enterprise",
      }),
    ).toBe(false);
    expect(
      isNavItemVisible(home as NavItem, {
        ...allOn,
        role: "member",
        orgProfile: "freelance",
      }),
    ).toBe(true);
  });
});

describe("isAclLoading", () => {
  const ready = {
    modulesLoading: false,
    modulesPlaceholder: false,
    roleLoaded: false,
    roleError: false,
  };

  it("er loading mens moduler eller rolle indlæses", () => {
    expect(isAclLoading({ ...ready, modulesLoading: true })).toBe(true);
    expect(isAclLoading({ ...ready, modulesPlaceholder: true })).toBe(true);
    expect(isAclLoading(ready)).toBe(true);
  });

  it("afslutter loading når rollen er kendt", () => {
    expect(isAclLoading({ ...ready, roleLoaded: true })).toBe(false);
  });

  it("afslutter loading ved fejlet rolle-query (fail-open, nav aldrig tom)", () => {
    expect(isAclLoading({ ...ready, roleError: true })).toBe(false);
  });
});

describe("resolveEnterpriseMember", () => {
  it("freelancer uden hint ser freelance-UI med det samme under load", () => {
    expect(resolveEnterpriseMember({ roleLoaded: false, hint: null })).toEqual({
      isMember: false,
      resolved: false,
    });
    expect(resolveEnterpriseMember({ roleLoaded: false, hint: "0" })).toEqual({
      isMember: false,
      resolved: false,
    });
  });

  it("kendt enterprise-medarbejder (hint) skjules fra første paint", () => {
    expect(resolveEnterpriseMember({ roleLoaded: false, hint: "1" })).toEqual({
      isMember: true,
      resolved: false,
    });
  });

  it("freelance-profil afgør uanset hint og rolle", () => {
    expect(
      resolveEnterpriseMember({
        orgProfile: "freelance",
        roleLoaded: false,
        hint: "1",
      }),
    ).toEqual({ isMember: false, resolved: true });
  });

  it("enterprise + rigtig rolle afgør: member/manager er medarbejdere, admin/owner ikke", () => {
    const at = (role: "member" | "manager" | "admin" | "owner") =>
      resolveEnterpriseMember({
        orgProfile: "enterprise",
        role,
        roleLoaded: true,
        hint: null,
      });
    expect(at("member")).toEqual({ isMember: true, resolved: true });
    expect(at("manager")).toEqual({ isMember: true, resolved: true });
    expect(at("admin")).toEqual({ isMember: false, resolved: true });
    expect(at("owner")).toEqual({ isMember: false, resolved: true });
  });

  it("enterprise + rolle ukendt/fejlet bruger hinten (ikke fail-closed)", () => {
    const pending = (hint: string | null) =>
      resolveEnterpriseMember({
        orgProfile: "enterprise",
        roleLoaded: false,
        hint,
      });
    expect(pending(null)).toEqual({ isMember: false, resolved: false });
    expect(pending("0")).toEqual({ isMember: false, resolved: false });
    expect(pending("1")).toEqual({ isMember: true, resolved: false });
  });
});

describe("goToShortcuts", () => {
  it("har unikke taster", () => {
    const keys = goToShortcuts.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("peger kun på sider i menuen", () => {
    const hrefs = new Set([
      ...mainNavGroups.flatMap((g) => g.items.map((i) => i.href)),
      settingsNavItem.href,
    ]);
    for (const s of goToShortcuts) expect(hrefs, s.href).toContain(s.href);
  });

  it("viser genvejen, som tastaturet faktisk bruger", () => {
    // Paletten viste "G → O" ved både Overblik og Opgaver, men G → O
    // gjorde ingenting
    expect(goToShortcutFor("/dashboard/overblik")).toBe("G → O");
    expect(goToShortcutFor("/dashboard/tasks")).toBeUndefined();
  });
});
