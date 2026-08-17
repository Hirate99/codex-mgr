export interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  body: T;
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const r = await fetch(path, init);
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j };
}

export function formatTime(value?: string): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = Date.now() - date.getTime();
  if (diff >= 0 && diff < 60_000) return "Just now";
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff >= 0 && diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleString();
}
