"use client";

const TOKEN_KEY = "bipolar.token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

export interface ApiOptions extends RequestInit {
  json?: unknown;
  formData?: FormData;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: HeadersInit = {
    Accept: "application/json",
    ...(opts.headers || {}),
  };
  const token = getToken();
  if (token) (headers as Record<string, string>).Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    (headers as Record<string, string>)["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.formData) {
    body = opts.formData;
  } else {
    body = opts.body as BodyInit | undefined;
  }

  const res = await fetch(path, { ...opts, headers, body });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const obj = data as { error?: string; code?: string } | null;
    const err: Error & { code?: string; status?: number } = new Error(obj?.error || `HTTP ${res.status}`);
    err.code = obj?.code;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export interface MeUser {
  id: string;
  username: string;
  fullName: string;
  role: "admin" | "user";
  medicationTime: string | null;
  patientEmail: string | null;
  patientPhone: string | null;
  emergencyContactEmail: string | null;
  emergencyContactPhone: string | null;
}
