import { expect, test } from "@playwright/test";
import {
  fillClientForm,
  generateUniqueEmail,
  generateUniqueName,
  navigateToClients,
  navigateToDashboard,
  navigateToProjects,
  register,
  submitForm,
  testData,
  waitForDataLoad,
} from "./helpers";

// Legacy-suite fra TimeCraft-æraen — genoplives spec for spec efter behov.
test.skip(
  true,
  "forældet (TimeTrack-dashboard med andre widgets/tekster); skal skrives om mod det nuværende dashboard",
);

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    // Register and login before each test
    await register(
      page,
      testData.users.new.name,
      generateUniqueEmail(),
      testData.users.new.password,
    );
  });

  test.describe("Dashboard Layout", () => {
    test("should display dashboard page after login", async ({ page }) => {
      await expect(page).toHaveURL("/dashboard");
      await expect(page.locator("h1")).toContainText("Velkommen tilbage");
    });

    test("should show welcome message with user name", async ({ page }) => {
      // Welcome message should include user's name
      await expect(page.locator("h1")).toContainText(
        testData.users.new.name.split(" ")[0],
      );
    });

    test("should display sidebar with navigation", async ({ page }) => {
      // Check if sidebar contains main navigation items
      await expect(page.locator("text=TimeTrack")).toBeVisible();
      await expect(page.locator('a:has-text("Oversigt")')).toBeVisible();
      await expect(page.locator('a:has-text("Kunder")')).toBeVisible();
      await expect(page.locator('a:has-text("Projekter")')).toBeVisible();
      await expect(
        page.locator('a:has-text("Tidsregistrering")'),
      ).toBeVisible();
      await expect(page.locator('a:has-text("Klippekort")')).toBeVisible();
      await expect(page.locator('a:has-text("Indstillinger")')).toBeVisible();
    });

    test("should display user menu", async ({ page }) => {
      // User menu should show user's initial
      const userInitial = testData.users.new.name.charAt(0).toUpperCase();
      await expect(page.locator(`text=${userInitial}`).first()).toBeVisible();
    });

    test("should display logo", async ({ page }) => {
      // Logo should be visible in sidebar
      await expect(page.locator("text=TimeTrack")).toBeVisible();
      await expect(page.locator("text=⚡")).toBeVisible();
    });
  });

  test.describe("Dashboard Stats", () => {
    test("should display all stat cards", async ({ page }) => {
      await waitForDataLoad(page);

      // Check for all 4 stat cards
      await expect(page.locator("text=Aktive kunder")).toBeVisible();
      await expect(page.locator("text=Aktive Projekter")).toBeVisible();
      await expect(page.locator("text=Timer Denne Måned")).toBeVisible();
      await expect(page.locator("text=Ventende Fakturaer")).toBeVisible();
    });

    test("should show initial stats as zero", async ({ page }) => {
      await waitForDataLoad(page);

      // Initially all stats should be 0
      const clientsCount = page
        .locator("text=Aktive kunder")
        .locator("..")
        .locator("text=0")
        .first();
      const projectsCount = page
        .locator("text=Aktive Projekter")
        .locator("..")
        .locator("text=0")
        .first();

      await expect(clientsCount).toBeVisible();
      await expect(projectsCount).toBeVisible();
    });

    test("should update client count after adding client", async ({ page }) => {
      await waitForDataLoad(page);

      // Navigate to clients and add one
      await navigateToClients(page);
      await page.click('a:has-text("Tilføj kunde")');
      await fillClientForm(page, { name: generateUniqueName() });
      await submitForm();

      // Go back to dashboard
      await navigateToDashboard(page);
      await waitForDataLoad(page);

      // Client count should be 1
      const clientsCard = page.locator("text=Aktive kunder").locator("..");
      await expect(clientsCard.locator("text=1")).toBeVisible();
    });

    test("should update project count after adding project", async ({
      page,
    }) => {
      await waitForDataLoad(page);

      // First create a client
      await navigateToClients(page);
      await page.click('a:has-text("Tilføj kunde")');
      const clientName = generateUniqueName();
      await fillClientForm(page, { name: clientName });
      await submitForm();

      // Then create a project
      await navigateToProjects(page);
      await page.click('a:has-text("Nyt projekt")');
      await page.fill("#name", generateUniqueName());
      await page.selectOption("select#clientId", { label: clientName });
      await page.check("#pricingType-hourly");
      await page.fill("#hourlyRate", "800");
      await submitForm();

      // Go back to dashboard
      await navigateToDashboard(page);
      await waitForDataLoad(page);

      // Project count should be 1
      const projectsCard = page.locator("text=Aktive Projekter").locator("..");
      await expect(projectsCard.locator("text=1")).toBeVisible();
    });

    test("should show current month name in hours stat", async ({ page }) => {
      await waitForDataLoad(page);

      // Should show current month (e.g., "januar 2025")
      const monthCard = page.locator("text=Timer Denne Måned").locator("..");
      const currentMonth = new Date()
        .toLocaleDateString("da-DK", { month: "long" })
        .toLowerCase();

      await expect(monthCard.locator(`text=${currentMonth}`)).toBeVisible();
    });
  });

  test.describe("Quick Actions", () => {
    test("should display quick actions section", async ({ page }) => {
      await expect(page.locator("text=Hurtige handlinger")).toBeVisible();
    });

    test("should have all quick action buttons", async ({ page }) => {
      // Check all 4 quick action buttons
      await expect(page.locator('a:has-text("Tilføj kunde")')).toBeVisible();
      await expect(page.locator('a:has-text("Nyt projekt")')).toBeVisible();
      await expect(page.locator('a:has-text("Start Timer")')).toBeVisible();
      await expect(
        page.locator('a:has-text("Opret klippekort")'),
      ).toBeVisible();
    });

    test("should navigate to clients page from quick action", async ({
      page,
    }) => {
      const quickAction = page
        .locator("text=Hurtige handlinger")
        .locator("..")
        .locator('a:has-text("Tilføj kunde")');
      await quickAction.click();

      await expect(page).toHaveURL("/dashboard/clients");
    });

    test("should navigate to projects page from quick action", async ({
      page,
    }) => {
      const quickAction = page
        .locator("text=Hurtige handlinger")
        .locator("..")
        .locator('a:has-text("Nyt projekt")');
      await quickAction.click();

      await expect(page).toHaveURL("/dashboard/projects");
    });

    test("should navigate to time tracking from quick action", async ({
      page,
    }) => {
      const quickAction = page
        .locator("text=Hurtige handlinger")
        .locator("..")
        .locator('a:has-text("Start Timer")');
      await quickAction.click();

      await expect(page).toHaveURL("/dashboard/time");
    });

    test("should navigate to klippekort from quick action", async ({
      page,
    }) => {
      const quickAction = page
        .locator("text=Hurtige handlinger")
        .locator("..")
        .locator('a:has-text("Opret klippekort")');
      await quickAction.click();

      await expect(page).toHaveURL("/dashboard/klippekort");
    });
  });

  test.describe("Getting Started Section", () => {
    test("should display getting started section", async ({ page }) => {
      await expect(
        page.locator("text=Kom godt i gang med TimeTrack"),
      ).toBeVisible();
    });

    test("should show helpful onboarding text", async ({ page }) => {
      await expect(
        page.locator(
          "text=Start med at tilføje dine første klienter og projekter",
        ),
      ).toBeVisible();
    });

    test("should have CTA button to add first client", async ({ page }) => {
      await expect(
        page.locator('a:has-text("Tilføj Din Første Klient")'),
      ).toBeVisible();
    });

    test("should have link to settings", async ({ page }) => {
      await expect(
        page.locator('a:has-text("Opsæt Din Profil")'),
      ).toBeVisible();
    });

    test("should navigate to clients from onboarding CTA", async ({ page }) => {
      await page.click('a:has-text("Tilføj Din Første Klient")');
      await expect(page).toHaveURL("/dashboard/clients");
    });

    test("should navigate to settings from onboarding CTA", async ({
      page,
    }) => {
      await page.click('a:has-text("Opsæt Din Profil")');
      await expect(page).toHaveURL("/dashboard/settings");
    });
  });

  test.describe("Recent Activity Section", () => {
    test("should display recent activity section", async ({ page }) => {
      await expect(page.locator("text=Seneste aktivitet")).toBeVisible();
    });

    test("should show empty state for recent activity", async ({ page }) => {
      // Initially should show empty state
      await expect(page.locator("text=Ingen aktivitet endnu")).toBeVisible();
      await expect(
        page.locator("text=Dine seneste tidsposteringer vil blive vist her"),
      ).toBeVisible();
    });
  });

  test.describe("Navigation", () => {
    test("should navigate to clients page", async ({ page }) => {
      await page.click('a[href="/dashboard/clients"]');
      await expect(page).toHaveURL("/dashboard/clients");
      await expect(page.locator("h1")).toContainText("Kunder");
    });

    test("should navigate to projects page", async ({ page }) => {
      await page.click('a[href="/dashboard/projects"]');
      await expect(page).toHaveURL("/dashboard/projects");
      await expect(page.locator("h1")).toContainText("Projekter");
    });

    test("should navigate to time tracking page", async ({ page }) => {
      await page.click('a[href="/dashboard/time"]');
      await expect(page).toHaveURL("/dashboard/time");
      await expect(page.locator("h1")).toContainText("Tidsregistrering");
    });

    test("should navigate to klippekort page", async ({ page }) => {
      await page.click('a[href="/dashboard/klippekort"]');
      await expect(page).toHaveURL("/dashboard/klippekort");
      await expect(page.locator("h1")).toContainText("Klippekort");
    });

    test("should navigate to settings page", async ({ page }) => {
      await page.click('a[href="/dashboard/settings"]');
      await expect(page).toHaveURL("/dashboard/settings");
    });

    test("should highlight active navigation item", async ({ page }) => {
      // Dashboard should be active
      const dashboardLink = page.locator('a[href="/dashboard"]').first();
      await expect(dashboardLink).toHaveClass(/bg-brand-50/);

      // Navigate to clients
      await navigateToClients(page);

      // Clients link should be highlighted
      const clientsLink = page.locator('a[href="/dashboard/clients"]');
      await expect(clientsLink).toHaveClass(/bg-brand-50/);
    });

    test("should navigate back to dashboard from other pages", async ({
      page,
    }) => {
      // Navigate away from dashboard
      await navigateToClients(page);

      // Click dashboard link to return
      await navigateToDashboard(page);

      await expect(page).toHaveURL("/dashboard");
    });
  });

  test.describe("Mobile Menu", () => {
    test("should show mobile menu button on small screens", async ({
      page,
    }) => {
      // Resize to mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      // Mobile menu button should be visible
      const mobileMenuButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-menu"]') });
      await expect(mobileMenuButton).toBeVisible();
    });

    test("should open mobile sidebar when clicking menu button", async ({
      page,
    }) => {
      // Resize to mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      // Click mobile menu button
      const mobileMenuButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-menu"]') });
      await mobileMenuButton.click();

      // Sidebar should be visible
      await page.waitForTimeout(300); // Wait for animation
      const sidebar = page.locator("text=TimeTrack").locator("..");
      await expect(sidebar).toBeVisible();
    });

    test("should close mobile sidebar when clicking backdrop", async ({
      page,
    }) => {
      // Resize to mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      // Open mobile menu
      const mobileMenuButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-menu"]') });
      await mobileMenuButton.click();
      await page.waitForTimeout(300);

      // Click backdrop
      const backdrop = page.locator(".bg-gray-900\\/50");
      if (await backdrop.isVisible()) {
        await backdrop.click();
        await page.waitForTimeout(300);
      }
    });

    test("should show user menu on mobile", async ({ page }) => {
      // Resize to mobile viewport
      await page.setViewportSize({ width: 375, height: 667 });

      // User menu button should be visible in top bar
      const userInitial = testData.users.new.name.charAt(0).toUpperCase();
      const userButton = page.locator(`button:has-text("${userInitial}")`);
      await expect(userButton.first()).toBeVisible();
    });
  });

  test.describe("User Menu", () => {
    test("should open user menu when clicked", async ({ page }) => {
      // Find and click user menu button (in sidebar)
      const userMenuButton = page
        .locator("button")
        .filter({ hasText: testData.users.new.email });
      await userMenuButton.first().click();

      // Menu should open
      await page.waitForTimeout(200);
      await expect(
        page.locator('a:has-text("Indstillinger")').last(),
      ).toBeVisible();
      await expect(
        page.locator('button:has-text("Log ud")').last(),
      ).toBeVisible();
    });

    test("should navigate to settings from user menu", async ({ page }) => {
      // Open user menu
      const userMenuButton = page
        .locator("button")
        .filter({ hasText: testData.users.new.email });
      await userMenuButton.first().click();
      await page.waitForTimeout(200);

      // Click settings
      await page.locator('a:has-text("Indstillinger")').last().click();

      await expect(page).toHaveURL("/dashboard/settings");
    });

    test("should display user email in menu", async ({ page }) => {
      // User email should be visible in user menu button
      await expect(
        page.locator(`text=${testData.users.new.email}`).first(),
      ).toBeVisible();
    });
  });

  test.describe("Responsive Design", () => {
    test("should display correctly on desktop", async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });

      // Sidebar should be visible
      await expect(page.locator("text=TimeTrack")).toBeVisible();

      // Stats should be in grid layout
      await expect(page.locator("text=Aktive kunder")).toBeVisible();
      await expect(page.locator("text=Aktive Projekter")).toBeVisible();
    });

    test("should display correctly on tablet", async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });

      // Content should still be accessible
      await expect(page.locator("h1")).toContainText("Velkommen tilbage");
      await expect(page.locator("text=Aktive kunder")).toBeVisible();
    });

    test("should display correctly on mobile", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });

      // Content should still be accessible
      await expect(page.locator("h1")).toContainText("Velkommen tilbage");

      // Mobile menu button should be visible
      const mobileMenuButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-menu"]') });
      await expect(mobileMenuButton).toBeVisible();
    });
  });

  test.describe("Icons", () => {
    test("should display icons for stat cards", async ({ page }) => {
      await waitForDataLoad(page);

      // Each stat card should have an icon
      // Using Lucide icons: Users, FolderKanban, Clock, DollarSign
      const icons = page.locator(".bg-blue-100 svg");
      await expect(icons.first()).toBeVisible();
    });

    test("should display icons in navigation", async ({ page }) => {
      // Navigation items should have icons
      const navIcons = page.locator("nav svg");
      await expect(navIcons.first()).toBeVisible();
    });
  });
});
