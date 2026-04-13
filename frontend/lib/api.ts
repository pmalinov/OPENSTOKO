export const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export async function api<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = { ...((options.headers as Record<string, string>) || {}) };
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers, cache: 'no-store' });
  if (!res.ok) {
    const raw = await res.text();
    let message = raw || `Request failed with status ${res.status}`;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.detail === 'string') {
        message = parsed.detail;
      } else if (Array.isArray(parsed?.detail)) {
        message = parsed.detail.map((item: any) => item?.msg || JSON.stringify(item)).join('; ');
      } else if (!raw) {
        message = `Request failed with status ${res.status}`;
      }
    } catch {
      message = raw || `Request failed with status ${res.status}`;
    }
    throw new Error(message);
  }
  return res.json();
}
