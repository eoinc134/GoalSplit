"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  DailyNutritionTotals,
  FoodSearchResult,
  Meal,
  MealType,
  NutritionProfile,
  NutritionTargets,
  WeightLog,
} from "@goalsplit/types";
import { StatCard } from "@/components/stat-card";
import { API_URL as API } from "@/lib/api";
import { ACTIVITY_LEVEL_LABELS, MEAL_TYPE_LABELS, NUTRITION_GOAL_LABELS } from "@/lib/constants";

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack", "other"];

function round(n: number): number {
  return Math.round(n);
}

// ── Stat row ──────────────────────────────────────────────────────────────────

function MacroStat({
  label,
  consumed,
  target,
  unit,
}: Readonly<{
  label: string;
  consumed: number;
  target?: number;
  unit: string;
}>) {
  const pct = target ? Math.round((consumed / target) * 100) : null;
  return (
    <StatCard
      label={label}
      value={`${round(consumed)}${unit}`}
      subtext={target !== undefined ? `of ${round(target)}${unit} target (${pct}%)` : "No target set"}
    />
  );
}

// ── Add meal modal ────────────────────────────────────────────────────────────

function AddMealModal({
  date,
  onClose,
  onAdd,
}: Readonly<{
  date: string;
  onClose: () => void;
  onAdd: (meal: Meal) => void;
}>) {
  const [tab, setTab] = useState<"search" | "manual">("search");
  const [mealType, setMealType] = useState<MealType>("other");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search tab state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [recent, setRecent] = useState<FoodSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<FoodSearchResult | null>(null);
  const [quantityG, setQuantityG] = useState("100");

  // Manual tab state
  const [name, setName] = useState("");
  const [calories, setCalories] = useState("");
  const [proteinG, setProteinG] = useState("");
  const [carbsG, setCarbsG] = useState("");
  const [fatG, setFatG] = useState("");

  // Load recent foods once for the quick-add list.
  useEffect(() => {
    fetch(`${API}/nutrition/foods/recent`)
      .then((r) => r.json())
      .then((json) => setRecent(json.data ?? []))
      .catch(() => setRecent([]));
  }, []);

  // Debounced search.
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      fetch(`${API}/nutrition/foods/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((json) => setResults(json.data ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  const qty = Number.parseFloat(quantityG) || 0;
  const preview = selected
    ? {
        calories: (selected.caloriesPer100g * qty) / 100,
        proteinG: (selected.proteinGPer100g * qty) / 100,
        carbsG: (selected.carbsGPer100g * qty) / 100,
        fatG: (selected.fatGPer100g * qty) / 100,
      }
    : null;

  async function submitFromFood() {
    if (!selected || qty <= 0) {
      setError("Pick a food and enter a quantity in grams");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/nutrition/meals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          mealType,
          name: selected.description,
          fdcId: selected.fdcId,
          quantityG: qty,
          caloriesPer100g: selected.caloriesPer100g,
          proteinGPer100g: selected.proteinGPer100g,
          carbsGPer100g: selected.carbsGPer100g,
          fatGPer100g: selected.fatGPer100g,
          brandOwner: selected.brandOwner,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to log meal");
      onAdd(json.data as Meal);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to log meal");
    } finally {
      setSaving(false);
    }
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/nutrition/meals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          mealType,
          name,
          calories: Number.parseFloat(calories) || 0,
          proteinG: Number.parseFloat(proteinG) || 0,
          carbsG: Number.parseFloat(carbsG) || 0,
          fatG: Number.parseFloat(fatG) || 0,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to log meal");
      onAdd(json.data as Meal);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to log meal");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none";

  const foodList = query.trim() ? results : recent;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-950 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add Meal</h2>
          <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-200 transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Meal type */}
        <div className="mb-4">
          <label htmlFor="meal-type" className="mb-1.5 block text-xs text-neutral-400">Meal</label>
          <select id="meal-type" value={mealType} onChange={(e) => setMealType(e.target.value as MealType)} className={inputCls}>
            {MEAL_TYPES.map((t) => (
              <option key={t} value={t}>{MEAL_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1 w-fit">
          {(["search", "manual"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={[
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t ? "bg-neutral-700 text-neutral-50" : "text-neutral-400 hover:text-neutral-200",
              ].join(" ")}
            >
              {t === "search" ? "Search food" : "Manual entry"}
            </button>
          ))}
        </div>

        {tab === "search" ? (
          <div className="space-y-3">
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
              placeholder="Search USDA foods, e.g. chicken breast"
              className={inputCls}
              autoFocus
            />

            {!selected && (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-neutral-800">
                {searching && <p className="p-3 text-xs text-neutral-500">Searching…</p>}
                {!searching && foodList.length === 0 && (
                  <p className="p-3 text-xs text-neutral-500">
                    {query.trim() ? "No results" : "Recently logged foods will appear here"}
                  </p>
                )}
                <ul className="divide-y divide-neutral-800/50">
                  {foodList.map((food) => (
                    <li key={food.fdcId}>
                      <button
                        type="button"
                        onClick={() => setSelected(food)}
                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-neutral-800/50 transition-colors"
                      >
                        <span className="truncate">{food.description}</span>
                        <span className="text-xs text-neutral-500">
                          {food.brandOwner ? `${food.brandOwner} · ` : ""}
                          {round(food.caloriesPer100g)} kcal / 100g
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selected && preview && (
              <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate">{selected.description}</span>
                  <button type="button" onClick={() => setSelected(null)} className="text-xs text-neutral-500 hover:text-neutral-300">
                    Change
                  </button>
                </div>
                <div>
                  <label htmlFor="meal-quantity" className="mb-1.5 block text-xs text-neutral-400">Quantity (grams)</label>
                  <input
                    id="meal-quantity"
                    type="number"
                    value={quantityG}
                    onChange={(e) => setQuantityG(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <p className="text-xs text-neutral-500 tabular-nums">
                  {round(preview.calories)} kcal · {round(preview.proteinG)}g protein ·{" "}
                  {round(preview.carbsG)}g carbs · {round(preview.fatG)}g fat
                </p>
                {error && <p className="text-xs text-red-400">{error}</p>}
                <div className="flex justify-end gap-3">
                  <button
                    onClick={onClose}
                    type="button"
                    className="rounded-lg border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submitFromFood}
                    disabled={saving}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50 transition-colors"
                  >
                    {saving ? "Saving…" : "Add Meal"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={submitManual} className="space-y-4">
            <div>
              <label htmlFor="meal-name" className="mb-1.5 block text-xs text-neutral-400">Name</label>
              <input id="meal-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Homemade stew" className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="meal-calories" className="mb-1.5 block text-xs text-neutral-400">Calories</label>
                <input id="meal-calories" type="number" value={calories} onChange={(e) => setCalories(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label htmlFor="meal-protein" className="mb-1.5 block text-xs text-neutral-400">Protein (g)</label>
                <input id="meal-protein" type="number" value={proteinG} onChange={(e) => setProteinG(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label htmlFor="meal-carbs" className="mb-1.5 block text-xs text-neutral-400">Carbs (g)</label>
                <input id="meal-carbs" type="number" value={carbsG} onChange={(e) => setCarbsG(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label htmlFor="meal-fat" className="mb-1.5 block text-xs text-neutral-400">Fat (g)</label>
                <input id="meal-fat" type="number" value={fatG} onChange={(e) => setFatG(e.target.value)} className={inputCls} />
              </div>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : "Add Meal"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Profile & targets modal ──────────────────────────────────────────────────

interface ProfileForm {
  heightCm: string;
  sex: "male" | "female";
  birthDate: string;
  activityLevel: NutritionProfile["activityLevel"];
  goal: NutritionProfile["goal"];
  calorieOffset: string;
  maintenanceOverride: string;
  proteinGPerKg: string;
  fatPct: string; // displayed as a whole percentage, e.g. "25"
}

function profileToForm(p: NutritionProfile): ProfileForm {
  return {
    heightCm: p.heightCm ? String(p.heightCm) : "",
    sex: p.sex ?? "male",
    birthDate: p.birthDate ?? "",
    activityLevel: p.activityLevel,
    goal: p.goal,
    calorieOffset: String(p.calorieOffset),
    maintenanceOverride: p.maintenanceOverride ? String(p.maintenanceOverride) : "",
    proteinGPerKg: String(p.proteinGPerKg),
    fatPct: String(Math.round(p.fatPct * 100)),
  };
}

function ProfileModal({
  onClose,
  onChanged,
}: Readonly<{
  onClose: () => void;
  onChanged: () => void;
}>) {
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [weightHistory, setWeightHistory] = useState<WeightLog[]>([]);
  const [weightDate, setWeightDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [weightKg, setWeightKg] = useState("");
  const [loggingWeight, setLoggingWeight] = useState(false);

  useEffect(() => {
    fetch(`${API}/nutrition/profile`)
      .then((r) => r.json())
      .then((json) => setForm(profileToForm(json.data)));
    fetch(`${API}/nutrition/weight?limit=10`)
      .then((r) => r.json())
      .then((json) => setWeightHistory(json.data ?? []));
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/nutrition/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          heightCm: Number.parseFloat(form.heightCm) || undefined,
          sex: form.sex,
          birthDate: form.birthDate || undefined,
          activityLevel: form.activityLevel,
          goal: form.goal,
          calorieOffset: Number.parseInt(form.calorieOffset, 10) || 0,
          maintenanceOverride: form.maintenanceOverride ? Number.parseInt(form.maintenanceOverride, 10) : undefined,
          proteinGPerKg: Number.parseFloat(form.proteinGPerKg) || undefined,
          fatPct: form.fatPct ? Number.parseFloat(form.fatPct) / 100 : undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to save profile");
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  async function logWeight(e: React.FormEvent) {
    e.preventDefault();
    const kg = Number.parseFloat(weightKg);
    if (!kg) return;
    setLoggingWeight(true);
    try {
      const res = await fetch(`${API}/nutrition/weight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: weightDate, weightKg: kg }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error("Failed to log weight");
      setWeightHistory((prev) => [json.data, ...prev.filter((w) => w.date !== json.data.date)].slice(0, 10));
      setWeightKg("");
      onChanged();
    } catch {
      // Non-fatal — weight history list just won't update.
    } finally {
      setLoggingWeight(false);
    }
  }

  async function deleteWeight(id: string) {
    const res = await fetch(`${API}/nutrition/weight/${id}`, { method: "DELETE" });
    if (res.ok) {
      setWeightHistory((prev) => prev.filter((w) => w.id !== id));
      onChanged();
    }
  }

  const inputCls =
    "w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Profile & Targets</h2>
          <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-200 transition-colors text-lg leading-none">✕</button>
        </div>

        {!form ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : (
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="profile-height" className="mb-1.5 block text-xs text-neutral-400">Height (cm)</label>
                <input id="profile-height" type="number" value={form.heightCm} onChange={(e) => setForm({ ...form, heightCm: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label htmlFor="profile-sex" className="mb-1.5 block text-xs text-neutral-400">Sex</label>
                <select id="profile-sex" value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value as "male" | "female" })} className={inputCls}>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="profile-birth-date" className="mb-1.5 block text-xs text-neutral-400">Birth date</label>
              <input id="profile-birth-date" type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} className={inputCls} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="profile-activity-level" className="mb-1.5 block text-xs text-neutral-400">Activity level</label>
                <select id="profile-activity-level" value={form.activityLevel} onChange={(e) => setForm({ ...form, activityLevel: e.target.value as NutritionProfile["activityLevel"] })} className={inputCls}>
                  {Object.entries(ACTIVITY_LEVEL_LABELS).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="profile-goal" className="mb-1.5 block text-xs text-neutral-400">Goal</label>
                <select id="profile-goal" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value as NutritionProfile["goal"] })} className={inputCls}>
                  {Object.entries(NUTRITION_GOAL_LABELS).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="profile-calorie-offset" className="mb-1.5 block text-xs text-neutral-400">Calorie offset (vs. maintenance)</label>
                <input id="profile-calorie-offset" type="number" value={form.calorieOffset} onChange={(e) => setForm({ ...form, calorieOffset: e.target.value })} placeholder="-500" className={inputCls} />
              </div>
              <div>
                <label htmlFor="profile-maintenance-override" className="mb-1.5 block text-xs text-neutral-400">Maintenance override</label>
                <input id="profile-maintenance-override" type="number" value={form.maintenanceOverride} onChange={(e) => setForm({ ...form, maintenanceOverride: e.target.value })} placeholder="auto-calculated" className={inputCls} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="profile-protein-per-kg" className="mb-1.5 block text-xs text-neutral-400">Protein (g/kg bodyweight)</label>
                <input id="profile-protein-per-kg" type="number" step="0.1" value={form.proteinGPerKg} onChange={(e) => setForm({ ...form, proteinGPerKg: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label htmlFor="profile-fat-pct" className="mb-1.5 block text-xs text-neutral-400">Fat (% of calories)</label>
                <input id="profile-fat-pct" type="number" value={form.fatPct} onChange={(e) => setForm({ ...form, fatPct: e.target.value })} className={inputCls} />
              </div>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose} className="rounded-lg border border-neutral-800 px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors">
                Close
              </button>
              <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50 transition-colors">
                {saving ? "Saving…" : "Save Profile"}
              </button>
            </div>
          </form>
        )}

        {/* Weight log */}
        <div className="mt-6 border-t border-neutral-800 pt-5">
          <h3 className="mb-3 text-sm font-semibold">Weight log</h3>
          <form onSubmit={logWeight} className="flex items-end gap-3">
            <div className="flex-1">
              <label htmlFor="weight-date" className="mb-1.5 block text-xs text-neutral-400">Date</label>
              <input id="weight-date" type="date" value={weightDate} onChange={(e) => setWeightDate(e.target.value)} className={inputCls} />
            </div>
            <div className="flex-1">
              <label htmlFor="weight-kg" className="mb-1.5 block text-xs text-neutral-400">Weight (kg)</label>
              <input id="weight-kg" type="number" step="0.1" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="80.0" className={inputCls} />
            </div>
            <button type="submit" disabled={loggingWeight} className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50 transition-colors">
              Log
            </button>
          </form>

          {weightHistory.length > 0 && (
            <ul className="mt-3 divide-y divide-neutral-800/50 text-sm">
              {weightHistory.map((w) => (
                <li key={w.id} className="group flex items-center justify-between py-2">
                  <span className="text-neutral-400">{w.date}</span>
                  <span className="tabular-nums">{w.weightKg} kg</span>
                  <button
                    type="button"
                    onClick={() => deleteWeight(w.id)}
                    className="rounded px-1.5 py-1 text-xs text-neutral-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function NutritionClient({
  initialDay,
  initialTargets,
}: Readonly<{
  initialDay: DailyNutritionTotals;
  initialTargets: NutritionTargets;
}>) {
  const router = useRouter();
  const [day, setDay] = useState(initialDay);
  const [targets, setTargets] = useState(initialTargets);
  const [addMealOpen, setAddMealOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  function addMeal(meal: Meal) {
    setDay((d) => ({
      ...d,
      meals: [...d.meals, meal],
      calories: d.calories + meal.calories,
      proteinG: d.proteinG + meal.proteinG,
      carbsG: d.carbsG + meal.carbsG,
      fatG: d.fatG + meal.fatG,
    }));
  }

  async function deleteMeal(id: string) {
    const meal = day.meals.find((m) => m.id === id);
    if (!meal) return;
    const res = await fetch(`${API}/nutrition/meals/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    setDay((d) => ({
      ...d,
      meals: d.meals.filter((m) => m.id !== id),
      calories: d.calories - meal.calories,
      proteinG: d.proteinG - meal.proteinG,
      carbsG: d.carbsG - meal.carbsG,
      fatG: d.fatG - meal.fatG,
    }));
  }

  async function refreshTargets() {
    try {
      const res = await fetch(`${API}/nutrition/targets`);
      const json = await res.json();
      setTargets(json.data);
    } catch {
      // Leave the existing targets in place if the refresh fails.
    }
  }

  function goToDate(newDate: string) {
    router.push(`/nutrition?date=${newDate}`);
  }

  return (
    <div className="space-y-6">
      {addMealOpen && (
        <AddMealModal date={day.date} onClose={() => setAddMealOpen(false)} onAdd={addMeal} />
      )}
      {profileOpen && (
        <ProfileModal
          onClose={() => { setProfileOpen(false); refreshTargets(); }}
          onChanged={refreshTargets}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nutrition</h1>
          <p className="mt-1 text-neutral-400">
            {targets.calculable ? "Targets calculated from your profile" : targets.reason}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={day.date}
            onChange={(e) => goToDate(e.target.value)}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-300"
          />
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-500 hover:text-neutral-100"
          >
            Profile & Targets
          </button>
          <button
            type="button"
            onClick={() => setAddMealOpen(true)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 transition-colors"
          >
            Add Meal
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MacroStat label="Calories" consumed={day.calories} target={targets.targetCalories} unit=" kcal" />
        <MacroStat label="Protein" consumed={day.proteinG} target={targets.targetProteinG} unit="g" />
        <MacroStat label="Carbs" consumed={day.carbsG} target={targets.targetCarbsG} unit="g" />
        <MacroStat label="Fat" consumed={day.fatG} target={targets.targetFatG} unit="g" />
      </div>

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-3 text-base font-semibold">Meals</h2>
        {day.meals.length === 0 ? (
          <p className="text-sm text-neutral-500">No meals logged for this day yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-800/50">
            {day.meals.map((meal) => (
              <li key={meal.id} className="group flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{meal.name}</p>
                  <p className="text-xs text-neutral-500">
                    {MEAL_TYPE_LABELS[meal.mealType]}
                    {meal.quantityG ? ` · ${meal.quantityG}g` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-right text-xs tabular-nums text-neutral-400">
                  <span>{round(meal.calories)} kcal</span>
                  <span className="hidden sm:inline">{round(meal.proteinG)}p / {round(meal.carbsG)}c / {round(meal.fatG)}f</span>
                  <button
                    type="button"
                    onClick={() => deleteMeal(meal.id)}
                    className="rounded px-1.5 py-1 text-neutral-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
