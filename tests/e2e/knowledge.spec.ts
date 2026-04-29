import { test, expect } from '@playwright/test';

// Knowledge conflict UI E2E.
//
// 1. Operator registers, navigates to the Knowledge page deeplink.
// 2. Test API seeds a knowledge page so the operator has something to load.
// 3. Operator loads the page (records its version), edits the draft.
// 4. Test API performs an agent overwrite — bumps the version.
// 5. Operator saves → conflict dialog appears.
// 6. The two buttons are exercised in separate test runs.

async function setupOperatorWithSeededPage(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  emailSuffix: string,
) {
  const email = `op+knowledge+${emailSuffix}+${Date.now()}@example.com`;
  const password = 'hunter2hunter2';
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password (8+ characters)').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('dashboard')).toBeVisible();

  // Resolve the operator's org id via the test API.
  const orgRes = await request.get(`/api/_test/org-id?email=${encodeURIComponent(email)}`);
  expect(orgRes.ok()).toBeTruthy();
  const { orgId } = (await orgRes.json()) as { orgId: string };

  // Seed a contact-scoped knowledge page as the agent.
  const scopeId = crypto.randomUUID();
  const title = 'allergies';
  const seedRes = await request.post('/api/_test/knowledge', {
    data: {
      orgId,
      scope: 'contact',
      scopeId,
      mode: 'create',
      title,
      content: 'peanuts',
    },
  });
  expect(seedRes.ok()).toBeTruthy();

  // Navigate to the knowledge editor with the deeplink.
  await page.goto(`/knowledge?scope=contact&scopeId=${scopeId}&title=${title}`);
  await expect(page.getByTestId('knowledge-page')).toBeVisible();
  await expect(page.getByTestId('knowledge-content')).toHaveValue('peanuts');
  await expect(page.getByTestId('knowledge-version')).toHaveText('1');

  return { orgId, scopeId, title };
}

async function triggerAgentOverwrite(
  request: import('@playwright/test').APIRequestContext,
  orgId: string,
  scopeId: string,
  title: string,
  content: string,
) {
  const res = await request.post('/api/_test/knowledge', {
    data: {
      orgId,
      scope: 'contact',
      scopeId,
      mode: 'overwrite',
      title,
      content,
      version: 1,
    },
  });
  expect(res.ok()).toBeTruthy();
}

test('conflict dialog: "Restart my edit" reloads current content and discards the draft', async ({
  page,
  request,
}) => {
  const { orgId, scopeId, title } = await setupOperatorWithSeededPage(page, request, 'restart');

  // Operator types a draft.
  await page.getByTestId('knowledge-content').fill('peanuts and shellfish');

  // Agent overwrites the page.
  await triggerAgentOverwrite(request, orgId, scopeId, title, 'agent rewrote everything');

  // Operator saves → conflict dialog with both buttons.
  await page.getByTestId('knowledge-save').click();
  const dialog = page.getByTestId('knowledge-conflict-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('knowledge-conflict-current')).toHaveText(
    'agent rewrote everything',
  );
  await expect(dialog.getByTestId('knowledge-restart')).toBeVisible();
  await expect(dialog.getByTestId('knowledge-force')).toBeVisible();

  // "Restart my edit" → reload current content, discard draft.
  await dialog.getByTestId('knowledge-restart').click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId('knowledge-content')).toHaveValue('agent rewrote everything');
  await expect(page.getByTestId('knowledge-version')).toHaveText('2');
});

test('conflict dialog: "Force my version" commits the operator content and logs the lost write', async ({
  page,
  request,
}) => {
  const { orgId, scopeId, title } = await setupOperatorWithSeededPage(page, request, 'force');

  // Operator types a draft.
  await page.getByTestId('knowledge-content').fill('operator-final-content');

  // Agent overwrites the page.
  await triggerAgentOverwrite(request, orgId, scopeId, title, 'agent rewrote everything');

  // Operator saves → conflict dialog.
  await page.getByTestId('knowledge-save').click();
  const dialog = page.getByTestId('knowledge-conflict-dialog');
  await expect(dialog).toBeVisible();

  // "Force my version" → commits operator content, dialog dismisses.
  await dialog.getByTestId('knowledge-force').click();
  await expect(dialog).not.toBeVisible();

  // Operator's content is now the live content. Version bumped to 3 (create
  // → agent overwrite → operator force).
  await expect(page.getByTestId('knowledge-content')).toHaveValue('operator-final-content');
  await expect(page.getByTestId('knowledge-version')).toHaveText('3');

  // Force commits show a status banner mentioning the agent's lost write was
  // logged, so the operator knows the audit trail captured it.
  await expect(page.getByTestId('knowledge-status')).toContainText(/logged/i);
});
