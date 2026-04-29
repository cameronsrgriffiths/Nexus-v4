import { test, expect } from '@playwright/test';

// First end-to-end: a JS widget on a test page sends a message to the
// headless runtime, the runtime replies, the widget renders the reply, and
// the operator UI shows the same conversation.

test('widget chat: send "hello" → see agent reply in widget AND in operator UI', async ({
  browser,
}) => {
  // 1. Operator registers and creates an agent (which auto-provisions a
  //    widget channel).
  const operatorContext = await browser.newContext();
  const operator = await operatorContext.newPage();
  const email = `op+widget+${Date.now()}@example.com`;
  const password = 'hunter2hunter2';

  await operator.goto('/register');
  await operator.getByLabel('Email').fill(email);
  await operator.getByLabel('Password (8+ characters)').fill(password);
  await operator.getByRole('button', { name: 'Create account' }).click();
  await expect(operator.getByTestId('dashboard')).toBeVisible();

  await operator.getByRole('link', { name: 'Agents' }).click();
  await operator.getByRole('button', { name: 'New agent' }).click();
  await operator.getByLabel('Name').fill('Widget Bot');
  await operator.getByLabel('Persona').fill('Cheerfully echo whatever a visitor says.');
  await operator.getByLabel('Model').fill('claude-haiku-test');
  await operator.getByRole('button', { name: 'Create agent' }).click();

  const widgetSlot = operator.getByTestId(/^agent-widget-channel-/);
  await expect(widgetSlot).toBeVisible();
  const widgetText = (await widgetSlot.textContent()) ?? '';
  const channelId = widgetText.replace(/^widget:\s*/, '').trim();
  expect(channelId).toMatch(/^[0-9a-f-]{36}$/);

  // 2. Visitor (separate browser context — different sessionStorage, different
  //    auth) loads the test page with the channel id and uses the widget.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(`/widget-test.html?channelId=${channelId}`);
  await expect(visitor.getByTestId('widget-test-page')).toBeVisible();

  await expect(visitor.getByTestId('nexus-widget')).toBeVisible();
  await visitor.getByTestId('nexus-widget-input').fill('hello');
  await visitor.getByTestId('nexus-widget-send').click();

  // Visitor sees their own message and the agent's reply.
  await expect(visitor.getByTestId('nexus-widget-message-user')).toHaveText('hello');
  await expect(visitor.getByTestId('nexus-widget-message-assistant')).toHaveText(/Echo: hello/);

  // 3. Operator switches to Conversations and sees the same conversation.
  await operator.getByRole('link', { name: 'Conversations' }).click();
  await expect(operator.getByTestId('conversations-page')).toBeVisible();

  const row = operator.getByTestId(/^conversation-row-/);
  await expect(row.first()).toBeVisible();
  await row.first().click();

  await expect(operator.getByTestId('conversation-message-user')).toContainText('hello');
  await expect(operator.getByTestId('conversation-message-assistant')).toContainText('Echo: hello');

  await operatorContext.close();
  await visitorContext.close();
});
