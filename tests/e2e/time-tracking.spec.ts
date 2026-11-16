import { expect, test } from "@playwright/test";
import {
  fillClientForm,
  generateUniqueEmail,
  generateUniqueName,
  navigateToClients,
  navigateToProjects,
  navigateToTime,
  register,
  submitForm,
  testData,
  waitForDataLoad,
} from "./helpers";

// Legacy-suite fra TimeCraft-æraen — genoplives spec for spec efter behov.
test.skip(
  true,
  "forældet (TimeCraft-timer/-formular); kerneflowet dækkes af core-flow.spec.ts",
);

test.describe("Time Tracking", () => {
  let clientName: string;
  let projectName: string;

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

    // Create a project
    projectName = generateUniqueName();
    await navigateToProjects(page);
    await page.click('a:has-text("Nyt projekt")');
    await page.fill("#name", projectName);
    await page.selectOption("select#clientId", { label: clientName });
    await page.check("#pricingType-hourly");
    await page.fill("#hourlyRate", "800");
    await submitForm();
    await page.waitForURL("/dashboard/projects");

    // Navigate to time tracking page
    await navigateToTime(page);
  });

  test.describe("Time Tracking Page", () => {
    test("should display time tracking page", async ({ page }) => {
      await expect(page).toHaveURL("/dashboard/time");
      await expect(page.locator("h1")).toContainText("Tidsregistrering");
      await expect(
        page.locator("text=Registrér tid på dine kunder og projekter"),
      ).toBeVisible();
    });

    test("should show timer widget", async ({ page }) => {
      // Timer should display 00:00:00
      await expect(page.locator("text=00:00:00")).toBeVisible();

      // Should have play/pause and stop buttons
      const playButton = page
        .locator("button:has(svg)")
        .filter({ has: page.locator('[class*="lucide-play"]') });
      await expect(playButton).toBeVisible();
    });

    test("should show tracking mode selector", async ({ page }) => {
      await expect(page.locator("text=Track på projekt")).toBeVisible();
      await expect(page.locator("text=Track på klient")).toBeVisible();
    });

    test("should show empty time entries state", async ({ page }) => {
      await waitForDataLoad(page);

      // Should show empty state
      await expect(
        page.locator("text=Ingen tidsposteringer for denne dag"),
      ).toBeVisible();
    });
  });

  test.describe("Timer - Project Mode", () => {
    test("should select project and start timer", async ({ page }) => {
      // Select project
      const projectSelect = page.locator("select").first();
      await projectSelect.selectOption({ label: new RegExp(projectName) });

      // Enter description
      await page.fill(
        'input[placeholder="Hvad arbejder du på?"]',
        testData.timeEntries.valid.description,
      );

      // Start timer
      const playButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-play"]') });
      await playButton.click();

      // Timer should start (pause button should appear)
      await page.waitForTimeout(1000);
      const pauseButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-pause"]') });
      await expect(pauseButton).toBeVisible();
    });

    test("should pause and resume timer", async ({ page }) => {
      // Select project and start timer
      const projectSelect = page.locator("select").first();
      await projectSelect.selectOption({ label: new RegExp(projectName) });

      const playButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-play"]') });
      await playButton.click();

      // Wait a bit
      await page.waitForTimeout(2000);

      // Pause timer
      const pauseButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-pause"]') });
      await pauseButton.click();

      // Play button should reappear
      await expect(playButton).toBeVisible();

      // Resume timer
      await playButton.click();
      await expect(pauseButton).toBeVisible();
    });

    test("should stop timer and create time entry", async ({ page }) => {
      // Select project and start timer
      const projectSelect = page.locator("select").first();
      await projectSelect.selectOption({ label: new RegExp(projectName) });

      await page.fill(
        'input[placeholder="Hvad arbejder du på?"]',
        testData.timeEntries.valid.description,
      );

      const playButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-play"]') });
      await playButton.click();

      // Wait for some time to accumulate
      await page.waitForTimeout(3000);

      // Stop timer
      const stopButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-square"]') });
      await stopButton.click();

      // Time entry should appear in the list
      await waitForDataLoad(page);
      await expect(
        page.locator(`text=${testData.timeEntries.valid.description}`),
      ).toBeVisible();
    });

    test("should not allow starting timer without project selected", async ({
      page,
    }) => {
      // Try to start timer without selecting project
      const playButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-play"]') });
      await expect(playButton).toBeDisabled();
    });

    test("should update description while timer is running", async ({
      page,
    }) => {
      // Select project and start timer
      const projectSelect = page.locator("select").first();
      await projectSelect.selectOption({ label: new RegExp(projectName) });

      const playButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-play"]') });
      await playButton.click();

      // Update description while running
      const descriptionInput = page.locator(
        'input[placeholder="Hvad arbejder du på?"]',
      );
      await descriptionInput.clear();
      await descriptionInput.fill("Updated task description");

      // Description should be updated
      await expect(descriptionInput).toHaveValue("Updated task description");
    });
  });

  test.describe("Timer - Client Mode", () => {
    test("should switch to client mode", async ({ page }) => {
      // Click on "Track på klient" button
      const clientModeButton = page.locator(
        'button:has-text("Track på klient")',
      );
      await clientModeButton.click();

      // Client mode should be active
      await expect(clientModeButton).toHaveClass(/bg-tt-gran/);

      // Client selector should be visible
      const clientSelect = page
        .locator("select")
        .filter({ hasText: "Vælg kunde" });
      await expect(clientSelect).toBeVisible();
    });

    test("should start timer for client without project", async ({ page }) => {
      // Switch to client mode
      const clientModeButton = page.locator(
        'button:has-text("Track på klient")',
      );
      await clientModeButton.click();

      // Select client
      const clientSelect = page
        .locator("select")
        .filter({ hasText: "Vælg kunde" });
      await clientSelect.selectOption({ label: clientName });

      // Enter description
      await page.fill(
        'input[placeholder="Hvad arbejder du på?"]',
        "General client work",
      );

      // Start timer
      const playButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-play"]') });
      await playButton.click();

      // Timer should start
      await page.waitForTimeout(1000);
      const pauseButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-pause"]') });
      await expect(pauseButton).toBeVisible();
    });

    test("should not allow switching mode while timer is running", async ({
      page,
    }) => {
      // Start timer in project mode
      const projectSelect = page.locator("select").first();
      await projectSelect.selectOption({ label: new RegExp(projectName) });

      const playButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-play"]') });
      await playButton.click();

      // Try to switch to client mode
      const clientModeButton = page.locator(
        'button:has-text("Track på klient")',
      );
      await expect(clientModeButton).toBeDisabled();
    });
  });

  test.describe("Time Entries List", () => {
    test("should display time entry after creation", async ({ page }) => {
      // Create a time entry via timer
      const projectSelect = page.locator("select").first();
      await projectSelect.selectOption({ label: new RegExp(projectName) });

      await page.fill(
        'input[placeholder="Hvad arbejder du på?"]',
        testData.timeEntries.valid.description,
      );

      const playButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-play"]') });
      await playButton.click();
      await page.waitForTimeout(2000);

      const stopButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-square"]') });
      await stopButton.click();

      // Check time entry appears in list
      await waitForDataLoad(page);
      await expect(
        page.locator(`text=${testData.timeEntries.valid.description}`),
      ).toBeVisible();
      await expect(page.locator(`text=${clientName}`)).toBeVisible();
      await expect(page.locator(`text=${projectName}`)).toBeVisible();
    });

    test("should show time entry with hours", async ({ page }) => {
      // Create a time entry
      const projectSelect = page.locator("select").first();
      await projectSelect.selectOption({ label: new RegExp(projectName) });

      await page.fill('input[placeholder="Hvad arbejder du på?"]', "Test task");

      const playButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-play"]') });
      await playButton.click();
      await page.waitForTimeout(3000);

      const stopButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-square"]') });
      await stopButton.click();

      // Should show hours in format like "0.05t"
      await waitForDataLoad(page);
      const hoursDisplay = page
        .locator("span.font-mono")
        .filter({ hasText: "t" });
      await expect(hoursDisplay).toBeVisible();
    });

    test("should delete time entry", async ({ page }) => {
      // Create a time entry first
      const projectSelect = page.locator("select").first();
      await projectSelect.selectOption({ label: new RegExp(projectName) });

      const description = "Entry to delete";
      await page.fill('input[placeholder="Hvad arbejder du på?"]', description);

      const playButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-play"]') });
      await playButton.click();
      await page.waitForTimeout(2000);

      const stopButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-square"]') });
      await stopButton.click();

      await waitForDataLoad(page);

      // Set up dialog handler
      page.on("dialog", (dialog) => dialog.accept());

      // Delete the entry
      const deleteButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-trash"]') })
        .first();
      await deleteButton.click();

      // Entry should be removed
      await page.waitForTimeout(500);
      await expect(page.locator(`text=${description}`)).not.toBeVisible();
    });
  });

  test.describe("Date Selection", () => {
    test("should show date selector", async ({ page }) => {
      const dateInput = page.locator('input[type="date"]');
      await expect(dateInput).toBeVisible();
    });

    test("should change date and update time entries", async ({ page }) => {
      // Set date to yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      const dateInput = page.locator('input[type="date"]');
      await dateInput.fill(yesterdayStr);

      // Should show empty state for yesterday
      await waitForDataLoad(page);
      await expect(
        page.locator("text=Ingen tidsposteringer for denne dag"),
      ).toBeVisible();
    });

    test("should show total hours for selected date", async ({ page }) => {
      // Create a time entry for today
      const projectSelect = page.locator("select").first();
      await projectSelect.selectOption({ label: new RegExp(projectName) });

      const playButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-play"]') });
      await playButton.click();
      await page.waitForTimeout(3000);

      const stopButton = page
        .locator("button")
        .filter({ has: page.locator('[class*="lucide-square"]') });
      await stopButton.click();

      await waitForDataLoad(page);

      // Should show total hours
      const totalDisplay = page.locator("text=/Total:.*t.*m/");
      await expect(totalDisplay).toBeVisible();
    });
  });

  test.describe("Klippekort Integration", () => {
    test("should not show klippekort option without active packages", async ({
      page,
    }) => {
      // Without creating a klippekort, the option should not appear
      const prepaidCheckbox = page.locator('input[type="checkbox"]#usePrepaid');
      await expect(prepaidCheckbox).not.toBeVisible();
    });

    // Note: Full klippekort integration tested in klippekort.spec.ts
  });

  test.describe("Time Display", () => {
    test("should show time in HH:MM:SS format", async ({ page }) => {
      // Timer display should be in correct format
      await expect(page.locator("text=00:00:00")).toBeVisible();
    });

    test("should increment timer when running", async ({ page }) => {
      // Select project and start timer
      const projectSelect = page.locator("select").first();
      await projectSelect.selectOption({ label: new RegExp(projectName) });

      const startButton = page.getByRole("button", { name: "Start timer" });
      await startButton.click();

      // Wait until timer increments (avoid flaky fixed sleep)
      const timerDisplay = page.locator("div.text-4xl.font-mono.font-bold");

      await expect
        .poll(async () => (await timerDisplay.textContent())?.trim(), {
          timeout: 10000,
        })
        .not.toBe("00:00:00");
    });
  });

  test.describe("Validation", () => {
    test("should require project or client selection to start timer", async ({
      page,
    }) => {
      const startButton = page.getByRole("button", { name: "Start timer" });
      await expect(startButton).toBeDisabled();
    });

    test("should show stop button only when timer is active", async ({
      page,
    }) => {
      const stopButton = page.getByRole("button", { name: "Stop timer" });

      // Initially, stop button should not be visible
      await expect(stopButton).not.toBeVisible();

      // Start timer
      const projectSelect = page.locator("select").first();
      await projectSelect.selectOption({ label: new RegExp(projectName) });

      const startButton = page.getByRole("button", { name: "Start timer" });
      await startButton.click();

      // Now stop button should be visible
      await expect(stopButton).toBeVisible();
    });
  });
});
