'use client';

import { useEffect, useState } from 'react';
import { Avatar, timeAgo, renderContent } from './utils';
import { DeletePostButton } from './DeletePostButton';

export interface Post {
  id: string;
  author_id?: string;
  deleted_at?: string | null;
  author_type: 'user' | 'ai';
  author_name: string;
  author_handle: string;
  avatar_seed?: string;
  content: string;
  created_at: string;
  like_count: number;
  reply_count: number;
  user_liked: number;
  reply_preview?: Post[];
  reply_to?: string | null;
  depth?: number;
  synthetic?: boolean;
  experience_mode?: 'hobby' | 'community' | 'celebrity';
  archived?: boolean;
  theme_version?: number;
  celebrity_status?: 'pending' | 'ready' | 'fallback';
  audience_reaction_count?: number;
}

const formatCount = (value: number) => new Intl.NumberFormat('ja-JP').format(Number(value) || 0);

export function PostCard({ post, onLike, onOpenReplies, currentUserId, onDeleted, highlight = false, compact = false }: {
  post: Post;
  onLike: (id: string) => Promise<boolean>;
  onOpenReplies: (post: Post) => void;
  currentUserId?: string;
  onDeleted?: (id: string) => void | Promise<void>;
  highlight?: boolean;
  compact?: boolean;
}) {
  const [liked, setLiked] = useState(!!post.user_liked);
  const [likeCount, setLikeCount] = useState(Number(post.like_count));
  const [pop, setPop] = useState(false);
  const [liking, setLiking] = useState(false);

  useEffect(() => {
    setLiked(Boolean(post.user_liked));
    setLikeCount(Number(post.like_count));
  }, [post.id, post.user_liked, post.like_count]);

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (liking) return;
    const previousLiked = liked;
    const previousCount = likeCount;
    setLiking(true);
    setLiked(!previousLiked);
    setLikeCount(Math.max(0, previousCount + (previousLiked ? -1 : 1)));
    setPop(true); setTimeout(() => setPop(false), 300);
    try {
      const serverLiked = await onLike(post.id);
      if (serverLiked !== !previousLiked) {
        setLiked(serverLiked);
        setLikeCount(Math.max(0, previousCount + (serverLiked ? 1 : -1)));
      }
    } catch {
      setLiked(previousLiked);
      setLikeCount(previousCount);
    } finally {
      setLiking(false);
    }
  };

  const hasReplies = post.reply_preview && post.reply_preview.length > 0;

  return (
    <div data-post-id={post.id} style={{
      borderBottom: '1px solid #2f3336',
      background: highlight ? 'rgba(99,102,241,0.07)' : 'transparent',
      transition: 'background 0.4s',
    }}>
      {/* メイン投稿 */}
      <div
        style={{ padding: compact ? '10px 16px' : '14px 20px', display: 'flex', gap: 10, cursor: 'pointer' }}
        onClick={() => onOpenReplies(post)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
          <Avatar seed={post.avatar_seed} name={post.author_name} size={compact ? 34 : 40} />
          {hasReplies && (
            <div style={{ width: 2, flex: 1, background: '#2f3336', marginTop: 4, minHeight: 12 }} />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: compact ? 13 : 15, color: '#e7e9ea' }}>{post.author_name}</span>
            <span style={{ color: '#71767b', fontSize: compact ? 12 : 13 }}>@{post.author_handle}</span>
            <span style={{ color: '#71767b', fontSize: 12, marginLeft: 'auto' }}>{timeAgo(post.created_at)}</span>
            {currentUserId && onDeleted && <DeletePostButton post={post} currentUserId={currentUserId} onDeleted={onDeleted} />}
          </div>
          <p style={{ margin: '0 0 10px', color: '#e7e9ea', fontSize: compact ? 14 : 15, lineHeight: 1.6, wordBreak: 'break-word' }}>
            {post.deleted_at ? <span style={{ color: '#71767b' }}>この投稿は削除されました</span> : renderContent(post.content)}
          </p>
          {post.archived && <p style={{ color: '#9b8cda', fontSize: 12 }}>以前のテーマの投稿</p>}
          {!post.deleted_at && post.celebrity_status === 'pending' && <p role="status" style={{ color: '#a6aeb7', fontSize: 12 }}>AIの返信を準備しています</p>}
          {!post.deleted_at && post.experience_mode === 'celebrity' && <p style={{ color: '#71767b', fontSize: 11 }}>観客の反応を演出しています。返信数は読めるコメントの件数です。</p>}
          <div style={{ display: 'flex', gap: 20 }}>
            <button onClick={(e) => { e.stopPropagation(); onOpenReplies(post); }} style={{
              background: 'none', border: 'none', cursor: 'pointer', color: '#71767b',
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: 0,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span>返信 {formatCount(post.reply_count)}</span>
            </button>
            <button onClick={handleLike} disabled={liking || Boolean(post.deleted_at)} aria-label={liked ? 'いいねを取り消す' : 'いいね'} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: liked ? '#f91880' : '#71767b',
              display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, padding: 0,
              transform: pop ? 'scale(1.4)' : 'scale(1)', transition: 'transform 0.15s, color 0.15s',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24"
                fill={liked ? '#f91880' : 'none'} stroke="currentColor" strokeWidth="1.8">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
              <span>いいね {formatCount(likeCount)}</span>
            </button>
          </div>
        </div>
      </div>

      {/* リプライプレビュー（スレッド表示） */}
      {hasReplies && post.reply_preview!.map(reply => (
        <div
          key={reply.id}
          data-reply-preview={reply.id}
          onClick={() => onOpenReplies(post)}
          style={{
            padding: '8px 16px 8px 74px', display: 'flex', gap: 10, cursor: 'pointer',
          }}
        >
          <Avatar seed={reply.avatar_seed} name={reply.author_name} size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 5, alignItems: 'baseline', marginBottom: 2 }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: '#e7e9ea' }}>{reply.author_name}</span>
              <span style={{ color: '#71767b', fontSize: 11 }}>@{reply.author_handle} · {timeAgo(reply.created_at)}</span>
              {currentUserId && onDeleted && <DeletePostButton post={reply} currentUserId={currentUserId} onDeleted={onDeleted} />}
            </div>
            <p style={{ margin: 0, color: '#c8cdd2', fontSize: 13, lineHeight: 1.5, wordBreak: 'break-word' }}>
              {reply.deleted_at ? <span style={{ color: '#71767b' }}>この投稿は削除されました</span> : renderContent(reply.content)}
            </p>
          </div>
        </div>
      ))}

      {/* もっと見る */}
      {Number(post.reply_count) > 2 && hasReplies && (
        <div
          onClick={() => onOpenReplies(post)}
          style={{
            padding: '6px 20px 10px 74px', color: '#1d9bf0', fontSize: 13,
            cursor: 'pointer', fontWeight: 500,
          }}
        >
          {post.experience_mode === 'celebrity'
            ? '返信をもっと見る（最大150件）'
            : `${formatCount(Number(post.reply_count) - 2)}件の返信をもっと見る`}
        </div>
      )}
    </div>
  );
}
