'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, logout, setUser as saveUser } from '../../lib/api';
import { PostCard } from '../../components/PostCard';
import { ReplyPanel } from '../../components/ReplyPanel';
import { NotificationPanel } from '../../components/NotificationPanel';
import { TrendPanel } from '../../components/TrendPanel';
import { Avatar } from '../../components/utils';
import type { Post } from '../../components/PostCard';
import { SCREEN_PREVIEW } from '../../lib/deployment';

export default function TimelinePage() {
  const router = useRouter();
  const [user, setUser] = useState<{ userId: string; username: string; resetOnLogout?: boolean } | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [postText, setPostText] = useState('');
  const [posting, setPosting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [postError, setPostError] = useState('');
  const [postNotice, setPostNotice] = useState('');
  const [timelineError, setTimelineError] = useState('');
  const [seedWait, setSeedWait] = useState<{ retryAt?: string } | null>(null);
  const [retryReady, setRetryReady] = useState(true);

  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const [replyTarget, setReplyTarget] = useState<Post | null>(null);
  const [showNotif, setShowNotif] = useState(false);
  const [showTrend, setShowTrend] = useState(false);

  const [unreadCount, setUnreadCount] = useState(0);
  const [newPostIds, setNewPostIds] = useState<Set<string>>(new Set());

  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyMode, setHistoryMode] = useState(false);
  const [theme, setTheme] = useState('');
  const [modeLabel, setModeLabel] = useState('');
  const historyRef = useRef(false);
  const epochRef = useRef(0);
  const themeVersionRef = useRef(1);

  const latestCreatedAt = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const postsRef = useRef<Post[]>([]);
  const mountedRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const mergePosts = (incoming: Post[], previous: Post[]) => {
    const byId = new Map(previous.map(post => [post.id, post]));
    for (const post of incoming) byId.set(post.id, post);
    return [...byId.values()].sort((a, b) => {
      const date = (value: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z').getTime();
      return Math.floor(date(b.created_at) / 1000) - Math.floor(date(a.created_at) / 1000) || b.id.localeCompare(a.id);
    });
  };
  useEffect(() => { postsRef.current = posts; }, [posts]);

  // ─── 初期化 ────────────────────────────────────────────
  useEffect(() => {
    if (SCREEN_PREVIEW) { router.replace('/onboarding'); return; }
    let cancelled = false;
    mountedRef.current = true;
    api.get('/api/auth/me').then(u => {
      if (cancelled) return;
      if (!u.onboardingDone) { router.replace('/onboarding'); return; }
      setUser(u);
      saveUser(u);
      initTimeline();
    }).catch(() => { if (!cancelled) router.replace('/'); });
    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    const delay = seedWait?.retryAt ? Date.parse(seedWait.retryAt) - Date.now() : 0;
    setRetryReady(!(delay > 0));
    if (!(delay > 0)) return;
    const timer = setTimeout(() => setRetryReady(true), Math.min(delay, 2147483647));
    return () => clearTimeout(timer);
  }, [seedWait]);

  const initTimeline = async () => {
    const epoch = ++epochRef.current;
    latestCreatedAt.current = null;
    postsRef.current = [];
    setPosts([]);
    setLoading(true);
    setTimelineError('');
    setSeedWait(null);
    try {
      setSeeding(true);
      let seedError = '';
      try {
        const seed = await api.post('/api/timeline/seed', {});
        if (seed.status === 'waiting') {
          seedError = seed.message;
          setSeedWait({ retryAt: seed.retryAt });
        }
      }
      catch (e) { seedError = e instanceof Error ? e.message : 'AIの投稿を準備できませんでした'; }
      setSeeding(false);

      const data = await api.get('/api/timeline?page=0' + (historyRef.current ? '&history=true' : ''));
      if (epoch !== epochRef.current) return;
      setTheme(data.theme || '');
      setModeLabel(data.modeLabel || '');
      themeVersionRef.current = data.themeVersion || 1;
      setTimelineError(seedError);
      setPosts(data.posts);
      setHasMore(data.posts.length === 30);
      if (data.posts.length > 0) {
        latestCreatedAt.current = data.posts[0].created_at;
      }

      const nc = await api.get('/api/timeline/notifications/unread-count').catch(() => ({ count: 0 }));
      setUnreadCount(nc.count);
    } catch (e) {
      console.error('Init error:', e);
      setTimelineError(e instanceof Error ? e.message : 'タイムラインを読み込めませんでした');
    } finally {
      if (epoch === epochRef.current) { setLoading(false); setSeeding(false); }
    }

    if (mountedRef.current && epoch === epochRef.current) startPolling();
  };

  const startPolling = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      const epoch = epochRef.current;
      try {
        // 差分のみ取得（sinceパラメータで最新投稿以降だけ）
        const sinceParam = latestCreatedAt.current
          ? '?since=' + encodeURIComponent(latestCreatedAt.current)
          : '?page=0';
        const historyParam = historyRef.current ? '&history=true' : '';
        const data = await api.get('/api/timeline' + sinceParam + historyParam);
        const visible = postsRef.current;
        const refreshed: Post[] = [];
        for (let i = 0; i < visible.length; i += 100) {
          const result = await api.get('/api/timeline?ids=' + encodeURIComponent(visible.slice(i, i + 100).map(p => p.id).join(',')) + historyParam);
          refreshed.push(...result.posts);
        }
        if (!mountedRef.current || epoch !== epochRef.current) return;
        if (data.themeVersion !== themeVersionRef.current) { void initTimeline(); return; }
        setPosts(prev => mergePosts(refreshed, prev));

        if (data.posts && data.posts.length > 0) {
          const incoming = data.posts as Post[];
          latestCreatedAt.current = incoming[0].created_at;

          const known = new Set(visible.map(p => p.id));
          const ids = new Set(incoming.filter(p => !known.has(p.id)).map(p => p.id));
          setNewPostIds(ids);
          setTimeout(() => setNewPostIds(new Set()), 3000);

          setPosts(prev => {
            return mergePosts(incoming, prev);
          });
        }

        const nc = await api.get('/api/timeline/notifications/unread-count').catch(() => ({ count: 0 }));
        setUnreadCount(nc.count);
      } catch (e) {
        console.error('Poll error:', e);
      } finally {
        pollingRef.current = false;
      }
    }, 30 * 1000);
  };

  useEffect(() => {
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
  }, []);

  // 有名人体験の数字と通知は短い間隔で更新し、反応が増えていく様子を見せる。
  useEffect(() => {
    if (!user) return;
    let busy = false;
    const interval = setInterval(async () => {
      const ids = postsRef.current.filter(post => post.experience_mode === 'celebrity').map(post => post.id).slice(0, 100);
      if (!ids.length || busy) return;
      busy = true;
      const epoch = epochRef.current;
      try {
        const [result, notifications] = await Promise.all([
          api.get('/api/timeline?ids=' + encodeURIComponent(ids.join(','))),
          api.get('/api/timeline/notifications/unread-count'),
        ]);
        if (!mountedRef.current || epoch !== epochRef.current) return;
        setPosts(previous => mergePosts(result.posts, previous));
        setUnreadCount(notifications.count);
      } catch (e) { console.error('Celebrity refresh error:', e); }
      finally { busy = false; }
    }, 5000);
    return () => clearInterval(interval);
  }, [user?.userId]);

  // ─── 無限スクロール ────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || loading || !hasMore) return;
    const oldest = postsRef.current.at(-1);
    if (!oldest) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const epoch = epochRef.current;
      const data = await api.get('/api/timeline?before=' + encodeURIComponent(oldest.created_at) + '&beforeId=' + encodeURIComponent(oldest.id) + (historyRef.current ? '&history=true' : ''));
      if (epoch !== epochRef.current) return;
      const incoming = data.posts as Post[];
      setPosts(prev => {
        const prevIds = new Set(prev.map(p => p.id));
        return [...prev, ...incoming.filter(p => !prevIds.has(p.id))];
      });
      setHasMore(incoming.length === 30);
    } catch (e) {
      console.error('Load more error:', e);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [loading, hasMore]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMore(); },
      { threshold: 0.1 }
    );
    if (bottomRef.current) observer.observe(bottomRef.current);
    return () => observer.disconnect();
  }, [loadMore]);

  // ─── 投稿 ─────────────────────────────────────────────
  const handlePost = async () => {
    if (!postText.trim() || posting) return;
    setPosting(true);
    setPostError('');
    setPostNotice('');
    try {
      const data = await api.post('/api/timeline/post', { content: postText.trim() });
      setPostText('');
      if (data.post) {
        setPosts(prev => [data.post, ...prev]);
        // 自分の投稿で差分取得カーソルを進めると、直前のAI投稿を取り逃す。
      }
      if (data.scheduled?.directReply) {
        setPostNotice(`AI住人への返信依頼を受け付けました。${data.scheduled.replyWithinMinutes || 3}分ほどで反応します。`);
      }
    } catch (e: unknown) {
      setPostError(e instanceof Error ? e.message : '投稿に失敗しました');
    } finally {
      setPosting(false);
    }
  };

  const handleLike = async (postId: string): Promise<boolean> => {
    const result = await api.post('/api/timeline/like/' + postId, {});
    return Boolean(result.liked);
  };

  const handleReplySent = async (postId: string) => {
    try {
      const data = await api.get('/api/timeline?ids=' + encodeURIComponent(postId) + (historyRef.current ? '&history=true' : ''));
      setPosts(previous => mergePosts(data.posts, previous));
    } catch (e) { console.error('Reply refresh error:', e); }
  };

  const handleLogout = async (confirmed = false) => {
    if (loggingOut) return;
    if (user?.resetOnLogout && !confirmed) { setConfirmLogout(true); return; }
    setLoggingOut(true);
    try {
      await logout({ resetDemo: Boolean(user?.resetOnLogout) });
      router.replace('/');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'ログアウトできませんでした。もう一度お試しください。');
      setLoggingOut(false);
      setConfirmLogout(false);
    }
  };

  const handleTrendClick = (keyword: string) => {
    const tag = '#' + keyword + ' ';
    setPostText(prev => (prev.endsWith(' ') || prev === '' ? prev + tag : prev + ' ' + tag));
  };

  if (!user) return null;

  return (
    <div style={{ minHeight: '100vh', background: '#000', color: '#e7e9ea', fontFamily: 'system-ui, sans-serif' }}>

      {confirmLogout && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 200 }}>
        <div role="dialog" aria-modal="true" aria-labelledby="demo-logout-title" aria-describedby="demo-logout-description" style={{ width: '100%', maxWidth: 420, background: '#101114', border: '1px solid #536471', borderRadius: 16, padding: 24 }}>
          <h2 id="demo-logout-title" style={{ margin: '0 0 16px', fontSize: 20 }}>今回の体験を消してログアウト</h2>
          <p id="demo-logout-description" style={{ color: '#a6aeb7', lineHeight: 1.8 }}>趣味・モード・投稿・AI住人・会話の記憶を削除します。元には戻せません。次回はログイン後、オンボーディングから始まります。</p>
          <p style={{ color: '#a6aeb7', fontSize: 13 }}>ログイン情報と管理者権限は残ります。</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
            <button autoFocus disabled={loggingOut} onClick={() => setConfirmLogout(false)} style={{ background: 'transparent', border: '1px solid #536471', borderRadius: 20, padding: '10px 16px', color: '#e7e9ea', cursor: 'pointer' }}>キャンセル</button>
            <button disabled={loggingOut} onClick={() => void handleLogout(true)} style={{ background: '#7c3aed', border: 0, borderRadius: 20, padding: '10px 16px', color: '#fff', cursor: 'pointer' }}>{loggingOut ? '終了処理中…' : '体験を消してログアウト'}</button>
          </div>
        </div>
      </div>}

      {/* ヘッダー */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #2f3336',
        padding: '0 16px', height: 52,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.5px' }}>
          Solo<span style={{ color: '#7c6af7' }}>Verse</span>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <HeaderBtn onClick={() => setShowTrend(true)} title="トレンド">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
              <polyline points="17 6 23 6 23 12"/>
            </svg>
          </HeaderBtn>
          <HeaderBtn onClick={() => setShowNotif(true)} title="通知" badge={unreadCount}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </HeaderBtn>
          <HeaderBtn onClick={() => void handleLogout()} title={loggingOut ? '終了処理中…' : 'ログアウト'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </HeaderBtn>
        </div>
      </div>

      {/* メイン */}
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderBottom: '1px solid #2f3336' }}>
          <span style={{ color: '#a6aeb7', fontSize: 13, overflowWrap: 'anywhere' }}>{modeLabel && <small style={{ display: 'block', color: '#a89bd9', marginBottom: 4 }}>{modeLabel}</small>}{theme || 'あなたの世界'}</span>
          <label style={{ color: '#a6aeb7', fontSize: 12, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={historyMode} disabled={loading} onChange={e => { historyRef.current = e.target.checked; setHistoryMode(e.target.checked); void initTimeline(); }} /> 過去の体験も表示
          </label>
        </div>

        {/* 投稿ボックス */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #2f3336' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <Avatar name={user.username} size={40} />
            <div style={{ flex: 1 }}>
              <textarea
                value={postText}
                onChange={e => { setPostText(e.target.value); setPostError(''); }}
                placeholder="いま何してる？"
                maxLength={140} rows={3}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePost(); }}
                style={{
                  width: '100%', background: 'transparent', border: 'none', outline: 'none',
                  color: '#e7e9ea', fontSize: 17, resize: 'none', fontFamily: 'inherit', lineHeight: 1.6,
                }}
              />
              {postError && (
                <p style={{ color: '#e05555', fontSize: 12, margin: '2px 0 4px' }}>{postError}</p>
              )}
              {postNotice && (
                <p role="status" style={{ color: '#8ea1ff', fontSize: 12, margin: '2px 0 4px' }}>{postNotice}</p>
              )}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderTop: '1px solid #2f3336', paddingTop: 10, marginTop: 4,
              }}>
                <span style={{ color: postText.length > 120 ? '#f4212e' : '#71767b', fontSize: 12 }}>
                  {postText.length} / 140
                </span>
                <button
                  onClick={handlePost}
                  disabled={!postText.trim() || posting || postText.length > 140}
                  style={{
                    background: postText.trim() && !posting && postText.length <= 140 ? '#1d9bf0' : '#1d9bf066',
                    color: '#fff', border: 'none', borderRadius: 20,
                    padding: '7px 18px', fontSize: 14, fontWeight: 700,
                    cursor: postText.trim() && !posting ? 'pointer' : 'not-allowed',
                    transition: 'background 0.15s',
                  }}
                >
                  {posting ? '投稿中…' : '投稿'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ローディング */}
        {timelineError && <div role={seedWait ? 'status' : 'alert'} style={{ padding: 16, color: seedWait ? '#a89bd9' : '#ef9999' }}>
          {timelineError}
          {seedWait?.retryAt && <p style={{ fontSize: 13 }}>再試行の目安：{new Date(seedWait.retryAt).toLocaleTimeString('ja-JP')}</p>}
          <button onClick={initTimeline} disabled={loading || (Boolean(seedWait) && !retryReady)}>{seedWait && !retryReady ? '再試行までお待ちください' : '再試行'}</button>
        </div>}
        {loading && (
          <div style={{ padding: 48, textAlign: 'center', color: '#71767b' }}>
            {seeding ? (
              <>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✨</div>
                <div style={{ fontSize: 14 }}>あなたの世界に命を吹き込んでいます…</div>
              </>
            ) : (
              <div style={{ fontSize: 14 }}>読み込み中…</div>
            )}
          </div>
        )}

        {/* 空状態 */}
        {!loading && posts.length === 0 && (
          <div style={{ padding: 56, textAlign: 'center', color: '#71767b' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🌌</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#e7e9ea', marginBottom: 6 }}>
              世界が静まりかえっています
            </div>
            <div style={{ fontSize: 13 }}>最初の投稿をしてみましょう</div>
          </div>
        )}

        {/* 投稿リスト */}
        {posts.map(post => (
          <PostCard
            key={post.id}
            post={post}
            onLike={handleLike}
            onOpenReplies={setReplyTarget}
            highlight={newPostIds.has(post.id)}
          />
        ))}

        {/* 無限スクロール */}
        <div ref={bottomRef} style={{ height: 1 }} />
        {loadingMore && (
          <div style={{ padding: 20, textAlign: 'center', color: '#71767b', fontSize: 13 }}>
            読み込み中…
          </div>
        )}
        {!hasMore && posts.length > 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: '#3a3a3a', fontSize: 12 }}>
            すべての投稿を表示しました
          </div>
        )}
      </div>

      {/* パネル */}
      {replyTarget && (
        <ReplyPanel
          post={replyTarget}
          onClose={() => setReplyTarget(null)}
          currentUser={user}
          onReplySent={() => handleReplySent(replyTarget.id)}
        />
      )}
      {showNotif && (
        <NotificationPanel
          onClose={() => setShowNotif(false)}
          onUnreadCountUpdate={setUnreadCount}
        />
      )}
      {showTrend && (
        <TrendPanel
          onClose={() => setShowTrend(false)}
          onTrendClick={handleTrendClick}
          onWorldRebuilt={async () => { historyRef.current = false; setHistoryMode(false); setReplyTarget(null); setPostText(''); setPostNotice(''); await initTimeline(); }}
        />
      )}
    </div>
  );
}

// ヘッダーアイコンボタン共通コンポーネント
function HeaderBtn({ children, onClick, title, badge }: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick} title={title}
      style={{
        background: 'none', border: 'none', cursor: 'pointer', color: '#71767b',
        padding: 8, borderRadius: '50%', display: 'flex', alignItems: 'center',
        position: 'relative', transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = '#1a1a2e';
        e.currentTarget.style.color = '#e7e9ea';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'none';
        e.currentTarget.style.color = '#71767b';
      }}
    >
      {children}
      {badge != null && badge > 0 && (
        <span style={{
          position: 'absolute', top: 4, right: 4,
          background: '#f91880', borderRadius: '50%',
          minWidth: 16, height: 16, padding: '0 3px',
          fontSize: 10, fontWeight: 700, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}
