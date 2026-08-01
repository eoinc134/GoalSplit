import { NutritionClient } from "@/components/nutrition-client";
import { API_URL } from "@/lib/api";
import type { DailyNutritionTotals, NutritionTargets } from "@goalsplit/types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchDay(date: string): Promise<DailyNutritionTotals> {
  try {
    const res = await fetch(`${API_URL}/nutrition/meals?date=${date}`, { next: { revalidate: 0 } });
    const json = await res.json();
    return json.data;
  } catch {
    return { date, calories: 0, proteinG: 0, carbsG: 0, fatG: 0, meals: [] };
  }
}

async function fetchTargets(): Promise<NutritionTargets> {
  try {
    const res = await fetch(`${API_URL}/nutrition/targets`, { next: { revalidate: 0 } });
    const json = await res.json();
    return json.data;
  } catch {
    return { calculable: false, reason: "Couldn't reach the API" };
  }
}

interface NutritionPageProps {
  searchParams: Promise<{ date?: string }>;
}

export default async function NutritionPage({ searchParams }: NutritionPageProps) {
  const { date = todayIso() } = await searchParams;
  const [day, targets] = await Promise.all([fetchDay(date), fetchTargets()]);
  // key={date} forces a remount on date navigation so internal state
  // (day/targets) resets from the freshly-fetched props instead of going stale.
  return <NutritionClient key={date} initialDay={day} initialTargets={targets} />;
}
