const PB_DISTANCES = [
  { label: "1K", km: 1 },
  { label: "5K", km: 5 },
  { label: "10K", km: 10 },
  { label: "Half Marathon", km: 21.0975 },
  { label: "Marathon", km: 42.195 },
];

export function PbsTable() {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Personal Bests</h2>
        <a
          href="/pbs"
          className="text-xs text-brand-500 hover:text-brand-400 transition-colors"
        >
          Edit
        </a>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-xs text-neutral-500">
            <th className="pb-2 font-medium">Distance</th>
            <th className="pb-2 font-medium">Time</th>
            <th className="pb-2 font-medium">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/50">
          {PB_DISTANCES.map((d) => (
            <tr key={d.label}>
              <td className="py-2 font-medium">{d.label}</td>
              <td className="py-2 text-neutral-500">—</td>
              <td className="py-2 text-neutral-500">—</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
