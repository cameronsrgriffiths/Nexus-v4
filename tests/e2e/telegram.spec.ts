import { test, expect, request } from '@playwright/test';

// End-to-end: operator connects a Telegram bot via the UI, an inbound
// Telegram update fires at /telegram/webhook/<botId>, and the operator sees
// the conversation in the conversation view.

test('Telegram: operator connects a bot, inbound webhook lands in conversation view', async ({
  page,
  baseURL,
}) => {
  const email = `op+tg+${Date.now()}@example.com`;
  const password = 'hunter2hunter2';
  const botId = String(100000 + Math.floor(Math.random() * 899999));
  const botToken = `${botId}:e2e-token-${Date.now()}`;
  const visitorChatId = 700000 + Math.floor(Math.random() * 99999);

  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password (8+ characters)').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('dashboard')).toBeVisible();

  // Create an agent.
  await page.getByRole('link', { name: 'Agents' }).click();
  await page.getByRole('button', { name: 'New agent' }).click();
  await page.getByLabel('Name').fill('Telegram Concierge');
  await page.getByLabel('Persona').fill('Friendly concierge.');
  await page.getByLabel('Model').fill('claude-haiku-test');
  await page.getByRole('button', { name: 'Create agent' }).click();
  await expect(page.getByTestId('agents-list')).toBeVisible();

  // Open the Telegram connect form. PRD: non-obvious flows need an inline
  // explanation — assert the BotFather + setWebhook copy is present.
  await page.getByTestId(/^agent-connect-telegram-/).click();
  const form = page.getByTestId(/^telegram-connect-form-/);
  await expect(form).toBeVisible();
  await expect(form).toContainText(/BotFather/);
  await expect(form).toContainText('/telegram/webhook/');

  await form
    .getByLabel(/Bot token/)
    .fill(botToken);
  await form.getByRole('button', { name: 'Save Telegram channel' }).click();

  // After save, the row shows the connected bot id.
  await expect(page.getByTestId(/^agent-telegram-channel-/)).toContainText(botId);

  // Hit the inbound webhook directly with a Telegram-shaped Update — this is
  // what api.telegram.org POSTs in production once setWebhook is configured.
  const webhookUrl = `${baseURL!.replace(/\/$/, '')}/telegram/webhook/${botId}`;
  const ctx = await request.newContext();
  const res = await ctx.post(webhookUrl, {
    headers: { 'content-type': 'application/json' },
    data: {
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: visitorChatId, is_bot: false, first_name: 'Visitor' },
        chat: { id: visitorChatId, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: 'when can I drop by?',
      },
    },
  });
  expect(res.status()).toBe(200);
  await ctx.dispose();

  // Operator opens the Conversations page; the Telegram conversation lists,
  // its detail shows the user message and the agent's reply.
  await page.getByRole('link', { name: 'Conversations' }).click();
  await expect(page.getByTestId('conversations-page')).toBeVisible();

  const row = page.getByTestId(/^conversation-row-/);
  await expect(row.first()).toBeVisible();
  await row.first().click();

  await expect(page.getByTestId('conversation-message-user')).toContainText(
    'when can I drop by?',
  );
  await expect(page.getByTestId('conversation-message-assistant')).toContainText(
    'Echo: when can I drop by?',
  );
});
