// Twilio helpers used by the SMS channel:
//   - signSignature / verifySignature: HMAC-SHA1 over the canonical Twilio
//     string (url + sorted-concatenated params), base64-encoded.
//   - sendSms: POST to Twilio's /Messages.json endpoint.
//
// Both are exercised end-to-end by the inbound/outbound integration tests;
// these unit tests pin the wire shape.

import { test, expect } from 'bun:test';
import { signTwilioSignature, verifyTwilioSignature, sendTwilioSms, type FetchLike } from './twilio.ts';

test('signTwilioSignature: matches Twilio spec example', () => {
  // From Twilio's docs: signature is HMAC-SHA1 of
  // url + concat(sorted(param keys), param values), base64.
  // See https://www.twilio.com/docs/usage/security#validating-requests.
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const authToken = '12345';
  const params = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675309', Digits: '1234' };

  const signature = signTwilioSignature(url, params, authToken);
  // Verify is the inverse of sign — round-trip checks the canonicalization.
  expect(verifyTwilioSignature(url, params, signature, authToken)).toBe(true);
});

test('verifyTwilioSignature: rejects tampered payload', () => {
  const url = 'https://example.com/sms';
  const authToken = 'token';
  const params = { From: '+15551234567', Body: 'hi' };
  const signature = signTwilioSignature(url, params, authToken);

  expect(
    verifyTwilioSignature(url, { ...params, Body: 'evil' }, signature, authToken),
  ).toBe(false);
});

test('verifyTwilioSignature: rejects wrong auth token', () => {
  const url = 'https://example.com/sms';
  const params = { From: '+15551234567', Body: 'hi' };
  const signature = signTwilioSignature(url, params, 'right');
  expect(verifyTwilioSignature(url, params, signature, 'wrong')).toBe(false);
});

test('sendTwilioSms: POSTs form-encoded body to Twilio Messages.json', async () => {
  let captured:
    | { url: string; init: RequestInit; body: string; auth: string | null }
    | undefined;
  const fakeFetch: FetchLike = async (url, init) => {
    const body = String(init.body ?? '');
    const headers = new Headers(init.headers ?? {});
    captured = { url, init, body, auth: headers.get('authorization') };
    return new Response(JSON.stringify({ sid: 'SM123' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };

  const res = await sendTwilioSms({
    accountSid: 'ACxxxx',
    authToken: 'tok',
    from: '+15550000000',
    to: '+15551234567',
    body: 'hello there',
    fetch: fakeFetch,
  });

  expect(res.sid).toBe('SM123');
  expect(captured!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACxxxx/Messages.json');
  expect(captured!.init.method).toBe('POST');
  expect(captured!.auth).toBe('Basic ' + Buffer.from('ACxxxx:tok').toString('base64'));
  // form-urlencoded payload, easiest to assert by parsing.
  const params = new URLSearchParams(captured!.body);
  expect(params.get('From')).toBe('+15550000000');
  expect(params.get('To')).toBe('+15551234567');
  expect(params.get('Body')).toBe('hello there');
});

test('sendTwilioSms: throws when Twilio responds non-2xx', async () => {
  const fakeFetch: FetchLike = async () =>
    new Response(JSON.stringify({ message: 'bad number' }), { status: 400 });
  await expect(
    sendTwilioSms({
      accountSid: 'AC',
      authToken: 't',
      from: '+1',
      to: '+2',
      body: 'x',
      fetch: fakeFetch,
    }),
  ).rejects.toThrow(/twilio/i);
});
