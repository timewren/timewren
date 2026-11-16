import { expect, test } from "@playwright/test";
import {
  fillClientForm,
  generateUniqueEmail,
  generateUniqueName,
  navigateToClients,
  register,
  submitForm,
  testData,
  waitForDataLoad,
} from "./helpers";

// Legacy-suite fra TimeCraft-æraen — genoplives spec for spec efter behov.
test.skip(
  true,
  "forældet (TimeCraft-UI: felt-id'er og tekster findes ikke længere); kerneflowet dækkes af core-flow.spec.ts",
);

test.describe("Client Management", () => {
  test.beforeEach(async ({ page }) => {
    // Register and login before each test
    await register(
      page,
      testData.users.new.name,
      generateUniqueEmail(),
      testData.users.new.password,
    );
    await navigateToClients(page);
  });

  test.describe("Client List", () => {
    test("should display clients page", async ({ page }) => {
      await expect(page).toHaveURL("/dashboard/clients");
      await expect(page.locator("h1")).toContainText("Kunder");
      await expect(
        page.locator("text=Administrer dine kunder og deres projekter"),
      ).toBeVisible();
    });

    test("should show empty state when no clients exist", async ({ page }) => {
      await waitForDataLoad(page);

      // Should show empty state
      await expect(page.locator("text=Ingen kunder endnu")).toBeVisible();
      await expect(
        page.locator("text=Kom i gang ved at tilføje din første kunde"),
      ).toBeVisible();

      // Should show "Tilføj Første Klient" button
      await expect(
        page.locator('a:has-text("Tilføj din første kunde")'),
      ).toBeVisible();
    });

    test("should navigate to new client page", async ({ page }) => {
      await page.click('a:has-text("Tilføj kunde")');
      await expect(page).toHaveURL("/dashboard/clients/new");
      await expect(page.locator("h1")).toContainText("Tilføj ny kunde");
    });
  });

  test.describe("Create Client", () => {
    test("should create a new client with all fields", async ({ page }) => {
      // Navigate to new client page
      await page.click('a:has-text("Tilføj kunde")');

      // Fill form with all fields
      await fillClientForm(page, {
        ...testData.clients.valid,
        name: generateUniqueName(),
      });

      // Submit form
      await submitForm();

      // Should redirect to clients list
      await page.waitForURL("/dashboard/clients");

      // Client should appear in list
      await waitForDataLoad(page);
      await expect(
        page.locator(`text=${testData.clients.valid.company}`),
      ).toBeVisible();
    });

    test("should create a minimal client with only required fields", async ({
      page,
    }) => {
      await page.click('a:has-text("Tilføj kunde")');

      const uniqueName = generateUniqueName();
      await fillClientForm(page, { name: uniqueName });

      await submitForm();

      // Should redirect to clients list
      await page.waitForURL("/dashboard/clients");

      // Client should appear in list
      await waitForDataLoad(page);
      await expect(page.locator(`text=${uniqueName}`)).toBeVisible();
    });

    test("should show validation error for empty name", async ({ page }) => {
      await page.click('a:has-text("Tilføj kunde")');

      // Try to submit without name
      await submitForm();

      // Should show validation error (HTML5 validation will prevent submission)
      await expect(page).toHaveURL("/dashboard/clients/new");
    });

    test("should show validation error for invalid email", async ({ page }) => {
      await page.click('a:has-text("Tilføj kunde")');

      await page.fill("#name", generateUniqueName());
      await page.fill("#email", "invalid-email");

      await submitForm();

      // HTML5 validation should prevent submission
      await expect(page).toHaveURL("/dashboard/clients/new");
    });

    test("should cancel client creation and return to list", async ({
      page,
    }) => {
      await page.click('a:has-text("Tilføj kunde")');

      await fillClientForm(page, {
        name: generateUniqueName(),
        email: "test@example.dk",
      });

      // Click cancel button
      await page.click('a:has-text("Annuller")');

      // Should return to clients list
      await expect(page).toHaveURL("/dashboard/clients");
    });

    test("should navigate back to clients list using back link", async ({
      page,
    }) => {
      await page.click('a:has-text("Tilføj kunde")');

      await page.click('a:has-text("Tilbage til kunder")');

      await expect(page).toHaveURL("/dashboard/clients");
    });
  });

  test.describe("CVR Lookup", () => {
    test("should show CVR lookup section", async ({ page }) => {
      await page.click('a:has-text("Tilføj kunde")');

      await expect(page.locator("text=CVR Opslag")).toBeVisible();
      await expect(
        page.locator(
          "text=Indtast CVR nummer for automatisk at udfylde firmaoplysninger",
        ),
      ).toBeVisible();
    });

    test("should have CVR lookup input and button", async ({ page }) => {
      await page.click('a:has-text("Tilføj kunde")');

      const cvrInput = page.locator('input[placeholder="12345678"]');
      const lookupButton = page.locator('button:has-text("Slå op")');

      await expect(cvrInput).toBeVisible();
      await expect(lookupButton).toBeVisible();
    });

    test("CVR lookup button should be disabled without input", async ({
      page,
    }) => {
      await page.click('a:has-text("Tilføj kunde")');

      const lookupButton = page.locator('button:has-text("Slå op")');
      await expect(lookupButton).toBeDisabled();
    });
  });

  test.describe("Search and Filter", () => {
    test.beforeEach(async ({ page }) => {
      // Create a few test clients
      for (const clientData of [
        { ...testData.clients.valid, name: "Testkunde Test Client" },
        { ...testData.clients.search, name: "Søgetest Test Client" },
        { ...testData.clients.minimal, name: "Minimal Test Client" },
      ]) {
        await page.click('a:has-text("Tilføj kunde")');
        await fillClientForm(page, clientData);
        await submitForm();
        await page.waitForURL("/dashboard/clients");
        await waitForDataLoad(page);
      }
    });

    test("should search clients by name", async ({ page }) => {
      await waitForDataLoad(page);

      const searchInput = page.locator('input[placeholder*="Søg efter"]');
      await searchInput.fill("Testkunde");

      // Should show only matching clients
      await expect(page.locator("text=Testkunde Test Client")).toBeVisible();
      await expect(page.locator("text=Søgetest Test Client")).not.toBeVisible();
    });

    test("should search clients by email", async ({ page }) => {
      await waitForDataLoad(page);

      const searchInput = page.locator('input[placeholder*="Søg efter"]');
      await searchInput.fill(testData.clients.valid.email);

      await expect(page.locator("text=Testkunde Test Client")).toBeVisible();
    });

    test("should search clients by company", async ({ page }) => {
      await waitForDataLoad(page);

      const searchInput = page.locator('input[placeholder*="Søg efter"]');
      await searchInput.fill("Søgetest");

      await expect(page.locator("text=Søgetest Test Client")).toBeVisible();
      await expect(
        page.locator("text=Testkunde Test Client"),
      ).not.toBeVisible();
    });

    test("should show no results message for non-matching search", async ({
      page,
    }) => {
      await waitForDataLoad(page);

      const searchInput = page.locator('input[placeholder*="Søg efter"]');
      await searchInput.fill("NonExistentClient12345");

      await expect(page.locator("text=Ingen kunder fundet")).toBeVisible();
      await expect(
        page.locator("text=Prøv at søge efter noget andet"),
      ).toBeVisible();
    });

    test("should show client count", async ({ page }) => {
      await waitForDataLoad(page);

      // Should show total count
      const statsText = page.locator("text=/Viser.*af.*kunder/");
      await expect(statsText).toBeVisible();
    });
  });

  test.describe("View Client Details", () => {
    test("should navigate to client details page", async ({ page }) => {
      // Create a client first
      await page.click('a:has-text("Tilføj kunde")');
      const uniqueName = generateUniqueName();
      await fillClientForm(page, {
        ...testData.clients.valid,
        name: uniqueName,
      });
      await submitForm();
      await page.waitForURL("/dashboard/clients");
      await waitForDataLoad(page);

      // Click on the client card
      const clientCard = page.locator(`text=${uniqueName}`).locator("..");
      await clientCard.click();

      // Should navigate to client details page
      await page.waitForURL(/\/dashboard\/clients\/[^/]+$/);
    });
  });

  test.describe("Edit Client", () => {
    test("should navigate to edit client page", async ({ page }) => {
      // Create a client first
      await page.click('a:has-text("Tilføj kunde")');
      const uniqueName = generateUniqueName();
      await fillClientForm(page, {
        ...testData.clients.valid,
        name: uniqueName,
      });
      await submitForm();
      await page.waitForURL("/dashboard/clients");
      await waitForDataLoad(page);

      // Navigate to client details
      const clientCard = page.locator(`text=${uniqueName}`).locator("..");
      await clientCard.click();
      await page.waitForURL(/\/dashboard\/clients\/[^/]+$/);

      // Click edit button
      const editButton = page.locator('a:has-text("Rediger")').first();
      if (await editButton.isVisible()) {
        await editButton.click();
        await page.waitForURL(/\/dashboard\/clients\/[^/]+\/edit$/);
        await expect(page.locator("h1")).toContainText("Rediger kunde");
      }
    });
  });

  test.describe("Archive Client", () => {
    test("should show archive option in client details", async ({ page }) => {
      // Create a client first
      await page.click('a:has-text("Tilføj kunde")');
      const uniqueName = generateUniqueName();
      await fillClientForm(page, {
        ...testData.clients.valid,
        name: uniqueName,
      });
      await submitForm();
      await page.waitForURL("/dashboard/clients");
      await waitForDataLoad(page);

      // Navigate to client details
      const clientCard = page.locator(`text=${uniqueName}`).locator("..");
      await clientCard.click();
      await page.waitForURL(/\/dashboard\/clients\/[^/]+$/);

      // Archive button should be available
      const archiveButton = page.locator('button:has-text("Arkiver")').first();
      if (await archiveButton.isVisible()) {
        await expect(archiveButton).toBeVisible();
      }
    });
  });

  test.describe("Client Display", () => {
    test("should display client information in cards", async ({ page }) => {
      // Create a client with full information
      await page.click('a:has-text("Tilføj kunde")');
      const uniqueName = generateUniqueName();
      await fillClientForm(page, {
        ...testData.clients.valid,
        name: uniqueName,
      });
      await submitForm();
      await page.waitForURL("/dashboard/clients");
      await waitForDataLoad(page);

      // Client card should show all relevant info
      await expect(page.locator(`text=${uniqueName}`)).toBeVisible();
      await expect(
        page.locator(`text=${testData.clients.valid.company}`),
      ).toBeVisible();
      await expect(
        page.locator(`text=${testData.clients.valid.email}`),
      ).toBeVisible();
    });

    test("should display default hourly rate if set", async ({ page }) => {
      await page.click('a:has-text("Tilføj kunde")');
      const uniqueName = generateUniqueName();
      await fillClientForm(page, {
        name: uniqueName,
        defaultHourlyRate: "750",
      });
      await submitForm();
      await page.waitForURL("/dashboard/clients");
      await waitForDataLoad(page);

      // Should show hourly rate
      await expect(page.locator("text=750 kr/t")).toBeVisible();
    });

    test("should show project count (initially 0)", async ({ page }) => {
      await page.click('a:has-text("Tilføj kunde")');
      const uniqueName = generateUniqueName();
      await fillClientForm(page, { name: uniqueName });
      await submitForm();
      await page.waitForURL("/dashboard/clients");
      await waitForDataLoad(page);

      // Should show 0 projects
      await expect(page.locator("text=0 projekter")).toBeVisible();
    });
  });

  test.describe("Client Actions", () => {
    test("should show menu button on client card hover", async ({ page }) => {
      // Create a client
      await page.click('a:has-text("Tilføj kunde")');
      const uniqueName = generateUniqueName();
      await fillClientForm(page, { name: uniqueName });
      await submitForm();
      await page.waitForURL("/dashboard/clients");
      await waitForDataLoad(page);

      // Hover over client card to reveal menu
      const clientCard = page.locator(`text=${uniqueName}`).locator("..");
      await clientCard.hover();

      // Menu button should become visible
      const menuButton = clientCard.locator("button:has(svg)").first();
      await expect(menuButton).toBeVisible();
    });
  });
});
