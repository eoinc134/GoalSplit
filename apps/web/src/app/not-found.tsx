import Link from "next/link";

// Unknown URLs, and notFound() from pages (e.g. an activity id that doesn't exist).
export default function NotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-8 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-neutral-400">That page or activity doesn&rsquo;t exist — it may have been deleted on Strava.</p>
      <Link
        href="/runs"
        className="mt-6 inline-block rounded-lg border border-neutral-700 px-4 py-2 text-sm transition-colors hover:border-neutral-500"
      >
        All activities
      </Link>
    </div>
  );
}
