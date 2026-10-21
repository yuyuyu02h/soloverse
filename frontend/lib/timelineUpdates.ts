import type { Post } from '../components/PostCard';

type TimelineData = {
  posts: Post[];
  themeVersion: number;
  deltaCursor?: { before: string; beforeId: string } | null;
};

// Drain bounded pages before advancing the newest-post watermark. A failed read
// can safely restart from the same watermark: callers merge posts by their IDs.
export async function getTimelineUpdates(
  get: (path: string) => Promise<TimelineData>, since: string | null, history: boolean,
  isCurrent: () => boolean,
): Promise<TimelineData | null> {
  const base = '/api/timeline' + (since ? '?since=' + encodeURIComponent(since) + '&delta=true' : '?page=0') + (history ? '&history=true' : '');
  let cursor = '';
  let first: TimelineData | undefined;
  const posts: Post[] = [];
  do {
    if (!isCurrent()) return null;
    const data = await get(base + cursor);
    if (!isCurrent()) return null;
    if (first && data.themeVersion !== first.themeVersion) return { ...data, posts: [] };
    first ||= data;
    posts.push(...data.posts);
    cursor = data.deltaCursor ? '&before=' + encodeURIComponent(data.deltaCursor.before) + '&beforeId=' + encodeURIComponent(data.deltaCursor.beforeId) : '';
  } while (cursor);
  return { ...first!, posts, deltaCursor: null };
}
