'use client';
import { useState } from 'react';
import { api } from '../lib/api';
type Diagnostics = {
  mode: string;
  attempts: { outcome: string; count: number; tokens: number; estimated_count: number }[];
  content: { outcome: string; reason: string; count: number }[];
  pool: { state: string; count: number }[];
};
const reasons: Record<string, string> = { off_topic: '話題との関連が弱い', vague: '具体性が不足', semantic_duplicate: '似た投稿', persona_conflict: '人物設定との矛盾', roleplay: '作品のなりきり', length: '文字数', unknown_resident: '不明な住人', invalid_parent: '返信先が不正', daily_budget: '本日の利用枠を確保中', reply_priority: '返信を優先中', provider_quota: '提供元の枠の回復待ち', provider_unavailable: '生成サービス待ち', provider_cooldown: '生成サービスの一時休止', excess_candidate: '要求数を超えた候補', missing_parent_or_resident: '返信先・住人が見つからない', array_required: 'データ形式', meta_output: '説明文の混入' };
export function ContentStatus() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function refresh() {
    setLoading(true); setError('');
    try { setData(await api.get('/api/timeline/diagnostics')); }
    catch (e) { setError(e instanceof Error ? e.message : '取得できませんでした'); }
    finally { setLoading(false); }
  }
  const count = (outcome: string) => data?.content.filter(r => r.outcome === outcome).reduce((n, r) => n + Number(r.count), 0) || 0;
  return <details style={{ padding: 16, color: '#a6aeb7', fontSize: 12, borderTop: '1px solid #2f3336' }} onToggle={e => { if (e.currentTarget.open && !data && !loading) void refresh(); }}>
    <summary style={{ cursor: 'pointer' }}>世界の動き・生成の状況</summary>
    <button onClick={refresh} disabled={loading} style={{ marginTop: 12, padding: '6px 12px' }}>{loading ? '確認中…' : '更新する'}</button>
    {error && <p role="alert">{error}</p>}
    {data && <div aria-live="polite">
      <p>生成方式：{data.mode === 'legacy' ? '従来方式（計測なし）' : '候補を用意して時間差で投稿'}</p>
      <p>公開待ち：{data.pool.filter(r => r.state === 'pending').reduce((n, r) => n + Number(r.count), 0)}件</p>
      <p>本日の候補 {count('generated')}件 ／ 採用 {count('accepted')}件 ／ 見送り {count('rejected')}件</p>
      <p>AI呼び出し {data.attempts.reduce((n, r) => n + Number(r.count), 0)}回 ／ 利用制限 {data.attempts.filter(r => r.outcome === 'rate_limited').reduce((n, r) => n + Number(r.count), 0)}回</p>
      {data.content.filter(r => r.outcome === 'rejected' || r.outcome === 'deferred').map((r, i) => <p key={i}>{reasons[r.reason] || 'その他の見送り'}：{r.count}件</p>)}
      <p>この世界のみの集計です。本日の集計は日本時間9時に切り替わります。サーバーの停止中は配信も止まります。</p>
    </div>}
  </details>;
}
