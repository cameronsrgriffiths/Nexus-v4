import { test, expect } from '@playwright/test';

test('agent CRUD: create → list → edit → delete', async ({ page }) => {
  // Each Playwright run boots a fresh DB so a fixed email is fine.
  const email = `op+agents+${Date.now()}@example.com`;
  const password = 'hunter2hunter2';

  // Register and land on dashboard.
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password (8+ characters)').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('dashboard')).toBeVisible();

  // Navigate to Agents.
  await page.getByRole('link', { name: 'Agents' }).click();
  await expect(page.getByTestId('agents-page')).toBeVisible();
  await expect(page.getByTestId('agents-empty')).toBeVisible();

  // Create.
  await page.getByRole('button', { name: 'New agent' }).click();
  await page.getByLabel('Name').fill('Sales Bot');
  await page.getByLabel('Persona').fill('Friendly sales rep.');
  await page.getByLabel('Model').fill('gpt-4o-mini');
  await page.getByRole('button', { name: 'Create agent' }).click();

  // Appears in the list.
  const list = page.getByTestId('agents-list');
  await expect(list).toBeVisible();
  await expect(list.getByText('Sales Bot')).toBeVisible();
  await expect(list.getByText('voice off')).toBeVisible();

  // Edit: change persona + model + flip voice on.
  await list.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Persona').fill('Enthusiastic sales rep.');
  await page.getByLabel('Model').fill('gpt-4o');
  await page.getByTestId('voice-enabled').check();
  await page.getByRole('button', { name: 'Save changes' }).click();

  // Change persists: list shows new model + voice on.
  await expect(list.getByText('gpt-4o · voice on')).toBeVisible();

  // Reload and re-confirm to prove it's persisted, not just optimistic UI.
  await page.reload();
  await expect(page.getByTestId('agents-list').getByText('gpt-4o · voice on')).toBeVisible();

  // Delete via confirmation dialog.
  await page.getByTestId('agents-list').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('delete-confirm')).toBeVisible();
  await page.getByTestId('delete-confirm').getByRole('button', { name: 'Delete' }).click();

  // Removed.
  await expect(page.getByTestId('agents-empty')).toBeVisible();
});
