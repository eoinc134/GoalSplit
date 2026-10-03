import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "GoalSplit — Training Analytics",
  description: "Strava-backed training data and performance analytics.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-50 antialiased">
        <nav className="border-b border-neutral-800 px-6 py-4">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <span className="text-lg font-bold tracking-tight text-brand-500">
              GoalSplit
            </span>
            <div className="flex gap-6 text-sm text-neutral-400">
              <Link href="/" className="hover:text-neutral-50 transition-colors">Dashboard</Link>
              <Link href="/runs" className="hover:text-neutral-50 transition-colors">Activities</Link>
              <Link href="/training" className="hover:text-neutral-50 transition-colors">Training</Link>
              <Link href="/prs" className="hover:text-neutral-50 transition-colors">Records</Link>
            </div>
          </div>
        </nav>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
