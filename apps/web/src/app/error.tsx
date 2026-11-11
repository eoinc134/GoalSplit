"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

// A page threw while rendering (failed API reads don't throw — they render
// error states). Unlike global-error.tsx this keeps the layout and nav, so
// the rest of the app stays one click away.
export default function PageError({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto mt-16 max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
      <h1 className="text-lg font-semibold">This page hit an error</h1>
      <p className="mt-2 text-sm text-neutral-400">It has been reported. Trying again usually works.</p>
      {error.digest && <p className="mt-1 font-mono text-xs text-neutral-600">ref {error.digest}</p>}
      <div className="mt-6 flex justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm transition-colors hover:border-neutral-500"
        >
          Try again
        </button>
        <Link href="/" className="rounded-lg px-4 py-2 text-sm text-neutral-400 transition-colors hover:text-neutral-100">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
