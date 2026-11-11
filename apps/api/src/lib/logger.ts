import { AsyncLocalStorage } from "node:async_hooks";

// Minimal structured logger. Production writes one JSON object per line —
// Railway parses `level` and `message` and makes every other field
// filterable. Development writes readable `HH:MM:SS LEVEL message key=value`
// lines. Tests are silent unless LOG_LEVEL is set.
//
// Fields from the current request context (the request id, set by the
// request-log middleware) are attached to every line automatically, so a
// sync's log lines can be traced back to the click that started it.

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const LEVELS: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const context = new AsyncLocalStorage<Fields>();

export function withLogContext<T>(fields: Fields, fn: () => T): T {
  return context.run({ ...context.getStore(), ...fields }, fn);
}

function threshold(): number {
  const configured = process.env.LOG_LEVEL as keyof typeof LEVELS | undefined;
  if (configured && configured in LEVELS) return LEVELS[configured];
  return process.env.NODE_ENV === "test" ? LEVELS.silent : LEVELS.info;
}

// Errors don't JSON.stringify (their fields aren't enumerable).
function serialise(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function format(value: unknown): string {
  if (value instanceof Error) return JSON.stringify(value.message);
  if (typeof value === "string") return /\s/.test(value) ? JSON.stringify(value) : value;
  return JSON.stringify(value);
}

function write(level: Level, message: string, fields: Fields) {
  if (LEVELS[level] < threshold()) return;
  const all: Fields = { ...context.getStore(), ...fields };
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;

  if (process.env.NODE_ENV === "production") {
    const entry: Fields = { level, message, time: new Date().toISOString() };
    for (const [k, v] of Object.entries(all)) entry[k] = serialise(v);
    stream.write(`${JSON.stringify(entry)}\n`);
    return;
  }

  const time = new Date().toISOString().slice(11, 19);
  const pairs = Object.entries(all)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${format(v)}`)
    .join(" ");
  stream.write(`${time} ${level.toUpperCase().padEnd(5)} ${message}${pairs ? ` ${pairs}` : ""}\n`);
  if (level === "error") {
    const err = Object.values(all).find((v): v is Error => v instanceof Error);
    if (err?.stack) stream.write(`${err.stack}\n`);
  }
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
