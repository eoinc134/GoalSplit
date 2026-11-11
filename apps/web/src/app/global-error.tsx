"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Last-resort boundary for errors that escape every page (including the root
// layout). Reports to Sentry and shows a minimal page — it replaces the root
// layout, so it brings its own <html>/<body>.
export default function GlobalError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-50 antialiased">
        <div className="mx-auto mt-24 max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-neutral-400">The error has been reported.</p>
          {error.digest && <p className="mt-1 font-mono text-xs text-neutral-600">ref {error.digest}</p>}
          <button
            type="button"
            onClick={reset}
            className="mt-6 rounded-lg border border-neutral-700 px-4 py-2 text-sm hover:border-neutral-500"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
