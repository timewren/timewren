import { expect, test } from "@playwright/test";
import {
  expectErrorMessage,
  expectToBeOnDashboard,
  expectToBeOnLoginPage,
  generateUniqueEmail,
  login,
  logout,
  register,
  testData,
} from "./helpers";

// Legacy-suite fra TimeCraft-æraen — genoplives spec for spec efter behov.
test.skip(
  true,
  "forældet (TimeCraft-UI, #confirmPassword, auto-login uden e-mailbekræftelse); dækket af auth.setup.ts + core-flow.spec.ts",
);

test.describe("Authentication", () => {
  test.describe("Registration", () => {
    test("should register a new user successfully", async ({ page }) => {
      const uniqueEmail = generateUniqueEmail();

      await page.goto("/register");

      // Fill registration form
      await page.fill("#name", testData.users.new.name);
      await page.fill("#email", uniqueEmail);
      await page.fill("#password", testData.users.new.password);
      await page.fill("#confirmPassword", testData.users.new.password);
      await page.check("#terms");

      // Submit form
      await page.click('button[type="submit"]');

      // Should redirect to dashboard
      await page.waitForURL("/dashboard", { timeout: 10000 });
      await expectToBeOnDashboard(page);

      // Verify user name appears in dashboard
      await expect(page.locator("h1")).toContainText("Velkommen tilbage");
    });

    test("should show error when passwords don't match", async ({ page }) => {
      await page.goto("/register");

      await page.fill("#name", testData.users.new.name);
      await page.fill("#email", generateUniqueEmail());
      await page.fill("#password", "Password123!");
      await page.fill("#confirmPassword", "DifferentPassword123!");
      await page.check("#terms");

      await page.click('button[type="submit"]');

      // Should show error message
      await expectErrorMessage(page, "Adgangskoderne matcher ikke");
    });

    test("should show error when password is too short", async ({ page }) => {
      await page.goto("/register");

      await page.fill("#name", testData.users.new.name);
      await page.fill("#email", generateUniqueEmail());
      await page.fill("#password", "Short1!");
      await page.fill("#confirmPassword", "Short1!");
      await page.check("#terms");

      await page.click('button[type="submit"]');

      // Should show error message
      await expectErrorMessage(page, "Adgangskode skal være mindst 8 tegn");
    });

    test("should show password requirements indicator", async ({ page }) => {
      await page.goto("/register");

      // Initially, requirements should show as not met
      const passwordInput = page.locator("#password");
      await passwordInput.fill("test");

      // Check that requirement indicators are present
      await expect(page.locator("text=Mindst 8 tegn")).toBeVisible();
      await expect(page.locator("text=Adgangskoderne matcher")).toBeVisible();

      // Fill password correctly
      await passwordInput.fill("Test1234!");
      await page.fill("#confirmPassword", "Test1234!");

      // Requirements should be met (green checkmarks)
      const checkmarks = page.locator(".text-green-600");
      await expect(checkmarks).toHaveCount(2);
    });

    test("should require terms acceptance", async ({ page }) => {
      await page.goto("/register");

      await page.fill("#name", testData.users.new.name);
      await page.fill("#email", generateUniqueEmail());
      await page.fill("#password", testData.users.new.password);
      await page.fill("#confirmPassword", testData.users.new.password);
      // Don't check terms checkbox

      // HTML5 validation should prevent submission
      const submitButton = page.locator('button[type="submit"]');
      await submitButton.click();

      // Should still be on register page
      await expect(page).toHaveURL("/register");
    });

    test("should navigate to login page from register page", async ({
      page,
    }) => {
      await page.goto("/register");

      await page.click('a:has-text("log ind på eksisterende konto")');
      await expectToBeOnLoginPage(page);
    });
  });

  test.describe("Login", () => {
    test("should login with valid credentials", async ({ page }) => {
      // First register a user
      const uniqueEmail = generateUniqueEmail();
      await register(
        page,
        testData.users.new.name,
        uniqueEmail,
        testData.users.new.password,
      );

      // Logout
      await logout(page);

      // Now try to login
      await login(page, uniqueEmail, testData.users.new.password);

      // Should be on dashboard
      await expectToBeOnDashboard(page);
    });

    test("should show error with invalid email", async ({ page }) => {
      await page.goto("/login");

      await page.fill("#email", "nonexistent@example.dk");
      await page.fill("#password", "WrongPassword123!");
      await page.click('button[type="submit"]');

      // Should show error
      await expectErrorMessage(page, "Forkert email eller adgangskode");

      // Should still be on login page
      await expect(page).toHaveURL("/login");
    });

    test("should show error with invalid password", async ({ page }) => {
      // First register a user
      const uniqueEmail = generateUniqueEmail();
      await register(
        page,
        testData.users.new.name,
        uniqueEmail,
        testData.users.new.password,
      );
      await logout(page);

      // Try to login with wrong password
      await page.goto("/login");
      await page.fill("#email", uniqueEmail);
      await page.fill("#password", "WrongPassword123!");
      await page.click('button[type="submit"]');

      // Should show error
      await expectErrorMessage(page, "Forkert email eller adgangskode");
    });

    test("should navigate to register page from login page", async ({
      page,
    }) => {
      await page.goto("/login");

      await page.click('a:has-text("opret en ny konto")');
      await expect(page).toHaveURL("/register");
      await expect(page.locator("h2")).toContainText("Opret din konto");
    });

    test("should show loading state during login", async ({ page }) => {
      const uniqueEmail = generateUniqueEmail();
      await register(
        page,
        testData.users.new.name,
        uniqueEmail,
        testData.users.new.password,
      );
      await logout(page);

      await page.goto("/login");
      await page.fill("#email", uniqueEmail);
      await page.fill("#password", testData.users.new.password);

      const submitButton = page.locator('button[type="submit"]');
      await submitButton.click();

      // Should briefly show loading state
      await expect(submitButton).toContainText("Logger ind...");
    });
  });

  test.describe("Logout", () => {
    test("should logout successfully", async ({ page }) => {
      // Register and login
      const uniqueEmail = generateUniqueEmail();
      await register(
        page,
        testData.users.new.name,
        uniqueEmail,
        testData.users.new.password,
      );

      // Verify we're on dashboard
      await expectToBeOnDashboard(page);

      // Open user menu
      const userMenuButton = page.locator('button:has-text("Log ud")').first();
      await userMenuButton.click();

      // Should redirect to login page
      await expectToBeOnLoginPage(page);
    });

    test("should not be able to access dashboard after logout", async ({
      page,
    }) => {
      // Register and login
      const uniqueEmail = generateUniqueEmail();
      await register(
        page,
        testData.users.new.name,
        uniqueEmail,
        testData.users.new.password,
      );

      // Logout
      await logout(page);

      // Try to access dashboard
      await page.goto("/dashboard");

      // Should redirect to login page
      await page.waitForURL(/\/login|\/$/, { timeout: 15000 });
    });
  });

  test.describe("Session Persistence", () => {
    test("should maintain session after page reload", async ({ page }) => {
      // Register and login
      const uniqueEmail = generateUniqueEmail();
      await register(
        page,
        testData.users.new.name,
        uniqueEmail,
        testData.users.new.password,
      );

      // Reload page
      await page.reload();

      // Should still be logged in
      await expectToBeOnDashboard(page);
    });

    test("should maintain session in new tab", async ({ context, page }) => {
      // Register and login
      const uniqueEmail = generateUniqueEmail();
      await register(
        page,
        testData.users.new.name,
        uniqueEmail,
        testData.users.new.password,
      );

      // Open new tab
      const newPage = await context.newPage();
      await newPage.goto("/dashboard");

      // Should be logged in on new tab
      await expectToBeOnDashboard(newPage);

      await newPage.close();
    });
  });

  test.describe("Protected Routes", () => {
    test("should redirect to login when accessing protected route without auth", async ({
      page,
    }) => {
      await page.goto("/dashboard/clients");

      // Should redirect to login or home page
      await page.waitForURL(/\/login|\/$/, { timeout: 15000 });
    });

    test("should redirect to login when accessing time tracking without auth", async ({
      page,
    }) => {
      await page.goto("/dashboard/time");

      // Should redirect to login or home page
      await page.waitForURL(/\/login|\/$/, { timeout: 15000 });
    });
  });

  test.describe("Navigation", () => {
    test("should navigate back to homepage from login", async ({ page }) => {
      await page.goto("/login");

      await page.click('a:has-text("Tilbage til forsiden")');
      await expect(page).toHaveURL("/");
    });

    test("should navigate back to homepage from register", async ({ page }) => {
      await page.goto("/register");

      await page.click('a:has-text("Tilbage til forsiden")');
      await expect(page).toHaveURL("/");
    });
  });
});
