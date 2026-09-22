'use client';

import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Avatar, timeAgo, renderContent } from './utils';
import type { Post } from './PostCard';

const formatCount = (value: number) => new Intl.NumberFormat('ja-JP').format(Number(value) || 0);

export function ReplyPanel({ post, onClose, currentUser, onReplySent }: {
  post: Post;
  onClose: () => void;
  currentUser: { username: string };
  onReplySent?: () => void;
}) {
  const [replies, setReplies] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState('');
  const [replyTo, setReplyTo] = useState<Post>(post);

  useEffect(() => {
    let cancelled = false;
    let refreshing = false;
    setReplyTo(post);
    setLoading(true);
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      await api.get(`/api/timeline/replies/${post.id}`)
      .then(d => {
        if (cancelled) return;
        setLoadError('');
        setReplies(d.replies);
        setLikedPosts(new Set(d.replies.filter((reply: Post) => Boolean(reply.user_liked)).map((reply: Post) => reply.id)));
        setLikeCounts(Object.fromEntries(d.replies.map((reply: Post) => [reply.id, Number(reply.like_count)])));
      }).catch(e => { if (!cancelled) setLoadError(e instanceof Error ? e.message : '返信の読み込みに失敗しました'); })
      .finally(() => { refreshing = false; if (!cancelled) setLoading(false); });
    };
    void refresh();
    const interval = setInterval(refresh, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [post.id]);

  const sendReply = async () => {
    if (!replyText.trim() || sending) return;
    setSending(true);
    setSendError('');
    try {
      await api.post('/api/timeline/post', { content: replyText.trim(), replyTo: replyTo.id });
      setReplyText('');
      const d = await api.get(`/api/timeline/replies/${post.id}`);
      setReplies(d.replies);
      setLikedPosts(new Set(d.replies.filter((reply: Post) => Boolean(reply.user_liked)).map((reply: Post) => reply.id)));
      setLikeCounts(Object.fromEntries(d.replies.map((reply: Post) => [reply.id, Number(reply.like_count)])));
      onReplySent?.();
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : '返信に失敗しました');
    }
    setSending(false);
  };

  const handleLikeReply = async (replyId: string) => {
    const wasLiked = likedPosts.has(replyId);
    try {
      const result = await api.post(`/api/timeline/like/${replyId}`, {});
      setLikedPosts(prev => {
        const next = new Set(prev);
        result.liked ? next.add(replyId) : next.delete(replyId);
        return next;
      });
      setLikeCounts(previous => ({
        ...previous,
        [replyId]: Math.max(0, (previous[replyId] || 0) + (result.liked === wasLiked ? 0 : result.liked ? 1 : -1)),
      }));
    } catch (e) { console.error(e); }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 16px', zIndex: 100, overflowY: 'auto',
    }} onClick={onClose}>
      <div style={{
        background: '#000', borderRadius: 16, width: '100%', maxWidth: 580,
        border: '1px solid #2f3336', overflow: 'hidden',
      }} onClick={e => e.stopPropagation()}>

        {/* ヘッダー */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #2f3336', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#e7e9ea', fontWeight: 700, fontSize: 17 }}>スレッド</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#71767b', fontSize: 22, lineHeight: 1 }}>×</button>
        </div>

        {/* 元投稿 */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #2f3336' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <Avatar seed={post.avatar_seed} name={post.author_name} size={40} />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <span style={{ color: '#e7e9ea', fontWeight: 700, fontSize: 15 }}>{post.author_name}</span>
                <span style={{ color: '#71767b', fontSize: 13 }}>@{post.author_handle}</span>
              </div>
              <p style={{ margin: '0 0 8px', color: '#e7e9ea', fontSize: 16, lineHeight: 1.6 }}>
                {renderContent(post.content)}
              </p>
              <span style={{ color: '#71767b', fontSize: 12 }}>{timeAgo(post.created_at)}</span>
            </div>
          </div>
        </div>

        {/* リプライ一覧 */}
        <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {loading && <div style={{ padding: 24, color: '#71767b', textAlign: 'center', fontSize: 14 }}>読み込み中…</div>}
          {!loading && loadError && <div style={{ padding: 24, color: '#e05555', textAlign: 'center', fontSize: 14 }}>{loadError}</div>}
          {!loading && !loadError && replies.length === 0 && (
            <div style={{ padding: 28, color: '#71767b', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
              <div style={{ fontSize: 14 }}>まだ返信はありません</div>
              <div style={{ fontSize: 12, marginTop: 4, color: '#4a4a4a' }}>AIたちが考え中かも…</div>
            </div>
          )}
          {replies.map(r => (
            <div key={r.id} style={{ padding: '12px 16px', marginLeft: Math.min(r.depth || 0, 3) * 12, borderBottom: '1px solid #1e2732', display: 'flex', gap: 10 }}>
              <Avatar seed={r.avatar_seed} name={r.author_name} size={34} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{ color: '#e7e9ea', fontWeight: 600, fontSize: 14 }}>{r.author_name}</span>
                  <span style={{ color: '#71767b', fontSize: 12 }}>@{r.author_handle} · {timeAgo(r.created_at)}</span>
                </div>
                <p style={{ margin: '0 0 8px', color: '#e7e9ea', fontSize: 14, lineHeight: 1.5 }}>
                  {r.reply_to && r.reply_to !== post.id && <small style={{ display: 'block', color: '#71767b' }}>
                    @{replies.find(parent => parent.id === r.reply_to)?.author_handle || post.author_handle} への返信
                  </small>}
                  {renderContent(r.content)}
                </p>
                <button onClick={() => !r.synthetic && handleLikeReply(r.id)} disabled={r.synthetic} style={{
                  background: 'none', border: 'none', cursor: r.synthetic ? 'default' : 'pointer',
                  color: likedPosts.has(r.id) ? '#f91880' : '#71767b',
                  display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: 0,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24"
                    fill={likedPosts.has(r.id) ? '#f91880' : 'none'} stroke="currentColor" strokeWidth="1.8">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                  </svg>
                  {(likeCounts[r.id] || 0) > 0 && <span>{formatCount(likeCounts[r.id])}</span>}
                </button>
                {!r.synthetic && <button onClick={() => setReplyTo(r)} style={{ marginTop: 8, background: 'none', border: 0, color: '#1d9bf0', cursor: 'pointer' }}>この投稿に返信</button>}
              </div>
            </div>
          ))}
        </div>

        {/* 返信入力 */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #2f3336' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <Avatar seed={undefined} name={currentUser.username} size={34} />
            <div style={{ flex: 1 }}>
              <div style={{ color: '#a6aeb7', fontSize: 12, marginBottom: 6 }}>
                @{replyTo.author_handle} に返信
                {replyTo.id !== post.id && <button onClick={() => setReplyTo(post)} style={{ marginLeft: 8 }}>元の投稿に戻す</button>}
              </div>
              <textarea
                value={replyText} onChange={e => setReplyText(e.target.value)}
                placeholder="返信を入力…" maxLength={140} rows={2}
                style={{ width: '100%', background: 'transparent', border: 'none', color: '#e7e9ea', fontSize: 15, resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
              {sendError && (
                <p style={{ color: '#e05555', fontSize: 12, margin: '2px 0 4px' }}>{sendError}</p>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <span style={{ color: replyText.length > 120 ? '#f4212e' : '#71767b', fontSize: 11 }}>{replyText.length}/140</span>
                <button onClick={sendReply} disabled={!replyText.trim() || sending} style={{
                  background: '#1d9bf0', color: '#fff', border: 'none', borderRadius: 20,
                  padding: '6px 16px', fontSize: 13, fontWeight: 700,
                  cursor: replyText.trim() ? 'pointer' : 'not-allowed', opacity: replyText.trim() ? 1 : 0.5,
                }}>
                  {sending ? '送信中…' : '返信'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
