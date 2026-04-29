import { test, expect } from '@playwright/test';

test('register → dashboard → logout → log back in → dashboard', async ({ page }) => {
  // Each Playwright run starts against a freshly-booted, empty DB,
  // so we can use a fixed email and trust uniqueness.
  const email = `op+${Date.now()}@example.com`;
  const password = 'hunter2hunter2';

  // Register
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password (8+ characters)').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Lands on the dashboard (the AppShell renders the sidebar and the placeholder).
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await expect(page.getByTestId('signed-in-as')).toHaveText(email);

  // Logout returns us to the login page.
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Log back in lands on the dashboard.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await expect(page.getByTestId('signed-in-as')).toHaveText(email);
});
