import { GoalsClient } from "@/components/goals-client";
import type { Goal, ApiResponse } from "@goalsplit/types";

async function fetchGoals(): Promise<Goal[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
  try {
    const res = await fetch(`${apiUrl}/goals`, { next: { revalidate: 0 } });
    const json: ApiResponse<Goal[]> = await res.json();
    return json.data;
  } catch {
    return [];
  }
}

export default async function GoalsPage() {
  const goals = await fetchGoals();
  return <GoalsClient initialGoals={goals} />;
}
