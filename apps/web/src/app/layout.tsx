import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GoalSplit — Running Dashboard",
  description: "Track your running goals, PBs, and training data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-50 antialiased">
        <nav className="border-b border-neutral-800 px-6 py-4">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <span className="text-lg font-bold tracking-tight text-brand-500">
              GoalSplit
            </span>
            <div className="flex gap-6 text-sm text-neutral-400">
              <a href="/" className="hover:text-neutral-50 transition-colors">Dashboard</a>
              <a href="/goals" className="hover:text-neutral-50 transition-colors">Goals</a>
              <a href="/runs" className="hover:text-neutral-50 transition-colors">Activities</a>
              <a href="/pbs" className="hover:text-neutral-50 transition-colors">PBs</a>
            </div>
          </div>
        </nav>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
