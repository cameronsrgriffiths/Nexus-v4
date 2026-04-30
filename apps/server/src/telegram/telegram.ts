// Telegram bot HTTP helpers.
//
// A Telegram bot token has shape `<bot_id>:<auth_string>`, e.g.
// `123456:ABC-DEF1234`. The bot id is unique per bot — we store it in
// `channel.address` so the inbound webhook can resolve the channel without
// trusting a path param alone.
//
// Sending: POST application/json to
//   https://api.telegram.org/bot{token}/sendMessage
// Tests stub the wire via an injected `fetch` so we can assert on the call
// without hitting Telegram.

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type SendMessageArgs = {
  botToken: string;
  chatId: number;
  text: string;
  fetch?: FetchLike;
};

export type SentMessage = { messageId: number };

export async function sendTelegramMessage(args: SendMessageArgs): Promise<SentMessage> {
  const f: FetchLike = args.fetch ?? ((u, i) => fetch(u, i));
  const url = `https://api.telegram.org/bot${args.botToken}/sendMessage`;
  const res = await f(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: args.chatId, text: args.text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`telegram send failed (${res.status}): ${detail}`);
  }
  const json = (await res.json()) as { result?: { message_id?: number } };
  return { messageId: json.result?.message_id ?? 0 };
}

// Telegram bot tokens are `<digits>:<auth-string>`. The integer prefix is the
// bot id; we use it as the channel's stable address so inbound updates can
// resolve the channel without reading the secret token out of the request.
export function botIdFromToken(token: string): string | null {
  const match = /^(\d+):/.exec(token);
  return match ? match[1]! : null;
}
