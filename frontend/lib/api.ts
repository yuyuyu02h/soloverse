const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('sv_token');
}

export function setToken(token: string) {
  localStorage.setItem('sv_token', token);
}

export function clearToken() {
  localStorage.removeItem('sv_token');
}

export function clearUser() {
  localStorage.removeItem('sv_user');
}

export function getUser() {
  if (typeof window === 'undefined') return null;
  const s = localStorage.getItem('sv_user');
  if (!s) return null;
  try {
    const user = JSON.parse(s);
    return user && typeof user.userId === 'string' && typeof user.username === 'string' ? user : null;
  } catch {
    clearUser();
    return null;
  }
}

export function setUser(user: object) {
  localStorage.setItem('sv_user', JSON.stringify(user));
}

async function request(path: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...options, headers });
  } catch {
    throw new Error('サーバーに接続できません。バックエンドが起動しているか確認してください');
  }
  const raw = await res.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { throw new Error(`サーバーから不正な応答を受信しました (HTTP ${res.status})`); }

  if (res.status === 401) {
    // トークンの署名は有効でも、参照先のユーザーがDB上に存在しない場合がある
    // （開発中にDBだけリセットした/本番でセッションが失効した等）。
    // この場合は手動でデベロッパツールから消さなくても、自動でログイン画面に戻す。
    clearToken();
    clearUser();
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.location.href = '/';
    }
  }

  if (!res.ok) throw new Error(data.error || 'リクエストに失敗しました');
  return data;
}

export const api = {
  post: (path: string, body: object) =>
    request(path, { method: 'POST', body: JSON.stringify(body) }),
  get: (path: string) =>
    request(path, { method: 'GET' }),
};
