// Deterministic, no API cost. These are explainable heuristics, not factual verification.
const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
const ignored = new Set(['こと','もの','それ','これ','今日','自分','です','ます','いる','する','ある','ない','好き','思う','私','の','に','は','を','が','で','と','も']);
function normalize(text) { return String(text).normalize('NFKC').toLowerCase().replace(/\s|[\p{P}\p{S}]/gu, ''); }
function words(text) {
  return [...segmenter.segment(String(text).normalize('NFKC').toLowerCase())]
    .filter(s => s.isWordLike && s.segment.length > 1 && !ignored.has(s.segment)).map(s => s.segment);
}
const concepts = [
  ['映画','鑑賞','シーン','場面','監督','演技','俳優','映像','スターウォーズ','starwars','ルーク','アナキン'],
  ['音楽','曲','歌','ライブ','ギター','ピアノ','旋律','アルバム','楽器'],
  ['読書','小説','本','作者','物語','章','文章'],
  ['ゲーム','プレイ','攻略','操作','ステージ','ボス','対戦'],
  ['料理','レシピ','食材','味','焼く','煮る','ご飯'],
  ['イラスト','絵','描く','線','色','スケッチ','構図'],
];
function expand(text) {
  const terms = new Set(words(text));
  for (const group of concepts) if (group.some(w => normalize(text).includes(w))) for (const w of group) terms.add(w);
  return terms;
}
function similarity(a, b) {
  const x = normalize(a), y = normalize(b);
  if (x === y) return 1;
  const grams = s => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
  const gx = grams(x), gy = grams(y);
  const overlap = [...gx].filter(v => gy.has(v)).length;
  const charScore = 2 * overlap / Math.max(1, gx.size + gy.size);
  const wx = new Set(words(a)), wy = new Set(words(b));
  const wordScore = [...wx].filter(w => wy.has(w)).length / Math.max(1, Math.max(wx.size, wy.size));
  return Math.max(charScore, wordScore * 0.9);
}
function evaluate(content, { settings, profile, history = [], target = '', ambient = false }) {
  if (typeof content !== 'string' || content.trim().length < 8 || content.trim().length > 140) return { accepted: false, reason: 'length', scores: {} };
  const text = content.trim();
  const topic = expand([settings.interests, ...(profile.topics || []), target].join(' '));
  const relevant = [...topic].some(w => normalize(text).includes(normalize(w)));
  const concrete = words(text).length >= 3 && !/^(わかる|いいね|そうだね|素敵|最高)[!！。\s]*$/.test(text);
  const likes = profile.preferences || [];
  const contradiction = likes.some(w => text.includes(w) && new RegExp(`${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.{0,4}(嫌い|苦手)`).test(text));
  const roleplay = !/なりきり|ロールプレイ/.test(settings.interests) && /宇宙船で旅|光の剣を磨|魔法学校に通|帝国の影に生き/.test(text);
  const repetition = history.reduce((max, h) => Math.max(max, similarity(text, h)), 0);
  const meta = /<think>|思考過程|以下の投稿を生成|as an ai|the user wants/i.test(text);
  const abstract = /星屑の残り香|漆黒の夜|フォースの静けさ|光る目になり/.test(text);
  const scores = { relevance: relevant || ambient ? 1 : 0, specificity: concrete ? 1 : 0, persona: contradiction || roleplay ? 0 : 1, novelty: Number((1 - repetition).toFixed(3)) };
  const reason = meta ? 'meta_output' : roleplay ? 'roleplay' : contradiction ? 'persona_conflict' : repetition >= 0.72 ? 'semantic_duplicate'
    : !relevant && !ambient ? 'off_topic' : !concrete || abstract ? 'vague' : 'accepted';
  return { accepted: reason === 'accepted', reason, scores };
}
module.exports = { evaluate, similarity, words };
