// What's running, where — stamped on every log line, error report and health
// response, so anything can be traced to the deploy that produced it.
// Railway sets these variables on every deployment; locally they fall back
// to "dev".

const startedAt = Date.now();

export const runtime = {
  service: "api",
  env: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "development",
  // Only set for deploys triggered from GitHub; `railway up` deploys have none.
  version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
  commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
  deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
  replicaId: process.env.RAILWAY_REPLICA_ID ?? null,
};

export function uptimeSeconds(): number {
  return Math.round((Date.now() - startedAt) / 1000);
}
