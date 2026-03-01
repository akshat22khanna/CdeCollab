const TOKEN_KEY = 'codecollab_token';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://akshat22khanna-codecollab-api.onrender.com';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (!token) return localStorage.removeItem(TOKEN_KEY);
  localStorage.setItem(TOKEN_KEY, token);
}

export async function api(path: string, init?: RequestInit & { skipAuth?: boolean }) {
  const headers = new Headers(init?.headers || {});
  if (!init?.skipAuth) {
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new Error(`Cannot reach API at ${API_URL}. Start backend with: npm run dev:api`);
  }
  if (!res.ok) throw new Error((await res.text()) || `Request failed: ${res.status}`);
  return res.json();
}
