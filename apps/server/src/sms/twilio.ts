// Twilio HTTP + signature helpers for the SMS channel.
//
// Signature: Twilio signs incoming webhook requests with
//   base64(HMAC-SHA1(authToken, url + concat(sortedParamKeys + paramValues)))
// The header is `X-Twilio-Signature`. We sign + verify in pure code so the
// inbound webhook can authenticate the request without hitting Twilio.
//
// Sending: form-encoded POST to /2010-04-01/Accounts/{Sid}/Messages.json
// with HTTP basic auth (account sid:auth token). We accept an injected
// `fetch` so tests can stub the wire.

import { createHmac } from 'node:crypto';

export type TwilioParams = Record<string, string>;

export function signTwilioSignature(
  url: string,
  params: TwilioParams,
  authToken: string,
): string {
  const canonical = canonicalString(url, params);
  return createHmac('sha1', authToken).update(canonical).digest('base64');
}

export function verifyTwilioSignature(
  url: string,
  params: TwilioParams,
  signature: string,
  authToken: string,
): boolean {
  const expected = signTwilioSignature(url, params, authToken);
  // Constant-time-ish comparison via length + per-byte XOR. Node has
  // timingSafeEqual but it requires equal-length buffers; we guard above.
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

function canonicalString(url: string, params: TwilioParams): string {
  const keys = Object.keys(params).sort();
  let out = url;
  for (const k of keys) out += k + params[k];
  return out;
}

// Narrow signature so tests can stub the wire without satisfying every
// extension Bun adds to the global `fetch` (e.g. `preconnect`).
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type SendSmsArgs = {
  accountSid: string;
  authToken: string;
  from: string;
  to: string;
  body: string;
  fetch?: FetchLike;
};

export type SentSms = { sid: string };

export async function sendTwilioSms(args: SendSmsArgs): Promise<SentSms> {
  const f: FetchLike = args.fetch ?? ((u, i) => fetch(u, i));
  const url = `https://api.twilio.com/2010-04-01/Accounts/${args.accountSid}/Messages.json`;
  const body = new URLSearchParams({ From: args.from, To: args.to, Body: args.body });
  const auth = 'Basic ' + Buffer.from(`${args.accountSid}:${args.authToken}`).toString('base64');
  const res = await f(url, {
    method: 'POST',
    headers: {
      authorization: auth,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`twilio send failed (${res.status}): ${detail}`);
  }
  const json = (await res.json()) as { sid?: string };
  return { sid: json.sid ?? '' };
}
