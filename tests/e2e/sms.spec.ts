import { test, expect, request } from '@playwright/test';
import crypto from 'node:crypto';

// End-to-end: operator connects an SMS number via the UI, an inbound Twilio
// webhook (signed with the saved auth token) fires, and the operator sees
// the conversation in the basic conversation view.

function signTwilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string,
): string {
  const canonical =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join('');
  return crypto.createHmac('sha1', authToken).update(canonical).digest('base64');
}

test('SMS: operator connects a number, inbound webhook lands in conversation view', async ({
  page,
  baseURL,
}) => {
  const email = `op+sms+${Date.now()}@example.com`;
  const password = 'hunter2hunter2';
  const phoneNumber = '+15550001' + String(Math.floor(Math.random() * 999)).padStart(3, '0');
  const visitor = '+15558887' + String(Math.floor(Math.random() * 999)).padStart(3, '0');
  const authToken = `e2e-token-${Date.now()}`;

  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password (8+ characters)').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('dashboard')).toBeVisible();

  // Create an agent.
  await page.getByRole('link', { name: 'Agents' }).click();
  await page.getByRole('button', { name: 'New agent' }).click();
  await page.getByLabel('Name').fill('SMS Receptionist');
  await page.getByLabel('Persona').fill('Friendly receptionist.');
  await page.getByLabel('Model').fill('claude-haiku-test');
  await page.getByRole('button', { name: 'Create agent' }).click();
  await expect(page.getByTestId('agents-list')).toBeVisible();

  // Open the SMS connect form. It surfaces the inline explanation the PRD
  // requires for non-obvious flows.
  await page.getByTestId(/^agent-connect-sms-/).click();
  const form = page.getByTestId(/^sms-connect-form-/);
  await expect(form).toBeVisible();
  await expect(form).toContainText(/twilio/i);
  await expect(form).toContainText('/sms/twilio/inbound');

  await form.getByLabel('Twilio Account SID').fill('AC1234567890abcdef');
  await form.getByLabel('Twilio Auth Token').fill(authToken);
  await form
    .getByLabel('Phone number (E.164, e.g. +15551234567)')
    .fill(phoneNumber);
  await form.getByRole('button', { name: 'Save SMS channel' }).click();

  // After save, the row shows the connected number.
  await expect(page.getByTestId(/^agent-sms-channel-/)).toContainText(phoneNumber);

  // Hit the inbound webhook directly with a properly signed payload —
  // simulates Twilio's POST in production. (Twilio test credentials would
  // make a real api.twilio.com call out; here we just prove the wire shape.)
  const webhookUrl = `${baseURL!.replace(/\/$/, '')}/sms/twilio/inbound`;
  const params = {
    AccountSid: 'AC1234567890abcdef',
    From: visitor,
    To: phoneNumber,
    Body: 'I need an appointment',
  };
  const ctx = await request.newContext();
  const res = await ctx.post(webhookUrl, {
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signTwilioSignature(webhookUrl, params, authToken),
    },
    form: params,
  });
  expect(res.status()).toBe(200);
  await ctx.dispose();

  // Operator opens the Conversations page; the SMS conversation lists,
  // its detail shows the user message and the agent's reply.
  await page.getByRole('link', { name: 'Conversations' }).click();
  await expect(page.getByTestId('conversations-page')).toBeVisible();

  const row = page.getByTestId(/^conversation-row-/);
  await expect(row.first()).toBeVisible();
  await row.first().click();

  await expect(page.getByTestId('conversation-message-user')).toContainText(
    'I need an appointment',
  );
  await expect(page.getByTestId('conversation-message-assistant')).toContainText(
    'Echo: I need an appointment',
  );
});
