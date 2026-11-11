import type { ApiErrorBody, ApiList } from "@goalsplit/types";
import { unstable_rethrow } from "next/navigation";
import { log } from "@/lib/log";

// Server-side access to the GoalSplit API. Only ever imported by server
// components and route handlers: API_KEY is not a NEXT_PUBLIC_ variable, so
// it is never bundled into browser code — browsers reach the API through the
// session-checked proxy at app/api/[...path]/route.ts instead.
//
// API_URL can point at Railway's private network (http://<api>.railway.internal:<port>/api)
// so the API needn't be publicly reachable at all.

export const API_URL = process.env.API_URL ?? "http://localhost:3001/api";

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const key = process.env.API_KEY;
  if (key) headers.set("x-api-key", key);
  return fetch(`${API_URL}${path}`, { cache: "no-store", ...init, headers });
}

// Why a section couldn't load — shown to the user (message) and logged.
export interface LoadError {
  path: string;
  status: number; // 0 when the API couldn't be reached at all
  message: string;
}

// What a page gets for each API read: always data to render (the fallback
// when the call failed — so empty states render instead of crashes), plus
// the error when there was one, so the page can say so instead of passing
// a failed load off as "no data yet".
export interface Loaded<T> {
  data: T;
  error: LoadError | null;
}

export async function load<T>(path: string, fallback: T): Promise<Loaded<T>> {
  let error: LoadError;
  try {
    const res = await apiFetch(path);
    const body: unknown = await res.json().catch(() => null);
    if (res.ok && typeof body === "object" && body !== null && "data" in body) {
      return { data: body.data as T, error: null };
    }
    const apiError = body as Partial<ApiErrorBody> | null;
    error = { path, status: res.status, message: apiError?.error ?? `The API answered HTTP ${res.status}` };
  } catch (err) {
    unstable_rethrow(err); // Next.js control flow (dynamic rendering, redirects) isn't an API failure
    error = { path, status: 0, message: "The GoalSplit API is unreachable" };
    log.warn("api read failed", { event: "web.load_failed", path, err });
    return { data: fallback, error };
  }
  log.warn("api read failed", { event: "web.load_failed", path, status: error.status });
  return { data: fallback, error };
}

// List endpoints answer { data, total } (ApiList in @goalsplit/types).
export async function loadList<T>(path: string): Promise<Loaded<{ rows: T[]; total: number }>> {
  const empty = { rows: [] as T[], total: 0 };
  try {
    const res = await apiFetch(path);
    const body = (await res.json().catch(() => null)) as Partial<ApiList<T> & ApiErrorBody> | null;
    if (res.ok && Array.isArray(body?.data)) return { data: { rows: body.data, total: body.total ?? body.data.length }, error: null };
    log.warn("api read failed", { event: "web.load_failed", path, status: res.status });
    return { data: empty, error: { path, status: res.status, message: body?.error ?? `The API answered HTTP ${res.status}` } };
  } catch (err) {
    unstable_rethrow(err); // Next.js control flow (dynamic rendering, redirects) isn't an API failure
    log.warn("api read failed", { event: "web.load_failed", path, err });
    return { data: empty, error: { path, status: 0, message: "The GoalSplit API is unreachable" } };
  }
}

// The failed loads among several, for a page-level notice.
export function failures(...results: Loaded<unknown>[]): LoadError[] {
  return results.flatMap((r) => (r.error ? [r.error] : []));
}
