import { AsyncLocalStorage } from "node:async_hooks";
import { runtime } from "./runtime-info.js";

// Minimal structured logger. Production writes one JSON object per line —
// Railway parses `level` and `message` and makes every other field
// filterable (`@event:sync.finished`, `@requestId:…`, `@status:>=500`).
// Development writes readable `HH:MM:SS LEVEL message key=value` lines.
// Tests are silent unless LOG_LEVEL is set.
//
// Conventions (see docs/OBSERVABILITY.md):
// - `message` is for humans; `event` is a stable dotted name for filtering
//   and alerting (http.request, sync.finished, …) that survives rewording.
// - Every production line carries service/env/version/deploymentId.
// - Fields from the current request context (requestId) are attached
//   automatically, so a sync's lines can be traced to the click that
//   started it.
// - Secret-looking fields and values are redacted before writing.
// - error-level lines are also sent to the error reporter (Sentry) when one
//   is registered — see setErrorReporter / src/instrument.ts.

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const LEVELS: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const context = new AsyncLocalStorage<Fields>();

export function withLogContext<T>(fields: Fields, fn: () => T): T {
  return context.run({ ...context.getStore(), ...fields }, fn);
}

export function currentLogContext(): Fields {
  return context.getStore() ?? {};
}

function threshold(): number {
  const configured = process.env.LOG_LEVEL as keyof typeof LEVELS | undefined;
  if (configured && configured in LEVELS) return LEVELS[configured];
  return process.env.NODE_ENV === "test" ? LEVELS.silent : LEVELS.info;
}

// --- redaction -------------------------------------------------------------

const SECRET_KEY = /(token|secret|password|passwd|authorization|cookie|api[-_]?key|dsn|credential)/i;
const SECRET_VALUE_PATTERNS: [RegExp, string][] = [
  [/(postgres(?:ql)?:\/\/[^:/\s]+:)[^@\s]+@/gi, "$1[redacted]@"], // connection-string passwords
  [/\b(Bearer|ApiKey)\s+[\w.~+/=-]+/g, "$1 [redacted]"],
];

export function redactString(value: string): string {
  return SECRET_VALUE_PATTERNS.reduce((s, [re, sub]) => s.replace(re, sub), value);
}

// Errors don't JSON.stringify (their fields aren't enumerable), and their
// `cause` chain is often where the real reason is (fetch failed → ECONNRESET).
function serialiseError(err: Error, depth = 0): Fields {
  const out: Fields = { name: err.name, message: redactString(err.message) };
  const code = (err as { code?: unknown }).code;
  if (code !== undefined) out.code = code;
  if (err.stack) out.stack = redactString(err.stack);
  if (err.cause !== undefined && depth < 3) {
    out.cause = err.cause instanceof Error ? serialiseError(err.cause, depth + 1) : sanitise(err.cause, depth + 1);
  }
  return out;
}

export function sanitise(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return serialiseError(value);
  if (typeof value === "string") return redactString(value);
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => sanitise(v, depth + 1));
  const out: Fields = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY.test(k) && v !== null && v !== undefined && typeof v !== "boolean" ? "[redacted]" : sanitise(v, depth + 1);
  }
  return out;
}

// --- error reporting hook --------------------------------------------------

export type ErrorReporter = (message: string, fields: Fields, err: Error | undefined) => void;
let reporter: ErrorReporter | null = null;

export function setErrorReporter(fn: ErrorReporter | null): void {
  reporter = fn;
}

// --- output ----------------------------------------------------------------

function format(value: unknown): string {
  if (typeof value === "string") return /\s/.test(value) ? JSON.stringify(value) : value;
  if (value && typeof value === "object" && "message" in value && "name" in value) {
    return JSON.stringify((value as { message: unknown }).message);
  }
  return JSON.stringify(value);
}

function write(level: Level, message: string, fields: Fields) {
  const raw: Fields = { ...context.getStore(), ...fields };
  const err = Object.values(raw).find((v): v is Error => v instanceof Error);

  if (level === "error" && reporter) {
    try {
      reporter(message, sanitise(raw) as Fields, err);
    } catch {
      // Never let error reporting break the code path that's logging.
    }
  }

  if (LEVELS[level] < threshold()) return;
  const all = sanitise(raw) as Fields;
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;

  if (process.env.NODE_ENV === "production") {
    const entry: Fields = {
      level,
      message,
      time: new Date().toISOString(),
      service: runtime.service,
      env: runtime.env,
      version: runtime.version,
      ...(runtime.deploymentId ? { deploymentId: runtime.deploymentId } : {}),
      ...all,
    };
    stream.write(`${JSON.stringify(entry)}\n`);
    return;
  }

  const time = new Date().toISOString().slice(11, 19);
  const pairs = Object.entries(all)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${format(v)}`)
    .join(" ");
  stream.write(`${time} ${level.toUpperCase().padEnd(5)} ${message}${pairs ? ` ${pairs}` : ""}\n`);
  if (level === "error" && err?.stack) stream.write(`${redactString(err.stack)}\n`);
}

export interface Logger {
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
  child(fields: Fields): Logger;
}

function make(base: Fields): Logger {
  return {
    debug: (m, f = {}) => write("debug", m, { ...base, ...f }),
    info: (m, f = {}) => write("info", m, { ...base, ...f }),
    warn: (m, f = {}) => write("warn", m, { ...base, ...f }),
    error: (m, f = {}) => write("error", m, { ...base, ...f }),
    child: (f) => make({ ...base, ...f }),
  };
}

export const log = make({});
