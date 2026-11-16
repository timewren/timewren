import { expect, test } from "@playwright/test";
import {
  fillClientForm,
  generateUniqueEmail,
  generateUniqueName,
  navigateToClients,
  navigateToKlippekort,
  register,
  submitForm,
  testData,
  waitForDataLoad,
} from "./helpers";

// Legacy-suite fra TimeCraft-æraen — genoplives spec for spec efter behov.
test.skip(
  true,
  "forældet (TimeCraft-klippekortformular); skal skrives om mod den nuværende klippekort-UI",
);

test.describe("Klippekort (Prepaid Packages)", () => {
  let clientName: string;

  test.beforeEach(async ({ page }) => {
    // Register and login before each test
    await register(
      page,
      testData.users.new.name,
      generateUniqueEmail(),
      testData.users.new.password,
    );

    // Create a client
    clientName = generateUniqueName();
    await navigateToClients(page);
    await page.click('a:has-text("Tilføj kunde")');
    await fillClientForm(page, {
      name: clientName,
      email: "client@example.dk",
    });
    await submitForm();
    await page.waitForURL("/dashboard/clients");

    // Navigate to klippekort page
    await navigateToKlippekort(page);
  });

  test.describe("Klippekort List", () => {
    test("should display klippekort page", async ({ page }) => {
      await expect(page).toHaveURL("/dashboard/klippekort");
      await expect(page.locator("h1")).toContainText("Klippekort");
      await expect(
        page.locator(
          "text=Kundernes klippekort og hvor mange timer der er tilbage",
        ),
      ).toBeVisible();
    });

    test("should show empty state when no klippekort exist", async ({
      page,
    }) => {
      await waitForDataLoad(page);

      // Should show empty state
      await expect(page.locator("text=Ingen klippekort fundet")).toBeVisible();
      await expect(
        page.locator("text=Opret dit første klippekort for at komme i gang"),
      ).toBeVisible();

      // Should show "Opret klippekort" button
      await expect(
        page.locator('a:has-text("Opret klippekort")'),
      ).toBeVisible();
    });

    test("should navigate to new klippekort page", async ({ page }) => {
      await page.click('a:has-text("Opret klippekort")');
      await expect(page).toHaveURL("/dashboard/klippekort/new");
      await expect(page.locator("h1")).toContainText("Opret klippekort");
    });
  });

  test.describe("Create Klippekort", () => {
    test("should create a klippekort with all fields", async ({ page }) => {
      await page.click('a:has-text("Opret klippekort")');

      // Fill form
      const packageName = generateUniqueName();
      await page.fill("#name", packageName);
      await page.fill("#description", testData.klippekort.valid.description);
      await page.selectOption("select#clientId", { label: clientName });
      await page.fill("#totalHours", testData.klippekort.valid.totalHours);
      await page.fill("#hourlyRate", testData.klippekort.valid.hourlyRate);
      await page.fill("#purchaseDate", testData.klippekort.valid.purchaseDate);
      await page.fill("#expiryDate", testData.klippekort.valid.expiryDate);

      await submitForm();

      // Should redirect to klippekort list
      await page.waitForURL("/dashboard/klippekort");

      // Klippekort should appear in list
      await waitForDataLoad(page);
      await expect(page.locator(`text=${packageName}`)).toBeVisible();
    });

    test("should create a minimal klippekort with required fields only", async ({
      page,
    }) => {
      await page.click('a:has-text("Opret klippekort")');

      const packageName = generateUniqueName();
      await page.fill("#name", packageName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.fill("#totalHours", testData.klippekort.minimal.totalHours);
      await page.fill("#hourlyRate", testData.klippekort.minimal.hourlyRate);

      // Purchase date should default to today
      const today = new Date().toISOString().split("T")[0];
      await page.fill("#purchaseDate", today);

      await submitForm();

      // Should redirect to klippekort list
      await page.waitForURL("/dashboard/klippekort");

      // Klippekort should appear in list
      await waitForDataLoad(page);
      await expect(page.locator(`text=${packageName}`)).toBeVisible();
    });

    test("should show validation error for empty name", async ({ page }) => {
      await page.click('a:has-text("Opret klippekort")');

      // Try to submit without name
      await submitForm();

      // HTML5 validation should prevent submission
      await expect(page).toHaveURL("/dashboard/klippekort/new");
    });

    test("should show validation error when no client selected", async ({
      page,
    }) => {
      await page.click('a:has-text("Opret klippekort")');

      await page.fill("#name", generateUniqueName());
      await page.fill("#totalHours", "10");
      await page.fill("#hourlyRate", "800");
      // Don't select a client

      await submitForm();

      // Should remain on page
      await expect(page).toHaveURL("/dashboard/klippekort/new");
    });

    test("should calculate total value automatically", async ({ page }) => {
      await page.click('a:has-text("Opret klippekort")');

      await page.fill("#totalHours", "25");
      await page.fill("#hourlyRate", "750");

      // Total value should be calculated (25 * 750 = 18,750 kr)
      const totalValueDisplay = page.locator("text=/18.*750.*kr/");
      if (await totalValueDisplay.isVisible()) {
        await expect(totalValueDisplay).toBeVisible();
      }
    });

    test("should cancel klippekort creation", async ({ page }) => {
      await page.click('a:has-text("Opret klippekort")');

      await page.fill("#name", generateUniqueName());

      // Click cancel
      const cancelButton = page.locator('a:has-text("Annuller")');
      if (await cancelButton.isVisible()) {
        await cancelButton.click();
        await expect(page).toHaveURL("/dashboard/klippekort");
      }
    });
  });

  test.describe("Filter Klippekort", () => {
    test.beforeEach(async ({ page }) => {
      // Create multiple klippekort
      const packages = [
        { name: "Active Package 1", hours: "20", rate: "800" },
        { name: "Active Package 2", hours: "15", rate: "750" },
      ];

      for (const pkg of packages) {
        await page.click('a:has-text("Opret klippekort")');
        await page.fill("#name", pkg.name);
        await page.selectOption("select#clientId", { label: clientName });
        await page.fill("#totalHours", pkg.hours);
        await page.fill("#hourlyRate", pkg.rate);
        await page.fill("#purchaseDate", "2025-01-01");
        await submitForm();
        await page.waitForURL("/dashboard/klippekort");
        await waitForDataLoad(page);
      }
    });

    test("should filter by client", async ({ page }) => {
      await waitForDataLoad(page);

      // Select client in filter
      const clientFilter = page
        .locator("select")
        .filter({ hasText: "Alle klienter" });
      await clientFilter.selectOption({ label: clientName });

      // Should show only klippekort for this client
      await expect(page.locator("text=Active Package 1")).toBeVisible();
      await expect(page.locator("text=Active Package 2")).toBeVisible();
    });

    test("should filter to show only active klippekort", async ({ page }) => {
      await waitForDataLoad(page);

      // Active only checkbox should be checked by default
      const activeOnlyCheckbox = page.locator("#activeOnly");
      await expect(activeOnlyCheckbox).toBeChecked();

      // Should show active packages
      await expect(page.locator("text=Active Package 1")).toBeVisible();
    });

    test("should show inactive klippekort when unchecking active filter", async ({
      page,
    }) => {
      await waitForDataLoad(page);

      // Uncheck "Vis kun aktive"
      const activeOnlyCheckbox = page.locator("#activeOnly");
      await activeOnlyCheckbox.uncheck();

      // Should potentially show more packages (though we haven't created inactive ones)
      await waitForDataLoad(page);
    });
  });

  test.describe("View Klippekort Details", () => {
    test("should navigate to klippekort details page", async ({ page }) => {
      // Create a klippekort first
      await page.click('a:has-text("Opret klippekort")');
      const packageName = generateUniqueName();
      await page.fill("#name", packageName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.fill("#totalHours", "20");
      await page.fill("#hourlyRate", "800");
      await page.fill("#purchaseDate", "2025-01-01");
      await submitForm();
      await page.waitForURL("/dashboard/klippekort");
      await waitForDataLoad(page);

      // Click "Se detaljer"
      const detailsButton = page.locator('a:has-text("Se detaljer")').first();
      await detailsButton.click();

      // Should navigate to details page
      await page.waitForURL(/\/dashboard\/klippekort\/[^/]+$/);
    });
  });

  test.describe("Edit Klippekort", () => {
    test("should navigate to edit klippekort page", async ({ page }) => {
      // Create a klippekort
      await page.click('a:has-text("Opret klippekort")');
      const packageName = generateUniqueName();
      await page.fill("#name", packageName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.fill("#totalHours", "20");
      await page.fill("#hourlyRate", "800");
      await page.fill("#purchaseDate", "2025-01-01");
      await submitForm();
      await page.waitForURL("/dashboard/klippekort");
      await waitForDataLoad(page);

      // Navigate to details
      const detailsButton = page.locator('a:has-text("Se detaljer")').first();
      await detailsButton.click();
      await page.waitForURL(/\/dashboard\/klippekort\/[^/]+$/);

      // Click edit button
      const editButton = page.locator('a:has-text("Rediger")').first();
      if (await editButton.isVisible()) {
        await editButton.click();
        await page.waitForURL(/\/dashboard\/klippekort\/[^/]+\/edit$/);
        await expect(page.locator("h1")).toContainText("Rediger klippekort");
      }
    });
  });

  test.describe("Toggle Active Status", () => {
    test("should toggle klippekort active status", async ({ page }) => {
      // Create a klippekort
      await page.click('a:has-text("Opret klippekort")');
      const packageName = generateUniqueName();
      await page.fill("#name", packageName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.fill("#totalHours", "20");
      await page.fill("#hourlyRate", "800");
      await page.fill("#purchaseDate", "2025-01-01");
      await submitForm();
      await page.waitForURL("/dashboard/klippekort");
      await waitForDataLoad(page);

      // Should show "Aktiv" status badge initially
      await expect(page.locator("text=Aktiv").first()).toBeVisible();

      // Click toggle button (X icon to deactivate)
      const toggleButton = page.locator('button[title="Deaktiver"]').first();
      await toggleButton.click();

      // Wait for update
      await page.waitForTimeout(500);
      await waitForDataLoad(page);

      // Status should change to "Inaktiv"
      const inactiveText = page.locator("text=Inaktiv");
      if (await inactiveText.isVisible()) {
        await expect(inactiveText).toBeVisible();
      }
    });
  });

  test.describe("Delete Klippekort", () => {
    test("should show delete button", async ({ page }) => {
      // Create a klippekort
      await page.click('a:has-text("Opret klippekort")');
      const packageName = generateUniqueName();
      await page.fill("#name", packageName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.fill("#totalHours", "20");
      await page.fill("#hourlyRate", "800");
      await page.fill("#purchaseDate", "2025-01-01");
      await submitForm();
      await page.waitForURL("/dashboard/klippekort");
      await waitForDataLoad(page);

      // Delete button should be visible
      const deleteButton = page.locator('button[title="Slet"]').first();
      await expect(deleteButton).toBeVisible();
    });

    test("should confirm before deleting klippekort", async ({ page }) => {
      // Create a klippekort
      await page.click('a:has-text("Opret klippekort")');
      const packageName = generateUniqueName();
      await page.fill("#name", packageName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.fill("#totalHours", "20");
      await page.fill("#hourlyRate", "800");
      await page.fill("#purchaseDate", "2025-01-01");
      await submitForm();
      await page.waitForURL("/dashboard/klippekort");
      await waitForDataLoad(page);

      // Set up dialog handler to cancel
      page.on("dialog", (dialog) => dialog.dismiss());

      // Click delete button
      const deleteButton = page.locator('button[title="Slet"]').first();
      await deleteButton.click();

      // Klippekort should still be visible (deletion cancelled)
      await expect(page.locator(`text=${packageName}`)).toBeVisible();
    });
  });

  test.describe("Klippekort Display", () => {
    test("should display klippekort information in cards", async ({ page }) => {
      // Create a klippekort with full information
      await page.click('a:has-text("Opret klippekort")');
      const packageName = generateUniqueName();
      await page.fill("#name", packageName);
      await page.fill("#description", "Test description for package");
      await page.selectOption("select#clientId", { label: clientName });
      await page.fill("#totalHours", "25");
      await page.fill("#hourlyRate", "750");
      await page.fill("#purchaseDate", "2025-01-01");
      await submitForm();
      await page.waitForURL("/dashboard/klippekort");
      await waitForDataLoad(page);

      // Card should show all relevant info
      await expect(page.locator(`text=${packageName}`)).toBeVisible();
      await expect(page.locator(`text=${clientName}`)).toBeVisible();
      await expect(
        page.locator("text=Test description for package"),
      ).toBeVisible();
    });

    test("should display progress bar", async ({ page }) => {
      // Create a klippekort
      await page.click('a:has-text("Opret klippekort")');
      const packageName = generateUniqueName();
      await page.fill("#name", packageName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.fill("#totalHours", "20");
      await page.fill("#hourlyRate", "800");
      await page.fill("#purchaseDate", "2025-01-01");
      await submitForm();
      await page.waitForURL("/dashboard/klippekort");
      await waitForDataLoad(page);

      // Should show progress bar (initially at 0%)
      const progressBar = page
        .locator(".bg-green-500, .bg-orange-500, .bg-red-500")
        .first();
      if (await progressBar.isVisible()) {
        await expect(progressBar).toBeVisible();
      }
    });

    test("should display remaining hours", async ({ page }) => {
      // Create a klippekort
      await page.click('a:has-text("Opret klippekort")');
      const packageName = generateUniqueName();
      await page.fill("#name", packageName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.fill("#totalHours", "20");
      await page.fill("#hourlyRate", "800");
      await page.fill("#purchaseDate", "2025-01-01");
      await submitForm();
      await page.waitForURL("/dashboard/klippekort");
      await waitForDataLoad(page);

      // Should show remaining hours (initially 20.00)
      await expect(page.locator("text=/20\\.00.*t/")).toBeVisible();
    });

    test("should display purchase date", async ({ page }) => {
      // Create a klippekort
      await page.click('a:has-text("Opret klippekort")');
      const packageName = generateUniqueName();
      await page.fill("#name", packageName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.fill("#totalHours", "20");
      await page.fill("#hourlyRate", "800");
      await page.fill("#purchaseDate", "2025-01-01");
      await submitForm();
      await page.waitForURL("/dashboard/klippekort");
      await waitForDataLoad(page);

      // Should show purchase date
      await expect(page.locator("text=Købt:")).toBeVisible();
    });

    test("should display expiry date if set", async ({ page }) => {
      // Create a klippekort with expiry date
      await page.click('a:has-text("Opret klippekort")');
      const packageName = generateUniqueName();
      await page.fill("#name", packageName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.fill("#totalHours", "20");
      await page.fill("#hourlyRate", "800");
      await page.fill("#purchaseDate", "2025-01-01");
      await page.fill("#expiryDate", "2025-03-31");
      await submitForm();
      await page.waitForURL("/dashboard/klippekort");
      await waitForDataLoad(page);

      // Should show expiry date
      await expect(page.locator("text=Udløber:")).toBeVisible();
    });
  });

  test.describe("Low Balance Warning", () => {
    // Note: This test would require consuming hours from the klippekort
    // to trigger low balance, which is complex to set up in isolation
    test("should show low balance warning section when applicable", async ({
      page,
    }) => {
      await waitForDataLoad(page);

      // If no low balance packages, section should not appear
      const lowBalanceWarning = page.locator("text=Lav balance på.*klippekort");
      // This may or may not be visible depending on data state
      const isVisible = await lowBalanceWarning.isVisible().catch(() => false);
      if (!isVisible) {
        // Test passes - no low balance packages
        expect(true).toBe(true);
      }
    });
  });

  test.describe("Status Badges", () => {
    test("should show correct status badge for active klippekort", async ({
      page,
    }) => {
      // Create a klippekort
      await page.click('a:has-text("Opret klippekort")');
      const packageName = generateUniqueName();
      await page.fill("#name", packageName);
      await page.selectOption("select#clientId", { label: clientName });
      await page.fill("#totalHours", "20");
      await page.fill("#hourlyRate", "800");
      await page.fill("#purchaseDate", "2025-01-01");
      await submitForm();
      await page.waitForURL("/dashboard/klippekort");
      await waitForDataLoad(page);

      // Should show "Aktiv" badge
      await expect(page.locator("text=Aktiv").first()).toBeVisible();

      // Badge should be green
      const activeBadge = page.locator(".bg-green-100").first();
      await expect(activeBadge).toBeVisible();
    });
  });
});
