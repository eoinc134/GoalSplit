export function GoalsList() {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Active Goals</h2>
        <a
          href="/goals"
          className="text-xs text-brand-500 hover:text-brand-400 transition-colors"
        >
          View all
        </a>
      </div>
      <p className="text-sm text-neutral-500">No goals yet. Add your first goal to get started.</p>
    </div>
  );
}
