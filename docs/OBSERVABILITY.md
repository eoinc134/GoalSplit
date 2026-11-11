# Observability

How to see what GoalSplit is doing in production, and where to look when something breaks.

| What | Where | Covers |
|---|---|---|
| Logs | Railway → service → **Logs** | Every request, sync, migration, startup and shutdown, as structured JSON |
| Errors | [Sentry](https://eoin-costello.sentry.io) → `goalsplit-api`, `goalsplit-web` | Exceptions and failed syncs, grouped, with stack traces; email on each new issue |
| Health | `GET /health/ready` (API), `GET /api/health` (web), watched by UptimeRobot | Can the app serve requests right now |
| Pipeline state | Dashboard → **Data sync** panel (`GET /api/sync/status`) | Last Strava/Garmin run, status, why it failed |
| Resources | Railway → service → **Metrics** | CPU, memory, network |

## Logs

Both services write **one JSON object per line** in production. Railway parses it:
`level` sets the severity, `message` is the text, and every other field becomes a
filterable attribute ([Railway docs](https://docs.railway.com/reference/logging)).
Retention is 7 days on Hobby and 30 on Pro. In development the same lines are readable
`HH:MM:SS LEVEL message key=value` text.

Every line carries:

| Field | Example | Notes |
|---|---|---|
| `service` | `api` / `web` | |
| `env` | `production` | Railway environment name |
| `version` | `4895c79` | Short git commit of the deploy, or `dev` |
| `deploymentId` | | Railway deployment, so errors can be tied to a deploy |
| `event` | `sync.finished` | Stable name to filter and alert on. Messages may be reworded; events don't change |
| `requestId` | `web-1a2b3c4d-5e6f` | Same id in the web proxy's and the API's lines for one browser action |

Anything that looks like a secret is redacted before it's written: fields named
`*token*`, `*secret*`, `*password*`, `*apiKey*`, `authorization`, `cookie` and so on,
plus connection-string passwords and `Bearer …` values inside strings.

### Events

| Event | Level | When |
|---|---|---|
| `http.request` | info / warn (4xx or slow) / error (5xx) | Every request: `method`, `path`, `route`, `status`, `durationMs`, `slow` |
| `http.unhandled_error` | error | An exception reached Express' error handler |
| `http.outbound_retry` | warn | A Strava/Garmin call failed transiently and is being retried |
| `sync.started` / `sync.finished` / `sync.failed` | info / info-or-warn / error | Each sync: `runId`, `source`, `mode`, `trigger`, counts, `rate`, `durationMs` |
| `sync.interrupted` | warn | Syncs cut off by a shutdown or found orphaned at startup |
| `strava.rate_limited`, `garmin.rate_limited` | warn | Upstream returned 429 |
| `strava.reauth_required` | warn | Strava rejected the stored token. Reconnect needed |
| `strava.connected`, `strava.signin_refused`, `strava.exchange_failed` | info / warn / error | Sign-in flow |
| `scheduler.enabled` / `scheduler.skipped` / `scheduler.crashed` | info / info / error | Automatic sync |
| `db.migrations_applied`, `db.migration_failed` | info / error | Startup migrations |
| `metrics.computed`, `metrics.failed` | info / error | Stream-metric precompute after a sync |
| `app.started`, `app.stopping`, `app.stopped` | info | Lifecycle, with version, deployment and Node version |
| `app.start_failed`, `app.crashed`, `app.unhandled_rejection` | error | The process failed to start, or hit an uncaught error |
| `security.*` | warn | Missing secrets (dev only), foreign user rows, tokens encrypted |
| `proxy.failed`, `auth.start_failed`, `auth.exchange_failed`, `health.api_unreachable` | error / warn | Web app (service `web`) |

### Useful Railway log filters

| Looking for | Filter |
|---|---|
| Everything that went wrong | `@level:error` |
| One browser action, across both services | `@requestId:web-1a2b3c4d-5e6f` (from the `X-Request-Id` response header) |
| Everything one sync did | `@runId:<id>` (shown in Sentry and in `sync_runs`) |
| Failed or partial syncs | `@event:sync.failed` / `@event:sync.finished @status:partial` |
| Slow requests | `@slow:true` |
| Server errors | `@event:http.request @status:>=500` |
| A specific deploy | `@deploymentId:<id>` |
| Upstream trouble | `@event:http.outbound_retry` / `@event:strava.rate_limited` |

`LOG_LEVEL` (`debug`, `info` (default), `warn`, `error`) controls verbosity. Health probes
log at `debug`, so they don't drown everything else. `SLOW_REQUEST_MS` (default 2000) sets
the threshold for slow requests.

## Errors (Sentry)

Projects `goalsplit-api` and `goalsplit-web` in org `eoin-costello`, EU data region.

- **What's reported:** every `error`-level log line except `http.request` (whose cause is
  reported where it happened), anything thrown that nothing caught, browser errors in
  client components, and errors rendering server components. Failed syncs are reported
  too, tagged with `source` and `runId`.
- **Context on each event:** release (git commit), environment, `service`, `requestId`,
  `event`, and the log line's fields (redacted).
- **Privacy:** no request bodies, cookies, query strings or user info. Only the
  `user-agent`, `content-type` and `x-request-id` headers. A `beforeSend` scrub removes
  anything sensitive that slips through. Browser events go through the same-origin
  `/monitoring` tunnel, so ad blockers don't drop them.
- **Stack traces:** the API runs with `--enable-source-maps`, so traces point at
  TypeScript lines. The web build uploads browser source maps when `SENTRY_AUTH_TOKEN` is
  set, then deletes them from the build output.
- **Alerts:** Sentry emails on each new issue by default.
- **Tracing** (performance spans) is off. Set `SENTRY_TRACES_SAMPLE_RATE` (API and web
  server) or `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (browser, at build time), for example
  `0.1`, to turn it on.

| Variable | Service | |
|---|---|---|
| `SENTRY_DSN` | API | `goalsplit-api` DSN. Unset means Sentry is off |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Web | `goalsplit-web` DSN (server and browser). The browser value is baked in at build time |
| `SENTRY_AUTH_TOKEN` | Web, build time | **Secret.** Enables source-map upload |
| `SENTRY_ORG=eoin-costello`, `SENTRY_PROJECT=goalsplit-web` | Web, build time | Where source maps go |

## Health checks

| Endpoint | Checks | 503 when | Use for |
|---|---|---|---|
| API `GET /health/live` (alias `/health`) | Process is up | Never | Liveness |
| API `GET /health/ready` | Postgres answers within 2 s, every migration applied | DB down or slow, migration pending, shutting down | **Railway deploy healthcheck (API)** |
| Web `GET /api/health/live` | Web server is up | Never | **Railway deploy healthcheck (web)** |
| Web `GET /api/health` | Web is up and the API's `/health/ready` passes | API not ready or unreachable | **Uptime monitor** |

All four are public: no API key, no session, and they only report pass or fail per check,
plus version and uptime. `/health/ready` caches its result for 5 s, so frequent probes
can't turn into frequent queries. Strava and Garmin are deliberately not checked, because
their outages don't make GoalSplit unhealthy. They show up in the Data sync panel instead.

### Railway settings

Service → **Settings → Deploy → Healthcheck Path**:

- API: `/health/ready`. A new deploy only takes traffic once it can reach Postgres and its
  migrations have run.
- Web: `/api/health/live`. Kept web-only, so a web deploy doesn't fail just because the
  API is mid-deploy.

Railway only checks these **during a deploy**. Use an uptime monitor for ongoing checks.

### Uptime monitor

[UptimeRobot](https://uptimerobot.com) monitors `https://<web-domain>/api/health` (free plan,
5-minute checks, email alert). That one URL covers both services, and it's public even when
the API is only on Railway's private network.

## Shutdown

On `SIGTERM` (every redeploy and restart) the API:

1. answers 503 on `/health/ready`;
2. stops accepting connections and gives in-flight requests `SHUTDOWN_GRACE_MS` (default
   8000) to finish;
3. marks syncs still running as `interrupted`, with the reason (they resume on the next
   sync);
4. flushes Sentry, closes the database pool, logs `app.stopped` and exits.

Unhandled promise rejections are logged and reported, and the process keeps running.
Uncaught exceptions are logged and reported, then the process exits and Railway restarts it.

## When something breaks

1. **Is it up?** Open `/api/health` on the web domain. `degraded` means the API isn't
   ready. Check the API's Railway logs for `@event:db.migration_failed` or
   `@event:app.start_failed`.
2. **Is there an error?** Sentry → the newest issue. Note its `requestId` / `runId` tags.
3. **What happened around it?** Railway logs → `@requestId:…` or `@runId:…` shows every
   line for that request or sync, across both services.
4. **A sync problem?** The dashboard's Data sync panel shows the last run and its error.
   `sync_runs` holds the full history, including `details.rate` (Strava quota at the time).
5. **Did a deploy cause it?** Compare `version` / `deploymentId` on the first bad line
   with the previous deploy. Sentry marks the release where an issue first appeared.
