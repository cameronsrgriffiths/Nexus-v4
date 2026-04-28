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
