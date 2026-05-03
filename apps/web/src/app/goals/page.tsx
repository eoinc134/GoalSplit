import { GoalsClient } from "@/components/goals-client";
import { serverFetch } from "@/lib/api";
import type { Goal } from "@goalsplit/types";

export default async function GoalsPage() {
  const goals = await serverFetch<Goal[]>("/goals", []);
  return <GoalsClient initialGoals={goals} />;
}
