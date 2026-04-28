import * as v from 'valibot';

const EnvSchema = v.object({
  PORT: v.pipe(
    v.optional(v.string(), '3000'),
    v.transform((s) => Number.parseInt(s, 10)),
    v.integer(),
    v.minValue(1),
    v.maxValue(65535),
  ),
  DATABASE_URL: v.pipe(v.string(), v.minLength(1)),
  MINIO_ENDPOINT: v.pipe(v.string(), v.minLength(1)),
  MINIO_PORT: v.pipe(
    v.optional(v.string(), '9000'),
    v.transform((s) => Number.parseInt(s, 10)),
    v.integer(),
  ),
  MINIO_USE_SSL: v.pipe(
    v.optional(v.string(), 'false'),
    v.transform((s) => s === 'true'),
  ),
  MINIO_ACCESS_KEY: v.pipe(v.string(), v.minLength(1)),
  MINIO_SECRET_KEY: v.pipe(v.string(), v.minLength(1)),
  MINIO_BUCKET: v.pipe(v.string(), v.minLength(1)),
  EMBEDDING_URL: v.pipe(v.string(), v.url()),
});

export type Env = v.InferOutput<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = Bun.env): Env {
  return v.parse(EnvSchema, source);
}
