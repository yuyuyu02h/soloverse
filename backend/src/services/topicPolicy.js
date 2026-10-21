// World topics and personal hobbies are deliberately separate. No API calls.
function normalize(text) { return String(text || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ''); }
const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
function contains(text, term) {
  const raw = String(text || '').normalize('NFKC').toLowerCase();
  const value = String(term).normalize('NFKC').toLowerCase();
  if (!normalize(value)) return false;
  if (/^[a-z0-9+#. -]+$/.test(value)) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*');
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(raw);
  }
  if (value.length === 1) return [...segmenter.segment(raw)].some(part => part.isWordLike && part.segment === value);
  return normalize(raw).includes(normalize(value));
}
const entities = [
  { names: ['スターウォーズ', 'star wars'], terms: ['スターウォーズ','star wars','ヨーダ','ルーク','アナキン','ダースベイダー','ダース・ベイダー','ジェダイ','シス','ライトセーバー','ミレニアムファルコン','新たなる希望','帝国の逆襲','ジェダイの帰還','ニューホープ','オビワン','アソーカ','レイア','R2-D2','C-3PO'] },
  { names: ['ハリーポッター', 'harry potter'], terms: ['ハリーポッター','harry potter','ホグワーツ','ハーマイオニー','ダンブルドア','スネイプ','クィディッチ','ヴォルデモート'] },
];
const domains = [
  { names: ['V系','ヴィジュアル系','ビジュアル系'], terms: ['V系','ヴィジュアル系','ビジュアル系','バンギャ','ギャ男','本命盤','対盤','セトリ','ヘドバン','逆ダイ','麺被り','ライブハウス','インスト','チェキ','音源','参戦','物販','上手','下手','整番'] },
  { names: ['映画','映画鑑賞','シネマ'], terms: ['映画','鑑賞','シーン','場面','監督','演技','俳優','映像','作品','伏線','スクリーン','ノベライズ'] },
  { names: ['プログラミング','programming','ソフトウェア開発'], terms: ['プログラミング','コード','コーディング','Python','JavaScript','TypeScript','Java','Ruby','Rust','C++','C#','SQL','API','デバッグ','コンパイル','リファクタリング','デプロイ','フロントエンド','バックエンド','アルゴリズム','機械学習','ソフトウェア','スクリプト','IDE'] },
  { names: ['vtuber','バーチャルユーチューバー'], terms: ['VTuber','バーチャルユーチューバー','Live2D','Vライバー','推しの配信','アーカイブ','切り抜き','歌枠','配信枠','配信者','同時視聴','待機所','スパチャ','メン限','耐久配信','雑談枠','コラボ配信','推し活'] },
  { names: ['歴史','日本史','世界史'], terms: ['歴史','古代','中世','近代史','日本史','世界史','戦国','江戸','幕末','明治','ローマ','エジプト','ルネサンス','史料','史跡','城跡','考古','博物館','武将','王朝','年表'] },
  { names: ['音楽'], terms: ['音楽','曲','歌','ライブ','ギター','ピアノ','旋律','アルバム','楽器','作曲','BGM'] },
  { names: ['読書','小説'], terms: ['読書','小説','本','作者','物語','章','文章','文庫','読了'] },
  { names: ['ゲーム'], terms: ['ゲーム','プレイ','攻略','操作','ステージ','ボス','対戦','クエスト'] },
  { names: ['料理'], terms: ['料理','レシピ','食材','味','焼く','煮る','ご飯','カレー','パスタ'] },
  { names: ['イラスト','絵'], terms: ['イラスト','絵','描く','線','色','スケッチ','構図','描画'] },
];
function topicTerms(theme) {
  return [...new Set(String(theme || '').split(/[,、，\n]/).map(s => s.trim()).filter(s => normalize(s)).flatMap(part => {
    const entity = entities.find(group => group.names.some(name => contains(part, name)));
    if (entity) return [part, ...entity.terms];
    const groups = domains.filter(group => group.names.some(name => contains(part, name)));
    return [part, ...groups.flatMap(group => group.terms)];
  }))];
}
function matchesTheme(text, theme) { return topicTerms(theme).some(term => contains(text, term)); }
// Unknown niche subjects cannot be judged by a small, closed keyword dictionary.
// Those candidates still need the existing semantic AI review before publication.
function hasKnownTopic(theme) {
  const parts = String(theme || '').split(/[,、，\n]/).map(s=>s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every(part => [...entities,...domains].some(group=>group.names.some(name=>contains(part,name))));
}
function topicHints(theme) { return topicTerms(theme).slice(0, 32).join('、'); }
module.exports = { matchesTheme, topicHints, normalize, contains, hasKnownTopic };
