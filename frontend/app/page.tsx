'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken, setUser, getToken, clearToken, clearUser } from '../lib/api';

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (token) {
      api.get('/api/auth/me').then(user => {
        setUser(user);
        router.replace(user.onboardingDone ? '/timeline' : '/onboarding');
      }).catch(() => {
        clearToken();
        clearUser();
      });
    }
  }, []);

  const submit = async () => {
    if (loading) return;
    if (!email.trim() || !password || (mode === 'register' && !username.trim())) {
      setError('必要な項目を入力してください');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const body = mode === 'register'
        ? { email, password, username }
        : { email, password };
      const data = await api.post('/api/auth/' + mode, body);
      setToken(data.token);
      setUser({ userId: data.userId, username: data.username, onboardingDone: data.onboardingDone });
      router.push(data.onboardingDone ? '/timeline' : '/onboarding');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em' }}>SoloVerse</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem', fontSize: '0.95rem' }}>あなただけの世界へ</p>
      </div>
      <div style={{ width: '100%', maxWidth: '380px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '2rem' }}>
        <div style={{ display: 'flex', marginBottom: '1.5rem', gap: '4px', background: 'var(--bg)', borderRadius: '8px', padding: '4px' }}>
          {(['login', 'register'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setError(''); }} style={{ flex: 1, padding: '0.5rem', background: mode === m ? 'var(--surface)' : 'transparent', border: 'none', borderRadius: '6px', color: mode === m ? 'var(--text)' : 'var(--text-muted)', fontSize: '0.9rem', fontWeight: mode === m ? 600 : 400 }}>
              {m === 'login' ? 'ログイン' : '新規登録'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {mode === 'register' && (
            <input aria-label="ユーザー名" autoComplete="username" maxLength={30} placeholder="ユーザー名" value={username} onChange={e => setUsername(e.target.value)} style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '0.95rem', outline: 'none' }} />
          )}
          <input aria-label="メールアドレス" autoComplete="email" type="email" placeholder="メールアドレス" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '0.95rem', outline: 'none' }} />
          <input aria-label="パスワード" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} maxLength={128} type="password" placeholder="パスワード" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '0.95rem', outline: 'none' }} />
        </div>
        {error && <p role="alert" aria-live="polite" style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{error}</p>}
        <button onClick={submit} disabled={loading || !email.trim() || !password || (mode === 'register' && !username.trim())} style={{ width: '100%', marginTop: '1.25rem', padding: '0.75rem', background: loading || !email.trim() || !password || (mode === 'register' && !username.trim()) ? 'var(--surface2)' : 'var(--accent)', border: 'none', borderRadius: '8px', color: 'var(--text)', fontSize: '0.95rem', fontWeight: 600 }}>
          {loading ? '処理中...' : mode === 'login' ? 'ログイン' : '登録する'}
        </button>
      </div>
    </div>
  );
}
