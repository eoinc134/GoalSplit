import { PbsClient } from "@/components/pbs-client";
import { serverFetch } from "@/lib/api";
import type { PersonalBest } from "@goalsplit/types";

export default async function PbsPage() {
  const pbs = await serverFetch<PersonalBest[]>("/pbs", []);
  return <PbsClient initialPbs={pbs} />;
}
