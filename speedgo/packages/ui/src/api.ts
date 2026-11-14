export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export interface Api {
  get<T = any>(url: string): Promise<T>;
  post<T = any>(url: string, body?: unknown): Promise<T>;
  put<T = any>(url: string, body?: unknown): Promise<T>;
  upload<T = any>(url: string, form: FormData): Promise<T>;
  blob(url: string): Promise<Blob>;
  token(): string | null;
  setToken(t: string | null): void;
}

/** Small fetch wrapper. One per app, each with its own token storage key. */
export function createApi(tokenKey: string, onUnauthorized?: () => void): Api {
  const token = () => {
    try {
      return localStorage.getItem(tokenKey);
    } catch {
      return null;
    }
  };
  const setToken = (t: string | null) => {
    try {
      if (t) localStorage.setItem(tokenKey, t);
      else localStorage.removeItem(tokenKey);
    } catch {
      /* storage blocked: the session just will not persist */
    }
  };

  async function request(method: string, url: string, body?: unknown, form?: FormData): Promise<Response> {
    const headers: Record<string, string> = {};
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
    } catch {
      throw new ApiError(0, 'Cannot reach SpeedGo. Check your connection and try again.', 'NETWORK');
    }
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (res.status === 401 || j.code === 'ACCOUNT_BLOCKED') onUnauthorized?.();
      throw new ApiError(res.status, j.error ?? `Request failed (${res.status})`, j.code);
    }
    return res;
  }
  const json = async <T>(p: Promise<Response>) => (await p).json() as Promise<T>;
  return {
    get: (u) => json(request('GET', u)),
    post: (u, b) => json(request('POST', u, b ?? {})),
    put: (u, b) => json(request('PUT', u, b ?? {})),
    upload: (u, f) => json(request('POST', u, undefined, f)),
    blob: async (u) => (await request('GET', u)).blob(),
    token,
    setToken,
  };
}
