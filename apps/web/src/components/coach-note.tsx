import Markdown, { type Components } from "react-markdown";
import type { WeeklyNote } from "@goalsplit/types";
import { EmptyState } from "./states";
import { formatDate } from "@/lib/format";

// The latest weekly note Claude saved through the MCP `save_weekly_note` tool.
// react-markdown doesn't render raw HTML, so a note can only produce the
// elements mapped below.

const COMPONENTS: Components = {
  h1: ({ children }) => <h3 className="mt-4 text-sm font-semibold text-neutral-100 first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 text-sm font-semibold text-neutral-100 first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 text-sm font-semibold text-neutral-200 first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="mt-2 first:mt-0">{children}</p>,
  ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold text-neutral-100">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} className="text-brand-400 hover:text-brand-300" rel="noreferrer">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded bg-neutral-800 px-1 py-0.5 text-xs">{children}</code>,
  table: ({ children }) => (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-neutral-800 py-1 pr-3 font-medium text-neutral-400">{children}</th>,
  td: ({ children }) => <td className="border-b border-neutral-800/60 py-1 pr-3">{children}</td>,
};

export function CoachNote({ note }: Readonly<{ note: WeeklyNote | null }>) {
  if (!note) {
    return (
      <EmptyState
        size="sm"
        message="No review saved yet."
        hint="Run the weekly_review prompt in Claude Desktop; it saves its review here."
      />
    );
  }
  return (
    <div>
      <p className="text-xs text-neutral-500">
        Week of {formatDate(note.weekStart)} · saved {formatDate(note.updatedAt)}
      </p>
      <div className="mt-3 text-sm leading-relaxed text-neutral-300">
        <Markdown components={COMPONENTS}>{note.body}</Markdown>
      </div>
    </div>
  );
}
