'use client';

import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Avatar, timeAgo } from './utils';
import { ContentStatus } from './ContentStatus';
import { MODE_OPTIONS, CONTEXT_FIELDS, CONTEXT_LABELS, type ExperienceMode } from '../lib/worldModes';

interface Trend {
  id: string;
  keyword: string;
  description: string;
  post_count: number;
}

interface Character {
  id: string;
  name: string;
  username: string;
  avatar_seed?: string;
  bio?: string;
  personality: string;
  interests: string;
  reply_style: string;
  total_likes_given: number;
  total_posts: number;
  created_at: string;
}

export function TrendPanel({ onClose, onTrendClick, onWorldRebuilt }: {
  onClose: () => void;
  onTrendClick: (keyword: string) => void;
  onWorldRebuilt: () => Promise<void> | void;
}) {
  const [trends, setTrends] = useState<Trend[]>([]);
  const [chars, setChars] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'trends' | 'followers'>('trends');
  const [rebuilding, setRebuilding] = useState(false);
  const [theme, setTheme] = useState('');
  const [themeDraft, setThemeDraft] = useState('');
  const [mode, setMode] = useState<ExperienceMode>('hobby');
  const [modeDraft, setModeDraft] = useState<ExperienceMode>('hobby');
  const [changingTheme, setChangingTheme] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/api/timeline/trends'),
      api.get('/api/timeline/characters'),
      api.get('/api/onboarding/world'),
    ]).then(([td, cd, world]) => {
      setTrends(td.trends);
      setChars(cd.characters);
      setTheme(world.settings?.interests || '');
      setThemeDraft(world.settings?.interests || '');
      setMode(world.settings?.mode || 'hobby');
      setModeDraft(world.settings?.mode || 'hobby');
    }).catch(e => setError(e instanceof Error ? e.message : '読み込みに失敗しました'))
      .finally(() => setLoading(false));
  }, []);

  const changeTheme = async () => {
    if (changingTheme || !themeDraft.trim()) return;
    setChangingTheme(true); setError('');
    try {
      await api.post('/api/onboarding/theme', { mode: modeDraft, [CONTEXT_FIELDS[modeDraft]]: themeDraft.trim() });
      await onWorldRebuilt();
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'テーマを変更できませんでした'); }
    finally { setChangingTheme(false); }
  };

  const rebuildWorld = async () => {
    if (rebuilding) return;
    const accepted = window.confirm(
      'AI住人・AI投稿・AI通知を新しく作り直します。あなた自身の投稿とアカウントは残ります。続けますか？'
    );
    if (!accepted) return;
    setRebuilding(true);
    setError('');
    try {
      const result = await api.post('/api/onboarding/regenerate', {});
      if (result.warning) window.alert(result.warning);
      await onWorldRebuilt();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '作り直しに失敗しました');
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 16px', zIndex: 100, overflowY: 'auto',
    }} onClick={onClose}>
      <div style={{
        background: '#000', borderRadius: 16, width: '100%', maxWidth: 480,
        border: '1px solid #2f3336', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ padding: '14px 16px', borderBottom: '1px solid #2f3336', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 0 }}>
            {(['trends', 'followers'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '0 16px 10px',
                color: tab === t ? '#e7e9ea' : '#71767b', fontWeight: tab === t ? 700 : 400, fontSize: 15,
                borderBottom: tab === t ? '2px solid #1d9bf0' : '2px solid transparent',
              }}>
                {t === 'trends' ? 'トレンド' : 'AI住人'}
              </button>
            ))}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#71767b', fontSize: 22 }}>×</button>
        </div>

        <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {!loading && <div style={{ padding: 16, borderBottom: '1px solid #2f3336' }}>
            <label htmlFor="world-mode" style={{ display: 'block', color: '#e7e9ea', fontWeight: 600, marginBottom: 8 }}>体験モード</label>
            <select id="world-mode" value={modeDraft} onChange={e => { const value = e.target.value as ExperienceMode; setModeDraft(value); setThemeDraft(value === mode ? theme : ''); }} disabled={changingTheme || rebuilding}
              style={{ width: '100%', background: '#101114', color: '#e7e9ea', border: '1px solid #536471', borderRadius: 8, padding: 10, marginBottom: 16, font: 'inherit' }}>
              {MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <label htmlFor="world-theme" style={{ display: 'block', color: '#e7e9ea', fontWeight: 600, marginBottom: 8 }}>{CONTEXT_LABELS[modeDraft]}</label>
            <textarea id="world-theme" value={themeDraft} onChange={e => setThemeDraft(e.target.value)} maxLength={300} rows={2} disabled={changingTheme || rebuilding}
              style={{ width: '100%', boxSizing: 'border-box', background: '#101114', color: '#e7e9ea', border: '1px solid #536471', borderRadius: 8, padding: 10, font: 'inherit', resize: 'vertical' }} />
            <p style={{ color: '#8b8d93', fontSize: 12, lineHeight: 1.6 }}>これまでの投稿は保存されます。選んだ体験に合う住人を準備します。</p>
            <button onClick={changeTheme} disabled={changingTheme || rebuilding || !themeDraft.trim() || (modeDraft === mode && themeDraft.trim() === theme)}
              style={{ padding: '8px 16px', borderRadius: 18, border: 0, color: '#fff', background: '#5b46c8', opacity: changingTheme || !themeDraft.trim() || (modeDraft === mode && themeDraft.trim() === theme) ? 0.5 : 1, cursor: 'pointer' }}>
              {changingTheme ? '新しい世界を準備しています…' : '体験を変更'}
            </button>
          </div>}
          {loading && <div style={{ padding: 24, color: '#71767b', textAlign: 'center', fontSize: 14 }}>読み込み中…</div>}
          {error && <p role="alert" style={{ padding: 16, color: '#ef9999' }}>{error}</p>}

          {/* トレンドタブ */}
          {!loading && tab === 'trends' && (
            <>
              {trends.length === 0 && (
                <div style={{ padding: 40, color: '#71767b', textAlign: 'center' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
                  <div style={{ fontSize: 14 }}>トレンドはまだありません</div>
                  <p style={{ fontSize: 12 }}>投稿に #ハッシュタグ を付けると、約5分ごとに集計されます。</p>
                </div>
              )}
              {trends.map((t, i) => (
                <div key={t.id}
                  onClick={() => { onTrendClick(t.keyword); onClose(); }}
                  style={{
                    padding: '12px 16px', borderBottom: '1px solid #1e2732',
                    cursor: 'pointer', transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#080808')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ color: '#71767b', fontSize: 11, marginBottom: 2 }}>トレンド #{i + 1}</div>
                      <div style={{ color: '#e7e9ea', fontWeight: 700, fontSize: 15 }}>#{t.keyword}</div>
                      <div style={{ color: '#71767b', fontSize: 12, marginTop: 2 }}>{t.description}</div>
                    </div>
                    {t.post_count > 0 && (
                      <span style={{ color: '#71767b', fontSize: 12 }}>{t.post_count}件</span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}

          {/* フォロワータブ */}
          {!loading && tab === 'followers' && (
            <>
              {chars.length === 0 && (
                <div style={{ padding: 40, color: '#71767b', textAlign: 'center' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>👥</div>
                  <div style={{ fontSize: 14 }}>フォロワーはまだいません</div>
                </div>
              )}
              {chars.map(c => (
                <div key={c.id} style={{
                  padding: '12px 16px', borderBottom: '1px solid #1e2732',
                  display: 'flex', gap: 10,
                }}>
                  <Avatar seed={c.avatar_seed} name={c.name} size={42} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ color: '#e7e9ea', fontWeight: 700, fontSize: 14 }}>{c.name}</span>
                      <span style={{ color: '#71767b', fontSize: 12 }}>@{c.username}</span>
                      <span style={{ color: '#4a4a4a', fontSize: 11, marginLeft: 'auto' }}>
                        {timeAgo(c.created_at)}からフォロー中
                      </span>
                    </div>
                    {c.bio && <p style={{ margin: '3px 0 5px', color: '#8b8d93', fontSize: 12, lineHeight: 1.4 }}>{c.bio}</p>}
                    <details style={{ margin: '8px 0', fontSize: 12, color: '#a6aeb7' }}>
                      <summary style={{ cursor: 'pointer' }}>この住人について</summary>
                      <p>興味：{c.interests}</p><p>性格：{c.personality}</p><p>話し方：{c.reply_style}</p>
                    </details>
                    <div style={{ display: 'flex', gap: 14, color: '#71767b', fontSize: 11 }}>
                      <span>💬 {c.total_posts}件投稿</span>
                      <span>❤️ {c.total_likes_given}いいね</span>
                    </div>
                  </div>
                </div>
              ))}
              {chars.length > 0 && (
                <div style={{ padding: 16, borderTop: '1px solid #2f3336' }}>
                  <button
                    onClick={rebuildWorld}
                    disabled={rebuilding || changingTheme}
                    style={{
                      width: '100%', padding: '10px 14px', borderRadius: 18,
                      border: '1px solid #536471', color: '#e7e9ea', background: 'transparent',
                      cursor: rebuilding ? 'wait' : 'pointer', opacity: rebuilding ? 0.6 : 1,
                    }}
                  >
                    {rebuilding ? 'AI住人を作り直しています…' : 'AI住人とAI投稿を作り直す'}
                  </button>
                  <p style={{ margin: '8px 4px 0', color: '#71767b', fontSize: 11, lineHeight: 1.5 }}>
                    アカウントとあなたの投稿は残ります。投稿候補も作り直し、複数回の生成APIを使用します。
                  </p>
                </div>
              )}
            </>
          )}
          <ContentStatus />
        </div>
      </div>
    </div>
  );
}
