export async function checkEmbedding(baseUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(new URL('/health', baseUrl), {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      return { ok: false, error: `status ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Embedder is the dependency knowledge writes use to produce vectors.
// The local embedding service (infinity) speaks the OpenAI-compatible
// /embeddings shape. We keep this as a small interface so tests can swap in
// a real HTTP embedder backed by a fake server without mocking the call site.
export type Embedder = {
  embed(text: string): Promise<number[]>;
};

type CreateEmbedderOptions = {
  baseUrl: string;
  model?: string;
  // nomic-embed-text-v1.5 produces 768-dim vectors. The schema uses vector(768);
  // any embedder substituted here must match that dimension.
  expectedDimension?: number;
};

export function createHttpEmbedder({
  baseUrl,
  model = 'nomic-ai/nomic-embed-text-v1.5',
  expectedDimension = 768,
}: CreateEmbedderOptions): Embedder {
  return {
    async embed(text) {
      const res = await fetch(new URL('/embeddings', baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: text }),
      });
      if (!res.ok) {
        throw new Error(`embedding request failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
      const embedding = body.data?.[0]?.embedding;
      if (!Array.isArray(embedding)) {
        throw new Error('embedding response missing data[0].embedding');
      }
      if (embedding.length !== expectedDimension) {
        throw new Error(
          `embedding dimension mismatch: expected ${expectedDimension}, got ${embedding.length}`,
        );
      }
      return embedding;
    },
  };
}
