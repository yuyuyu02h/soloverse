'use client';

import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Avatar, timeAgo } from './utils';

interface Notification {
  id: string;
  type: 'like' | 'reply' | 'follow' | 'absence';
  character_name: string;
  character_handle: string;
  avatar_seed?: string;
  post_content?: string;
  read: number;
  created_at: string;
}

export function NotificationPanel({ onClose, onUnreadCountUpdate }: {
  onClose: () => void;
  onUnreadCountUpdate: (count: number) => void;
}) {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/timeline/notifications')
      .then(d => {
        setNotifs(d.notifications);
        onUnreadCountUpdate(0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const label = (n: Notification) => {
    if (n.type === 'like')    return `${n.character_name}さんがいいねしました`;
    if (n.type === 'reply')   return `${n.character_name}さんが返信しました`;
    if (n.type === 'follow')  return `${n.character_name}さんがフォローしました 👋`;
    if (n.type === 'absence') return `${n.character_name}さんがあなたのことを気にしています`;
    return `${n.character_name}さんからの通知`;
  };

  const icon = (type: string) => {
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
