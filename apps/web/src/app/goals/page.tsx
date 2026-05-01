export default function GoalsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Goals</h1>
          <p className="mt-1 text-neutral-400">Track your running targets</p>
        </div>
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium hover:bg-brand-500 transition-colors">
          Add Goal
        </button>
      </div>
      <p className="text-sm text-neutral-500">No goals yet.</p>
    </div>
  );
}
