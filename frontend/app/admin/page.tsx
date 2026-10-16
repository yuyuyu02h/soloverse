'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import styles from './page.module.css';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const SESSION_KEY = 'sv_admin_token';
interface Overview {
  username: string; users: number; configuredUsers: number; posts: number; pending: number;
  modes: { mode: string; label: string; count: number }[];
  today: { outcome: string; total: number }[]; llmConfigured: boolean; checkedAt: string;
}
async function adminRequest(path: string, body?: object) {
  const token = sessionStorage.getItem(SESSION_KEY);
  const response = await fetch(`${API}${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) sessionStorage.removeItem(SESSION_KEY);
    throw new Error(data.error || '管理情報を取得できませんでした');
  }
  return data;
}
export default function AdminPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const refresh = async () => {
    setBusy(true); setError('');
    try { setOverview(await adminRequest('/api/admin/overview')); }
    catch (e) { setError(e instanceof Error ? e.message : '接続に失敗しました'); if (!sessionStorage.getItem(SESSION_KEY)) setOverview(null); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (sessionStorage.getItem(SESSION_KEY)) void refresh(); else setBusy(false); }, []);
  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await adminRequest('/api/auth/admin/login', { email: email.trim(), password });
      sessionStorage.setItem(SESSION_KEY, result.token); setPassword('');
      setOverview(await adminRequest('/api/admin/overview'));
    } catch (e) { setError(e instanceof Error ? e.message : 'ログインできませんでした'); }
    finally { setBusy(false); }
  };
  return <div className={styles.page}>
    <header className={styles.header}><Link href="/">SoloVerse</Link><span>管理者</span></header>
    <main className={styles.main}>
      <div className={styles.heading}><span>ADMINISTRATION</span><h1>{overview ? '運営状況' : '管理者としてログイン'}</h1>
        <p>{overview ? `${overview.username} さんとしてログイン中` : '管理者として許可されたアカウントを使用してください。'}</p></div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!overview ? <form className={styles.panel} onSubmit={login} aria-label="管理者ログイン" aria-busy={busy}>
        <label htmlFor="admin-email">メールアドレス</label>
        <input id="admin-email" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} maxLength={254} required disabled={busy} />
        <label htmlFor="admin-password">パスワード</label>
        <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} maxLength={128} required disabled={busy} />
        <button type="submit" disabled={busy}>{busy ? '確認しています…' : '管理者としてログイン'}</button>
        <Link href="/">通常のログインへ戻る</Link>
      </form> : <>
        <div className={styles.actions}><button onClick={()=>void refresh()} disabled={busy}>{busy ? '更新中…' : '更新する'}</button><button disabled={busy} onClick={()=>{sessionStorage.removeItem(SESSION_KEY);setOverview(null);setError('');}}>管理者ログアウト</button></div>
        <div className={styles.metrics}>{[['登録ユーザー',overview.users],['設定完了',overview.configuredUsers],['保存された投稿',overview.posts],['公開待ちの投稿',overview.pending]].map(([label,value])=><div className={styles.panel} key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        <section className={styles.panel}><h2>体験モードの利用状況</h2>{overview.modes.map(mode=><div className={styles.row} key={mode.mode}><span>{mode.label}</span><b>{mode.count}人</b></div>)}</section>
        <section className={styles.panel}><h2>生成サービス</h2><p>AI API：{overview.llmConfigured ? '設定済み' : '未設定'}</p><p>本日の生成処理（UTC集計）</p>{overview.today.length ? overview.today.map(item=><div className={styles.row} key={item.outcome}><span>{({ generated:'生成候補',screened:'一次確認済み',accepted:'採用',rejected:'見送り',deferred:'再試行待ち',published:'公開',template:'補助投稿' } as Record<string,string>)[item.outcome] || item.outcome}</span><b>{item.total}件</b></div>) : <p>本日の処理はありません。</p>}</section>
        <p className={styles.updated}>確認時刻：{new Date(overview.checkedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}（日本時間）</p>
      </>}
    </main>
  </div>;
}
