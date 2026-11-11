import * as Sentry from "@sentry/nextjs";

// Server-side logger for the web app's route handlers and middleware — same
// shape as the API's (apps/api/src/lib/logger.ts) so both services read alike
// in Railway: one JSON object per line in production with level, message,
// event, service, version and the request id; readable lines in dev.
// error-level lines are also reported to Sentry.
//
// Deliberately small: the web app only logs a handful of failure paths.

type Fields = Record<string, unknown>;

const version = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
const env = process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "development";

const SECRET_KEY = /(token|secret|password|authorization|cookie|api[-_]?key|code|state)/i;

function serialise(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause !== undefined ? { cause: serialise(value.cause) } : {}),
    };
  }
  return value;
}

function clean(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SECRET_KEY.test(k) && typeof v === "string" ? "[redacted]" : serialise(v);
  }
  return out;
}

function write(level: "info" | "warn" | "error", message: string, fields: Fields) {
  const err = Object.values(fields).find((v): v is Error => v instanceof Error);
  if (level === "error") {
    Sentry.withScope((scope) => {
      if (typeof fields.requestId === "string") scope.setTag("requestId", fields.requestId);
      if (typeof fields.event === "string") scope.setTag("event", fields.event);
      scope.setContext("log", clean({ message, ...fields }));
      if (err) Sentry.captureException(err);
      else Sentry.captureMessage(message, "error");
    });
  }
  if (process.env.NODE_ENV === "test") return;

  const all = clean(fields);
  if (process.env.NODE_ENV === "production") {
    const line = JSON.stringify({ level, message, time: new Date().toISOString(), service: "web", env, version, ...all });
    (level === "info" ? console.log : console.error)(line);
    return;
  }
  const pairs = Object.entries(all)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  (level === "info" ? console.log : console.error)(`${level.toUpperCase()} ${message} ${pairs}`);
}

export const log = {
  info: (message: string, fields: Fields = {}) => write("info", message, fields),
  warn: (message: string, fields: Fields = {}) => write("warn", message, fields),
  error: (message: string, fields: Fields = {}) => write("error", message, fields),
};

export const webVersion = version;
