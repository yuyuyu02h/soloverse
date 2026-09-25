'use client';

import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Avatar, timeAgo } from './utils';

interface Notification {
  id: string;
  type: 'like' | 'reply' | 'follow' | 'absence' | 'celebrity_like' | 'celebrity_reply';
  character_name: string;
  character_handle: string;
  avatar_seed?: string;
  post_content?: string;
  read: number;
  created_at: string;
  audience_count?: number;
}

export function NotificationPanel({ onClose, onUnreadCountUpdate }: {
  onClose: () => void;
  onUnreadCountUpdate: (count: number) => void;
}) {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [celebrityEnabled, setCelebrityEnabled] = useState(true);
  const [celebrityMode, setCelebrityMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadNotifications = async () => {
    const data = await api.get('/api/timeline/notifications');
    setNotifs(data.notifications);
    setCelebrityEnabled(data.celebrityNotificationsEnabled);
    setCelebrityMode(data.celebrityMode);
    onUnreadCountUpdate(0);
  };

  useEffect(() => {
    loadNotifications()
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!celebrityMode) return;
    const interval = setInterval(() => { void loadNotifications().catch(console.error); }, 5000);
    return () => clearInterval(interval);
  }, [celebrityMode]);

  const toggleCelebrityNotifications = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await api.post('/api/timeline/notifications/celebrity-settings', { enabled: !celebrityEnabled });
      await loadNotifications();
      const state = await api.get('/api/timeline/notifications/unread-count');
      onUnreadCountUpdate(state.count);
    } catch (e) {
      setError(e instanceof Error ? e.message : '通知設定を変更できませんでした');
    } finally { setSaving(false); }
  };

  const label = (n: Notification) => {
    if (n.type === 'celebrity_like') return `${new Intl.NumberFormat('ja-JP').format(n.audience_count || 0)}人があなたの投稿にいいねしました`;
    if (n.type === 'celebrity_reply') return `${n.character_name}さんがあなたの投稿に返信しました`;
    if (n.type === 'like')    return `${n.character_name}さんがいいねしました`;
    if (n.type === 'reply')   return `${n.character_name}さんが返信しました`;
    if (n.type === 'follow')  return `${n.character_name}さんがフォローしました 👋`;
    if (n.type === 'absence') return `${n.character_name}さんがあなたのことを気にしています`;
    return `${n.character_name}さんからの通知`;
  };

  const icon = (type: string) => {
    if (type === 'celebrity_like') return '❤️';
    if (type === 'celebrity_reply') return '💬';
    if (type === 'like')    return '❤️';
    if (type === 'reply')   return '💬';
    if (type === 'follow')  return '✨';
    if (type === 'absence') return '🌙';
    return '🔔';
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
          <span style={{ color: '#e7e9ea', fontWeight: 700, fontSize: 17 }}>通知</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#71767b', fontSize: 22 }}>×</button>
        </div>

        {celebrityMode && <div style={{ padding: '11px 16px', borderBottom: '1px solid #2f3336', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <div style={{ color: '#e7e9ea', fontSize: 13, fontWeight: 600 }}>有名人体験の通知</div>
            <div style={{ color: '#71767b', fontSize: 11 }}>アプリ内の反応通知を表示</div>
          </div>
          <button type="button" role="switch" aria-checked={celebrityEnabled} aria-label="有名人体験の通知" onClick={toggleCelebrityNotifications} disabled={saving} style={{ border: 0, borderRadius: 20, padding: '5px 12px', background: celebrityEnabled ? '#7c6af7' : '#333', color: '#fff', cursor: saving ? 'wait' : 'pointer', minWidth: 52 }}>
            {celebrityEnabled ? 'ON' : 'OFF'}
          </button>
        </div>}
        {error && <div role="alert" style={{ color: '#e05555', padding: '8px 16px', fontSize: 12 }}>{error}</div>}

        <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {loading && <div style={{ padding: 24, color: '#71767b', textAlign: 'center', fontSize: 14 }}>読み込み中…</div>}
          {!loading && notifs.length === 0 && (
            <div style={{ padding: 40, color: '#71767b', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔔</div>
              <div style={{ fontSize: 14 }}>まだ通知はありません</div>
            </div>
          )}
          {notifs.map(n => (
            <div key={n.id} style={{
              padding: '12px 16px', borderBottom: '1px solid #1e2732', display: 'flex', gap: 10,
              background: n.read ? 'transparent' : 'rgba(29,155,240,0.06)',
            }}>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <Avatar seed={n.avatar_seed} name={n.character_name || '?'} size={38} />
                <span style={{
                  position: 'absolute', bottom: -2, right: -2,
                  fontSize: 14, lineHeight: 1,
                }}>{icon(n.type)}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: '0 0 3px', color: '#e7e9ea', fontSize: 14, lineHeight: 1.4 }}>
                  {label(n)}
                </p>
                {n.post_content && (
                  <p style={{ margin: 0, color: '#71767b', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    「{n.post_content}」
                  </p>
                )}
                <p style={{ margin: '3px 0 0', color: '#4a4a4a', fontSize: 11 }}>{timeAgo(n.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
