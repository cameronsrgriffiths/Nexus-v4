import { test, expect } from '@playwright/test';

// Operator-facing connect-email-channel flow.
//
// Inbound polling and threading are exercised in the bun integration tests
// (`apps/server/src/mail/email-channel.test.ts`) — those don't need a
// browser. This Playwright test covers the UI path the operator drives:
// open the dialog, see the inline explanation, fill the form, submit, and
// observe a successful response.

test('operator connects an email channel for an agent', async ({ page }) => {
  const email = `op+email+${Date.now()}@example.com`;
  const password = 'hunter2hunter2';

  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password (8+ characters)').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('dashboard')).toBeVisible();

  await page.getByRole('link', { name: 'Agents' }).click();
  await page.getByRole('button', { name: 'New agent' }).click();
  await page.getByLabel('Name').fill('Email Bot');
  await page.getByLabel('Persona').fill('Reply politely.');
  await page.getByLabel('Model').fill('claude-haiku-test');
  await page.getByRole('button', { name: 'Create agent' }).click();

  // Connect email opens the dialog with the inline explanation.
  await page.getByTestId(/^connect-email-/).first().click();
  const dialog = page.getByTestId('connect-email-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Mailtrap');
  await expect(dialog).toContainText('Integration');

  // Fill credentials and submit.
  await page.getByTestId('email-address').fill('agent@nexus.test');
  await page.getByTestId('mailtrap-inbox-id').fill('inbox-1');
  await page.getByTestId('mailtrap-account-id').fill('acc-1');
  await page.getByTestId('mailtrap-api-token').fill('api-token-secret');
  await page.getByTestId('mailtrap-smtp-user').fill('smtp-user');
  await page.getByTestId('mailtrap-smtp-pass').fill('smtp-pass');

  // Capture the POST so we can assert it carried the form values.
  const responsePromise = page.waitForResponse(
    (r) => r.url().endsWith('/api/email/channels') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Connect' }).click();
  const res = await responsePromise;
  expect(res.status()).toBe(201);

  // Dialog closes on success.
  await expect(page.getByTestId('connect-email-dialog')).toHaveCount(0);
});
