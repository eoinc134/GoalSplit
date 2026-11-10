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

export async function serverFetch<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await apiFetch(path);
    if (!res.ok) return fallback;
    const json = await res.json();
    return json.data as T;
  } catch {
    return fallback;
  }
}
