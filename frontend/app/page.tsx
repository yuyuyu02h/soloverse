'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, setToken, setUser, getToken, clearToken, clearUser } from '../lib/api';
import styles from './page.module.css';

function UserIcon() {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="10" r="6" /><path d="M5 29v-3a11 8 0 0 1 22 0v3Z" /></svg>;
}

function LockIcon() {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="6" y="13" width="20" height="17" rx="2" /><path d="M10 13V8a6 6 0 0 1 12 0v5M16 20v3" /></svg>;
}

function GridIcon() {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="3" y="3" width="9" height="9" rx="1.5" /><rect x="20" y="3" width="9" height="9" rx="1.5" /><rect x="3" y="20" width="9" height="9" rx="1.5" /><rect x="20" y="20" width="9" height="9" rx="1.5" /></svg>;
}

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!getToken()) {
      setCheckingSession(false);
      return;
    }
    api.get('/api/auth/me').then(user => {
      if (cancelled) return;
      setUser(user);
      router.replace(user.onboardingDone ? '/timeline' : '/onboarding');
    }).catch(() => {
      if (cancelled) return;
      clearToken();
      clearUser();
      setCheckingSession(false);
    });
    return () => { cancelled = true; };
  }, [router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || checkingSession) return;
    if (!email.trim() || !password || (mode === 'register' && !username.trim())) {
      setError('必要な項目を入力してください');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const body = mode === 'register'
        ? { email: email.trim(), password, username: username.trim() }
        : { email: email.trim(), password };
      const data = await api.post('/api/auth/' + mode, body);
      setToken(data.token);
      setUser({ userId: data.userId, username: data.username, onboardingDone: data.onboardingDone });
      router.replace(data.onboardingDone ? '/timeline' : '/onboarding');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : mode === 'login' ? 'ログインに失敗しました' : '登録に失敗しました');
      setLoading(false);
    }
  };

  const busy = loading || checkingSession;

  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <h1 className={styles.wordmark} aria-label="SoloVerse">Soloverse</h1>
        <section className={styles.auth} aria-label={mode === 'login' ? 'ログイン' : '新規登録'}>
          <h2 className={styles.srOnly}>{mode === 'login' ? 'あなたの世界へログイン' : 'アカウントを作成'}</h2>
          <form onSubmit={submit} aria-busy={busy}>
            <fieldset className={styles.fields} disabled={busy}>
              <legend className={styles.srOnly}>{mode === 'login' ? 'ログイン情報' : '登録情報'}</legend>
              {mode === 'register' && (
                <label className={styles.field}>
                  <UserIcon />
                  <span className={styles.srOnly}>ユーザー名</span>
                  <input name="username" autoComplete="username" maxLength={30} placeholder="ユーザー名" value={username} onChange={e => setUsername(e.target.value)} required />
                </label>
              )}
              <label className={styles.field}>
                <UserIcon />
                <span className={styles.srOnly}>メールアドレス</span>
                <input name="email" autoComplete="email" type="email" maxLength={254} placeholder="メールアドレス" value={email} onChange={e => setEmail(e.target.value)} required spellCheck={false} autoCapitalize="none" />
              </label>
              <label className={styles.field}>
                <LockIcon />
                <span className={styles.srOnly}>パスワード</span>
                <input name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 8 : undefined} maxLength={128} type="password" placeholder={mode === 'login' ? 'パスワード' : 'パスワード（8文字以上）'} value={password} onChange={e => setPassword(e.target.value)} required />
              </label>
            </fieldset>
            <div className={styles.actions}>
              <button className={styles.submit} type="submit" disabled={busy}>
                {busy ? <span className={styles.spinner} aria-hidden="true" /> : <svg className={styles.arrow} viewBox="0 0 64 40" fill="none" aria-hidden="true"><path d="M3 20h55M40 3l18 17-18 17" /></svg>}
                <span>{checkingSession ? 'ログイン状態を確認中' : loading ? '処理中...' : mode === 'login' ? 'ログイン' : '登録してはじめる'}</span>
              </button>
              <button className={styles.switchMode} type="button" disabled={busy} onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
                <GridIcon />
                <span>{mode === 'login' ? '新規登録' : 'ログインへ'}</span>
              </button>
            </div>
            <div className={styles.feedback}>
              {error && <p className={styles.error} role="alert">{error}</p>}
              {mode === 'register' && !error && <p>登録後、あなただけの世界をつくります。</p>}
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
