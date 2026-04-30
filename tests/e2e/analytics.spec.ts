import { test, expect } from '@playwright/test';

// Operator analytics view: traffic across two agents on widget channels →
// the analytics page renders counts that reflect the messages sent.

test('analytics: send a few messages across agents → page reflects counts', async ({
  browser,
}) => {
  // 1. Operator registers and creates two agents (each auto-provisions a
  //    widget channel).
  const operatorContext = await browser.newContext();
  const operator = await operatorContext.newPage();
  const email = `op+analytics+${Date.now()}@example.com`;
  const password = 'hunter2hunter2';

  await operator.goto('/register');
  await operator.getByLabel('Email').fill(email);
  await operator.getByLabel('Password (8+ characters)').fill(password);
  await operator.getByRole('button', { name: 'Create account' }).click();
  await expect(operator.getByTestId('dashboard')).toBeVisible();

  await operator.getByRole('link', { name: 'Agents' }).click();

  async function createAgent(name: string): Promise<string> {
    await operator.getByRole('button', { name: 'New agent' }).click();
    await operator.getByLabel('Name').fill(name);
    await operator.getByLabel('Persona').fill(`Persona for ${name}.`);
    await operator.getByLabel('Model').fill('claude-haiku-test');
    await operator.getByRole('button', { name: 'Create agent' }).click();

    // Read the channel id off the row whose row contains the agent's name.
    const row = operator
      .getByTestId(/^agent-row-/)
      .filter({ hasText: name });
    await expect(row).toBeVisible();
    const widgetSlot = row.getByTestId(/^agent-widget-channel-/);
    const text = (await widgetSlot.textContent()) ?? '';
    const channelId = text.replace(/^widget:\s*/, '').trim();
    expect(channelId).toMatch(/^[0-9a-f-]{36}$/);
    return channelId;
  }

  const channelA = await createAgent('Agent Alpha');
  const channelB = await createAgent('Agent Beta');

  // 2. Send messages: 2 to Alpha, 1 to Beta. Each round-trip writes a user
  //    message and an assistant reply, so total counts are 4 and 2.
  async function sendWidgetMessage(channelId: string, content: string, sessionId: string) {
    const res = await operator.request.post('/widget/messages', {
      data: { channelId, widgetSessionId: sessionId, content },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.ok()).toBe(true);
  }

  await sendWidgetMessage(channelA, 'hi alpha 1', 'sa1');
  await sendWidgetMessage(channelA, 'hi alpha 2', 'sa2');
  await sendWidgetMessage(channelB, 'hi beta 1', 'sb1');

  // 3. Visit Analytics. The page should show three charts with counts.
  await operator.getByRole('link', { name: 'Analytics' }).click();
  await expect(operator.getByTestId('analytics-page')).toBeVisible();

  // Per-agent: Alpha leads with 4, Beta with 2.
  await expect(
    operator.getByTestId('analytics-per-agent-row-Agent Alpha-count'),
  ).toHaveText('4');
  await expect(
    operator.getByTestId('analytics-per-agent-row-Agent Beta-count'),
  ).toHaveText('2');

  // Per-channel: 6 widget messages total.
  await expect(
    operator.getByTestId('analytics-per-channel-row-widget-count'),
  ).toHaveText('6');

  // Over-time: today's bucket is 6.
  const overTimeRow = operator.getByTestId(/^analytics-over-time-row-\d{4}-\d{2}-\d{2}$/);
  await expect(overTimeRow).toBeVisible();
  await expect(overTimeRow.getByTestId(/-count$/)).toHaveText('6');

  await operatorContext.close();
});
