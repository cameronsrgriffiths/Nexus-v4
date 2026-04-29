// Test-only helpers shared across knowledge integration tests.
//
// fakeEmbedder is a real implementation of the Embedder interface — not a mock
// in the test-double sense. It produces deterministic 768-dim vectors based on
// token frequency (a tiny term-frequency hash projection). Synonyms or
// paraphrases that share keywords land near each other in cosine space, which
// is enough to exercise the FTS+vector recall path without booting the real
// embedding model.

import type { Embedder } from '../embedding/client.ts';

const DIM = 768;

export function fakeEmbedder(): Embedder {
  return {
    async embed(text) {
      return embedTextToVector(text);
    },
  };
}

// Run an in-process HTTP server that speaks the OpenAI-compatible /embeddings
// shape. Lets us point the production HttpEmbedder at it via fetch — no mocks.
export function startFakeEmbeddingServer(): { url: string; stop: () => Promise<void> } {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/embeddings' && req.method === 'POST') {
        return req.json().then((body: any) => {
          const input: string = body.input;
          const embedding = embedTextToVector(input);
          return new Response(
            JSON.stringify({ data: [{ embedding }] }),
            { headers: { 'content-type': 'application/json' } },
          );
        });
      }
      if (url.pathname === '/health') {
        return new Response('ok');
      }
      return new Response('not found', { status: 404 });
    },
  });
  return {
    url: `http://localhost:${server.port}`,
    stop: async () => {
      server.stop(true);
    },
  };
}

function embedTextToVector(text: string): number[] {
  const tokens = tokenize(text);
  const vec = new Array<number>(DIM).fill(0);
  for (const token of tokens) {
    const stem = simpleStem(token);
    const idx = hash(stem) % DIM;
    vec[idx] += 1;
  }
  return l2normalize(vec);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

// Crude stemmer so paraphrases that share roots ("cat" / "cats", "allergic" /
// "allergy") land in the same bucket. Plenty for the integration test.
function simpleStem(t: string): string {
  if (t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.endsWith('s') && t.length > 3) return t.slice(0, -1);
  if (t.endsWith('ing') && t.length > 5) return t.slice(0, -3);
  if (t.endsWith('ed') && t.length > 4) return t.slice(0, -2);
  return t;
}

function hash(s: string): number {
  // FNV-1a 32-bit, masked to non-negative.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function l2normalize(vec: number[]): number[] {
  let sum = 0;
  for (const x of vec) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec;
  return vec.map((x) => x / norm);
}
