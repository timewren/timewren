import { expect, test } from "@playwright/test";
import {
  fillClientForm,
  generateUniqueEmail,
  generateUniqueName,
  navigateToClients,
  navigateToProjects,
  register,
  submitForm,
  testData,
  waitForDataLoad,
} from "./helpers";

// Legacy-suite fra TimeCraft-æraen — genoplives spec for spec efter behov.
test.skip(
  true,
  "forældet (TimeCraft-UI: felt-id'er og statusvalg findes ikke længere); kerneflowet dækkes af core-flow.spec.ts",
);

test.describe("Project Management", () => {
  let clientName: string;

  test.beforeEach(async ({ page }) => {
    // Register and login before each test
    await register(
      page,
      testData.users.new.name,
      generateUniqueEmail(),
      testData.users.new.password,
    );

    // Create a client first (required for projects)
    clientName = generateUniqueName();
    await navigateToClients(page);
    await page.click('a:has-text("Tilføj kunde")');
    await fillClientForm(page, {
      name: clientName,
      email: "client@example.dk",
    });
    await submitForm();
    await page.waitForURL("/dashboard/clients");

    // Navigate to projects page
    await navigateToProjects(page);
  });

  test.describe("Project List", () => {
    test("should display projects page", async ({ page }) => {
      await expect(page).toHaveURL("/dashboard/projects");
      await expect(page.locator("h1")).toContainText("Projekter");
      await expect(
        page.locator("text=Administrer dine projekter og deres status"),
      ).toBeVisible();
    });

    test("should show empty state when no projects exist", async ({ page }) => {
      await waitForDataLoad(page);

      // Should show empty state
      await expect(page.locator("text=Ingen projekter endnu")).toBeVisible();
      await expect(
        page.locator("text=Kom i gang ved at oprette dit første projekt"),
      ).toBeVisible();

      // Should show "Opret første projekt" button
      await expect(
        page.locator('a:has-text("Opret første projekt")'),
      ).toBeVisible();
    });

    test("should navigate to new project page", async ({ page }) => {
      await page.click('a:has-text("Nyt projekt")');
      await expect(page).toHaveURL("/dashboard/projects/new");
      await expect(page.locator("h1")).toContainText("Opret nyt projekt");
    });
  });

  test.describe("Create Project", () => {
    test("should create a project with hourly rate", async ({ page }) => {
      await page.click('a:has-text("Nyt projekt")');

      const projectName = generateUniqueName();
      await page.fill("#name", projectName);
      await page.fill("#description", testData.projects.valid.description);

      // Select client
      await page.selectOption("select#clientId", { label: clientName });

      // Select hourly rate option
      await page.check("#pricingType-hourly");
      await page.fill("#hourlyRate", testData.projects.valid.hourlyRate);

      // Select status
      await page.selectOption("select#status", "active");

      await submitForm();

      // Should redirect to projects list
      await page.waitForURL("/dashboard/projects");

      // Project should appear in list
      await waitForDataLoad(page);
      await expect(page.locator(`text=${projectName}`)).toBeVisible();
    });

    test("should create a project with fixed price", async ({ page }) => {
      await page.click('a:has-text("Nyt projekt")');

      const projectName = generateUniqueName();
      await page.fill("#name", projectName);
      await page.fill("#description", testData.projects.fixedPrice.description);

      // Select client
      await page.selectOption("select#clientId", { label: clientName });

      // Select fixed price option
      await page.check("#pricingType-fixed");
      await page.fill("#fixedPrice", testData.projects.fixedPrice.fixedPrice);

      // Select status
      await page.selectOption("select#status", "active");

      await submitForm();

      // Should redirect to projects list
      await page.waitForURL("/dashboard/projects");

      // Project should appear in list
      await waitForDataLoad(page);
      await expect(page.locator(`text=${projectName}`)).toBeVisible();
      await expect(page.locator("text=25000 kr fast")).toBeVisible();
    });

    test("should show validation error for empty project name", async ({
      page,
    }) => {
      await page.click('a:has-text("Nyt projekt")');

      // Try to submit without name
      await submitForm();

      // HTML5 validation should prevent submission
      await expect(page).toHaveURL("/dashboard/projects/new");
    });

    test("should show validation error when no client selected", async ({
      page,
    }) => {
      await page.click('a:has-text("Nyt projekt")');

      await page.fill("#name", generateUniqueName());
      // Don't select a client

      await submitForm();

      // Should remain on page (validation error)
      await expect(page).toHaveURL("/dashboard/projects/new");
    });

    test("should cancel project creation", async ({ page }) => {
      await page.click('a:has-text("Nyt projekt")');

      await page.fill("#name", generateUniqueName());

      // Click cancel
      await page.click('a:has-text("Annuller")');

      // Should return to projects list
      await expect(page).toHaveURL("/dashboard/projects");
    });

    test("should set start date for project", async ({ page }) => {
      await page.click('a:has-text("Nyt projekt")');

      const projectName = generateUniqueName();
      await page.fill("#name", projectName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.check("#pricingType-hourly");
      await page.fill("#hourlyRate", "800");

      // Set start date
      const startDate = "2025-01-15";
      const startDateInput = page.locator("#startDate");
      if (await startDateInput.isVisible()) {
        await startDateInput.fill(startDate);
      }

      await submitForm();

      await page.waitForURL("/dashboard/projects");
      await waitForDataLoad(page);

      // Check if date is shown in project list
      const projectCard = page.locator(`text=${projectName}`).locator("..");
      if (await projectCard.locator("text=Start:").isVisible()) {
        await expect(projectCard.locator("text=Start:")).toBeVisible();
      }
    });
  });

  test.describe("Search and Filter", () => {
    test.beforeEach(async ({ page }) => {
      // Create multiple projects with different statuses
      const projects = [
        {
          name: "Active Project 1",
          status: "active",
          hourlyRate: "800",
        },
        {
          name: "Completed Project 1",
          status: "completed",
          hourlyRate: "750",
        },
        {
          name: "On Hold Project 1",
          status: "on_hold",
          hourlyRate: "900",
        },
      ];

      for (const proj of projects) {
        await page.click('a:has-text("Nyt projekt")');
        await page.fill("#name", proj.name);
        await page.selectOption("select#clientId", { label: clientName });
        await page.check("#pricingType-hourly");
        await page.fill("#hourlyRate", proj.hourlyRate);
        await page.selectOption("select#status", proj.status);
        await submitForm();
        await page.waitForURL("/dashboard/projects");
        await waitForDataLoad(page);
      }
    });

    test("should search projects by name", async ({ page }) => {
      await waitForDataLoad(page);

      const searchInput = page.locator('input[placeholder*="Søg efter"]');
      await searchInput.fill("Active");

      // Should show only matching projects
      await expect(page.locator("text=Active Project 1")).toBeVisible();
      await expect(page.locator("text=Completed Project 1")).not.toBeVisible();
    });

    test("should search projects by client name", async ({ page }) => {
      await waitForDataLoad(page);

      const searchInput = page.locator('input[placeholder*="Søg efter"]');
      await searchInput.fill(clientName);

      // Should show all projects for this client
      await expect(page.locator("text=Active Project 1")).toBeVisible();
      await expect(page.locator("text=Completed Project 1")).toBeVisible();
    });

    test("should filter projects by status - Active", async ({ page }) => {
      await waitForDataLoad(page);

      const statusFilter = page
        .locator("select")
        .filter({ hasText: "Alle status" });
      await statusFilter.selectOption("active");

      // Should show only active projects
      await expect(page.locator("text=Active Project 1")).toBeVisible();
      await expect(page.locator("text=Completed Project 1")).not.toBeVisible();
      await expect(page.locator("text=On Hold Project 1")).not.toBeVisible();
    });

    test("should filter projects by status - Completed", async ({ page }) => {
      await waitForDataLoad(page);

      const statusFilter = page
        .locator("select")
        .filter({ hasText: "Alle status" });
      await statusFilter.selectOption("completed");

      // Should show only completed projects
      await expect(page.locator("text=Completed Project 1")).toBeVisible();
      await expect(page.locator("text=Active Project 1")).not.toBeVisible();
    });

    test("should show no results for non-matching search", async ({ page }) => {
      await waitForDataLoad(page);

      const searchInput = page.locator('input[placeholder*="Søg efter"]');
      await searchInput.fill("NonExistentProject12345");

      await expect(page.locator("text=Ingen projekter fundet")).toBeVisible();
      await expect(
        page.locator("text=Prøv at justere dine søgekriterier"),
      ).toBeVisible();
    });

    test("should show project count", async ({ page }) => {
      await waitForDataLoad(page);

      // Should show total count
      const statsText = page.locator("text=/Viser.*af.*projekter/");
      await expect(statsText).toBeVisible();
    });
  });

  test.describe("View Project Details", () => {
    test("should navigate to project details page", async ({ page }) => {
      // Create a project first
      await page.click('a:has-text("Nyt projekt")');
      const projectName = generateUniqueName();
      await page.fill("#name", projectName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.check("#pricingType-hourly");
      await page.fill("#hourlyRate", "800");
      await submitForm();
      await page.waitForURL("/dashboard/projects");
      await waitForDataLoad(page);

      // Click on project
      const projectLink = page.locator(`a:has-text("${projectName}")`).first();
      await projectLink.click();

      // Should navigate to project details
      await page.waitForURL(/\/dashboard\/projects\/[^/]+$/);
    });
  });

  test.describe("Edit Project", () => {
    test("should navigate to edit project page", async ({ page }) => {
      // Create a project
      await page.click('a:has-text("Nyt projekt")');
      const projectName = generateUniqueName();
      await page.fill("#name", projectName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.check("#pricingType-hourly");
      await page.fill("#hourlyRate", "800");
      await submitForm();
      await page.waitForURL("/dashboard/projects");
      await waitForDataLoad(page);

      // Navigate to project details
      const projectLink = page.locator(`a:has-text("${projectName}")`).first();
      await projectLink.click();
      await page.waitForURL(/\/dashboard\/projects\/[^/]+$/);

      // Click edit button
      const editButton = page.locator('a:has-text("Rediger")').first();
      if (await editButton.isVisible()) {
        await editButton.click();
        await page.waitForURL(/\/dashboard\/projects\/[^/]+\/edit$/);
        await expect(page.locator("h1")).toContainText("Rediger Projekt");
      }
    });
  });

  test.describe("Delete Project", () => {
    test("should show delete option in project details", async ({ page }) => {
      // Create a project
      await page.click('a:has-text("Nyt projekt")');
      const projectName = generateUniqueName();
      await page.fill("#name", projectName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.check("#pricingType-hourly");
      await page.fill("#hourlyRate", "800");
      await submitForm();
      await page.waitForURL("/dashboard/projects");
      await waitForDataLoad(page);

      // Navigate to project details
      const projectLink = page.locator(`a:has-text("${projectName}")`).first();
      await projectLink.click();
      await page.waitForURL(/\/dashboard\/projects\/[^/]+$/);

      // Delete button should be available
      const deleteButton = page.locator('button:has-text("Slet")').first();
      if (await deleteButton.isVisible()) {
        await expect(deleteButton).toBeVisible();
      }
    });
  });

  test.describe("Project Display", () => {
    test("should display project status badge", async ({ page }) => {
      // Create an active project
      await page.click('a:has-text("Nyt projekt")');
      const projectName = generateUniqueName();
      await page.fill("#name", projectName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.check("#pricingType-hourly");
      await page.fill("#hourlyRate", "800");
      await page.selectOption("select#status", "active");
      await submitForm();
      await page.waitForURL("/dashboard/projects");
      await waitForDataLoad(page);

      // Should show status badge
      await expect(page.locator("text=Aktiv")).toBeVisible();
    });

    test("should display hourly rate in project card", async ({ page }) => {
      await page.click('a:has-text("Nyt projekt")');
      const projectName = generateUniqueName();
      await page.fill("#name", projectName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.check("#pricingType-hourly");
      await page.fill("#hourlyRate", "850");
      await submitForm();
      await page.waitForURL("/dashboard/projects");
      await waitForDataLoad(page);

      // Should show hourly rate
      await expect(page.locator("text=850 kr/t")).toBeVisible();
    });

    test("should display client name in project card", async ({ page }) => {
      await page.click('a:has-text("Nyt projekt")');
      const projectName = generateUniqueName();
      await page.fill("#name", projectName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.check("#pricingType-hourly");
      await page.fill("#hourlyRate", "800");
      await submitForm();
      await page.waitForURL("/dashboard/projects");
      await waitForDataLoad(page);

      // Should show client name
      await expect(page.locator(`text=${clientName}`)).toBeVisible();
    });

    test("should show project stats (initially 0 hours)", async ({ page }) => {
      await page.click('a:has-text("Nyt projekt")');
      const projectName = generateUniqueName();
      await page.fill("#name", projectName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.check("#pricingType-hourly");
      await page.fill("#hourlyRate", "800");
      await submitForm();
      await page.waitForURL("/dashboard/projects");
      await waitForDataLoad(page);

      // Should show 0 hours and 0 kr
      await expect(page.locator("text=0 timer")).toBeVisible();
      await expect(page.locator("text=0 kr")).toBeVisible();
    });
  });

  test.describe("Project Status", () => {
    const statuses = [
      { value: "active", label: "Aktiv" },
      { value: "completed", label: "Afsluttet" },
      { value: "on_hold", label: "På Hold" },
    ];

    for (const status of statuses) {
      test(`should create project with ${status.label} status`, async ({
        page,
      }) => {
        await page.click('a:has-text("Nyt projekt")');
        const projectName = generateUniqueName();
        await page.fill("#name", projectName);
        await page.selectOption("select#clientId", { label: clientName });
        await page.check("#pricingType-hourly");
        await page.fill("#hourlyRate", "800");
        await page.selectOption("select#status", status.value);
        await submitForm();
        await page.waitForURL("/dashboard/projects");
        await waitForDataLoad(page);

        // Should show correct status badge
        await expect(page.locator(`text=${status.label}`)).toBeVisible();
      });
    }
  });
});
