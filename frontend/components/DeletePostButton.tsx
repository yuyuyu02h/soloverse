'use client';

import { useState } from 'react';
import { api } from '../lib/api';
import type { Post } from './PostCard';

export function DeletePostButton({ post, currentUserId, onDeleted }: {
  post: Post;
  currentUserId: string;
  onDeleted: (id: string) => void | Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  if (post.author_type !== 'user' || post.author_id !== currentUserId || post.deleted_at) return null;
  const remove = async () => {
    if (deleting) return;
    setDeleting(true); setError('');
    try {
      await api.delete(`/api/timeline/post/${encodeURIComponent(post.id)}`);
      await onDeleted(post.id);
      setConfirming(false);
    } catch (e) { setError(e instanceof Error ? e.message : '投稿を削除できませんでした'); }
    finally { setDeleting(false); }
  };
  return <div onClick={e => e.stopPropagation()} style={{ display: 'inline-flex' }}>
    <button aria-label="投稿を削除" title="投稿を削除" onClick={() => setConfirming(true)} style={{ background: 'none', border: 0, padding: '0 4px', color: '#71767b', cursor: 'pointer', fontSize: 16 }}>⋯</button>
    {confirming && <div role="dialog" aria-modal="true" aria-label="投稿の削除確認" style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'default' }}>
      <div style={{ background: '#000', border: '1px solid #2f3336', borderRadius: 16, padding: 24, width: '100%', maxWidth: 340, color: '#e7e9ea' }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>この投稿を削除しますか？</h2>
        <p style={{ fontSize: 14, color: '#a6aeb7', lineHeight: 1.6 }}>本文は元に戻せません。すでに付いている返信は残ります。</p>
        {error && <p role="alert" style={{ color: '#e05555', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button disabled={deleting} onClick={() => { setConfirming(false); setError(''); }} style={{ border: '1px solid #536471', background: '#000', color: '#e7e9ea', padding: '8px 16px', borderRadius: 20, cursor: 'pointer' }}>キャンセル</button>
          <button disabled={deleting} onClick={() => void remove()} style={{ border: 0, background: '#f4212e', color: '#fff', padding: '8px 16px', borderRadius: 20, cursor: 'pointer' }}>{deleting ? '削除中…' : '削除する'}</button>
        </div>
      </div>
    </div>}
  </div>;
}
