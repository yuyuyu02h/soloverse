// ─── アバター ─────────────────────────────────────────────
export function Avatar({ seed, name, size = 40 }: { seed?: string; name: string; size?: number }) {
  const colors = ['#7C3AED','#2563EB','#059669','#DC2626','#D97706','#DB2777','#0891B2','#9333EA'];
  const bg = colors[(seed || name).split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length];
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: size * 0.35, fontWeight: 700, flexShrink: 0,
      fontFamily: 'system-ui',
    }}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

// タイムゾーン対応: DBのUTC時刻末尾に 'Z' を付与してUTCとして解釈
export function timeAgo(dateStr: string) {
  // SQLiteの datetime('now') は末尾にZがないため、明示的にUTCとして扱う
  const normalized = /[zZ]|[+-]\d\d:\d\d$/.test(dateStr) ? dateStr : dateStr.replace(' ', 'T') + 'Z';
  const diff = Date.now() - new Date(normalized).getTime();
  if (!Number.isFinite(diff)) return '日時不明';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

// ハッシュタグ・メンションを色付き表示
export function renderContent(text: string) {
  const parts = text.split(/([@#]\S+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('#')) return <span key={i} style={{ color: '#1d9bf0' }}>{part}</span>;
    if (part.startsWith('@')) return <span key={i} style={{ color: '#7c6af7' }}>{part}</span>;
    return part;
  });
}
