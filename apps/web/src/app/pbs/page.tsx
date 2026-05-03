import { PbsClient } from "@/components/pbs-client";
import type { PersonalBest, ApiResponse } from "@goalsplit/types";

async function fetchPBs(): Promise<PersonalBest[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";
  try {
    const res = await fetch(`${apiUrl}/pbs`, { next: { revalidate: 0 } });
    const json: ApiResponse<PersonalBest[]> = await res.json();
    return json.data;
  } catch {
    return [];
  }
}

export default async function PbsPage() {
  const pbs = await fetchPBs();
  return <PbsClient initialPbs={pbs} />;
}
