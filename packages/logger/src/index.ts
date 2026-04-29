import { AsyncLocalStorage } from 'node:async_hooks';

export type LogContext = {
  request_id?: string;
  session_id?: string;
  tool_call_id?: string;
  [key: string]: unknown;
};

export type LogFields = Record<string, unknown>;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Logger = {
  debug: (msg: string, fields?: LogFields) => void;
  info: (msg: string, fields?: LogFields) => void;
  warn: (msg: string, fields?: LogFields) => void;
  error: (msg: string, fields?: LogFields) => void;
};

export type LoggerOptions = {
  sink?: (line: string) => void;
  now?: () => Date;
};

const storage = new AsyncLocalStorage<LogContext>();

export function getContext(): LogContext {
  return storage.getStore() ?? {};
}

export function withContext<T>(patch: LogContext, fn: () => T): T {
  const merged: LogContext = { ...getContext(), ...patch };
  return storage.run(merged, fn);
}

const defaultSink = (line: string): void => {
  // Bun and Node both expose process.stdout.write.
  process.stdout.write(line + '\n');
};

export function createLogger(opts: LoggerOptions = {}): Logger {
  const sink = opts.sink ?? defaultSink;
  const now = opts.now ?? (() => new Date());

  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    const ctx = getContext();
    const record: Record<string, unknown> = {
      time: now().toISOString(),
      level,
      msg,
      ...ctx,
      ...(fields ? normalizeFields(fields) : {}),
    };
    sink(JSON.stringify(record));
  };

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}

function normalizeFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value instanceof Error ? serializeError(value) : value;
  }
  return out;
}

function serializeError(err: Error): { name: string; message: string; stack?: string } {
  return { name: err.name, message: err.message, stack: err.stack };
}
