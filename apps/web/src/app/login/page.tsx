const ERRORS: Record<string, string> = {
  denied: "Strava sign-in was cancelled.",
  state: "That sign-in link expired or didn't start here. Try again.",
  no_code: "Strava didn't return an authorisation code. Try again.",
  not_allowed: "This GoalSplit instance belongs to a different Strava athlete.",
  exchange: "Strava rejected the sign-in. Try again.",
  rate_limited: "Too many sign-in attempts. Wait a few minutes and try again.",
  unavailable: "The GoalSplit API is unreachable right now.",
};

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function LoginPage({ searchParams }: Readonly<LoginPageProps>) {
  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? "Sign-in failed. Try again.") : null;

  return (
    <div className="mx-auto mt-24 max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
      <h1 className="text-xl font-semibold">Sign in to GoalSplit</h1>
      <p className="mt-2 text-sm text-neutral-400">
        GoalSplit is a single-athlete app. Sign in with the Strava account it belongs to.
      </p>
      {message && <p className="mt-4 rounded-lg bg-red-950/50 px-3 py-2 text-sm text-red-300">{message}</p>}
      {/* A plain link, not next/link: it's a route handler that redirects out to
          Strava, and Link's prefetch would start a sign-in in the background. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/api/auth/strava"
        className="mt-6 inline-block rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-400"
      >
        Sign in with Strava
      </a>
    </div>
  );
}
