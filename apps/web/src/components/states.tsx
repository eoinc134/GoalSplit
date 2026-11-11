import type { ReactNode } from "react";
import type { LoadError } from "@/lib/server-api";

// The four states every data view can be in, rendered the same way
// everywhere: loading (Skeleton), empty (EmptyState), failed (ErrorState /
// LoadErrorBanner), and the data itself. Charts and tables use EmptyState
// for "nothing in this window yet" and leave failures to the page, which
// knows whether the data is missing or just didn't load.

export function EmptyState({ message, hint, size = "md" }: Readonly<{ message: ReactNode; hint?: ReactNode; size?: "sm" | "md" }>) {
  return (
    <div className={`${size === "sm" ? "py-8" : "py-16"} text-center`}>
      <p className="text-sm text-neutral-500">{message}</p>
      {hint && <p className="mt-1 text-xs text-neutral-600">{hint}</p>}
    </div>
  );
}

export function ErrorState({ error, size = "md" }: Readonly<{ error: LoadError | string; size?: "sm" | "md" }>) {
  const message = typeof error === "string" ? error : error.message;
  return (
    <div role="alert" className={`${size === "sm" ? "py-8" : "py-16"} text-center`}>
      <p className="text-sm text-red-300">Couldn&rsquo;t load this</p>
      <p className="mt-1 text-xs text-neutral-500">{message}</p>
    </div>
  );
}

// Page-level notice when some sections failed: says what's missing, so a
// failed load is never mistaken for "no data yet".
export function LoadErrorBanner({ errors }: Readonly<{ errors: LoadError[] }>) {
  if (errors.length === 0) return null;
  const unreachable = errors.some((e) => e.status === 0 || e.status >= 500);
  return (
    <div role="alert" className="rounded-lg border border-red-900/70 bg-red-950/30 px-4 py-3 text-sm text-red-200">
      <p className="font-medium">
        {errors.length === 1 ? "One section couldn’t load" : `${errors.length} sections couldn’t load`}
        {unreachable ? " — the API may be down or restarting." : "."}
      </p>
      <p className="mt-1 text-xs text-red-300/80">
        Those sections are marked below; everything else is current. Reload to try again.
      </p>
    </div>
  );
}

// Shown for a section's content: the error if its load failed, else the content.
export function Loadable({ error, children, size }: Readonly<{ error: LoadError | null; children: ReactNode; size?: "sm" | "md" }>) {
  return error ? <ErrorState error={error} size={size} /> : <>{children}</>;
}

export function Skeleton({ className = "" }: Readonly<{ className?: string }>) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-neutral-800/70 ${className}`} />;
}
