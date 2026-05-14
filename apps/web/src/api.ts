import type { SessionMetadata, SessionTreeEntry } from "@memoryhold/shared";

export const BACKEND_URL_KEY = "memoryhold.backendUrl";
export const BACKEND_TOKEN_KEY = "memoryhold.backendToken";
export const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
export const ANDROID_EMULATOR_API_BASE_URL = "http://10.0.2.2:8787";

export function isCapacitorRuntime(): boolean {
  return Boolean((window as any).Capacitor?.isNativePlatform?.() || (window as any).Capacitor?.getPlatform?.() === "android");
}

export type HealthResult = { ok: true; url: string; authRequired?: boolean } | { ok: false; url: string; error: string };
export type Provider = { id: string; models: Array<{ id: string; name: string }> };

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

export function validateApiBaseUrl(value: string): string | undefined {
  const normalized = normalizeApiBaseUrl(value);
  if (!normalized) return "Server URL is required";
  try {
    const url = new URL(normalized);
    if (!/^https?:$/.test(url.protocol)) return "Server URL must start with http:// or https://";
    return undefined;
  } catch {
    return "Enter a valid server URL";
  }
}

export function initialBackendUrl(): string {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get("memoryholdApiUrl");
  if (fromQuery) {
    const normalized = normalizeApiBaseUrl(fromQuery);
    localStorage.setItem(BACKEND_URL_KEY, normalized);
    return normalized;
  }
  return normalizeApiBaseUrl(localStorage.getItem(BACKEND_URL_KEY) || (isCapacitorRuntime() ? ANDROID_EMULATOR_API_BASE_URL : DEFAULT_API_BASE_URL));
}

export function initialBackendToken(): string {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get("memoryholdToken");
  if (fromQuery) {
    localStorage.setItem(BACKEND_TOKEN_KEY, fromQuery);
    return fromQuery;
  }
  return localStorage.getItem(BACKEND_TOKEN_KEY) || "";
}

export function saveBackendUrl(url: string) {
  localStorage.setItem(BACKEND_URL_KEY, normalizeApiBaseUrl(url));
}

export function saveBackendToken(token: string) {
  const trimmed = token.trim();
  if (trimmed) localStorage.setItem(BACKEND_TOKEN_KEY, trimmed);
  else localStorage.removeItem(BACKEND_TOKEN_KEY);
}

async function jsonOrTextError(response: Response) {
  if (response.ok) return response;
  const text = await response.text().catch(() => "");
  if (response.status === 401 || response.status === 403) throw new Error(text || "Server rejected this client. Check the server access token in Settings.");
  throw new Error(text || `${response.status} ${response.statusText}`);
}

export class MemoryholdApi {
  readonly baseUrl: string;
  readonly token: string;

  constructor(baseUrl: string, token = "") {
    this.baseUrl = normalizeApiBaseUrl(baseUrl);
    this.token = token.trim();
  }

  url(path: string): string {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  authHeaders(headers: Record<string, string> = {}): Record<string, string> {
    return this.token ? { ...headers, Authorization: `Bearer ${this.token}` } : headers;
  }

  async health(): Promise<HealthResult> {
    try {
      const response = await fetch(this.url("/api/health"));
      if (!response.ok) return { ok: false, url: this.baseUrl, error: `${response.status} ${response.statusText}` };
      const data = await response.json().catch(() => ({}));
      return { ok: true, url: this.baseUrl, authRequired: Boolean(data.authRequired) };
    } catch (error) {
      return { ok: false, url: this.baseUrl, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getJson<T>(path: string): Promise<T> {
    const response = await fetch(this.url(path), { headers: this.authHeaders() });
    await jsonOrTextError(response);
    return response.json() as Promise<T>;
  }

  async sendJson<T>(path: string, method: string, body: unknown): Promise<T> {
    const response = await fetch(this.url(path), { method, headers: this.authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
    await jsonOrTextError(response);
    return response.json() as Promise<T>;
  }

  async deleteJson<T>(path: string): Promise<T> {
    const response = await fetch(this.url(path), { method: "DELETE", headers: this.authHeaders() });
    await jsonOrTextError(response);
    return response.json() as Promise<T>;
  }

  sessions() { return this.getJson<SessionMetadata[]>("/api/sessions"); }
  createSession() { return this.sendJson<SessionMetadata>("/api/sessions", "POST", {}); }
  session(slug: string) { return this.getJson<{ metadata: SessionMetadata; entries: SessionTreeEntry[] }>(`/api/sessions/${encodeURIComponent(slug)}`); }
  renameSession(slug: string, title: string) { return this.sendJson<SessionMetadata>(`/api/sessions/${encodeURIComponent(slug)}`, "PATCH", { title }); }
  deleteSession(slug: string) { return this.deleteJson<{ ok: true }>(`/api/sessions/${encodeURIComponent(slug)}`); }
  providers() { return this.getJson<Provider[]>("/api/providers"); }
  oauthProviders() { return this.getJson<Array<{ id: string; name: string; authenticated: boolean }>>("/api/oauth/providers"); }
  startOAuth(id: string) { return this.sendJson<any>(`/api/oauth/${encodeURIComponent(id)}/start`, "POST", {}); }
  completeOAuth(loginId: string, code: string) { return this.sendJson<any>(`/api/oauth/${encodeURIComponent(loginId)}/complete`, "POST", { code }); }
  oauthStatus(loginId: string) { return this.getJson<any>(`/api/oauth/${encodeURIComponent(loginId)}/status`); }

  async uploadAttachments(slug: string, files: File[]) {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    const response = await fetch(this.url(`/api/sessions/${encodeURIComponent(slug)}/attachments`), { method: "POST", headers: this.authHeaders(), body: form });
    await jsonOrTextError(response);
    return response.json() as Promise<{ attachments: any[] }>;
  }

  async sendMessage(slug: string, body: unknown) { return this.sendJson<any>(`/api/sessions/${encodeURIComponent(slug)}/messages`, "POST", body); }
  async editMessage(slug: string, entryId: string, body: unknown) { return this.sendJson<any>(`/api/sessions/${encodeURIComponent(slug)}/messages/${encodeURIComponent(entryId)}`, "PATCH", body); }
  eventsUrl(slug: string) {
    const url = new URL(this.url(`/api/sessions/${encodeURIComponent(slug)}/events`));
    if (this.token) url.searchParams.set("access_token", this.token);
    return url.toString();
  }
  attachmentUrl(slug: string, relativePath: string) {
    const url = new URL(this.url(`/api/sessions/${encodeURIComponent(slug)}/${relativePath}`));
    if (this.token) url.searchParams.set("access_token", this.token);
    return url.toString();
  }
}
