// Deterministic, no API cost. These are explainable heuristics, not factual verification.
const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
const { matchesTheme, hasKnownTopic } = require('./topicPolicy');
const { resolveMode } = require('./worldModes');
const ignored = new Set(['こと','もの','それ','これ','今日','自分','です','ます','いる','する','ある','ない','好き','思う','私','の','に','は','を','が','で','と','も']);
function normalize(text) { return String(text).normalize('NFKC').toLowerCase().replace(/\s|[\p{P}\p{S}]/gu, ''); }
function words(text) {
  return [...segmenter.segment(String(text).normalize('NFKC').toLowerCase())]
    .filter(s => s.isWordLike && s.segment.length > 1 && !ignored.has(s.segment)).map(s => s.segment);
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
function evaluate(content, { settings, profile, history = [], target = '', question = target, ambient = false, interactive = false, semanticReview = false }) {
  const mode = resolveMode(settings);
  if (typeof content !== 'string' || content.trim().length < (mode === 'hobby' ? 8 : 6) || content.trim().length > 140) return { accepted: false, reason: 'length', scores: {} };
  const text = content.trim();
  const targetWords = words(target).filter(w => w.length >= 2);
  const respondsToTarget = target && (targetWords.some(w => normalize(text).includes(normalize(w)))
    || /(?:おすすめ|好き|選ぶ|向いて|理由|ため|ので|なら|変更可能|変更不可|使い分け)/.test(text));
  // Only a reply can inherit its parent's topic. A hobby never substitutes for the world theme.
  const relevant = resolveMode(settings) === 'celebrity' || matchesTheme(text, settings.interests)
    || Boolean(respondsToTarget && (interactive || matchesTheme(target, settings.interests)));
  const needsSemanticReview = !relevant && semanticReview && (mode === 'community' || !hasKnownTopic(settings.interests));
  const concrete = words(text).length >= (mode === 'hobby' ? 3 : 2) && !/^(わかる|いいね|そうだね|素敵|最高)[!！。\s]*$/.test(text);
  const likes = profile.preferences || [];
  const contradiction = likes.some(w => text.includes(w) && new RegExp(`${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.{0,4}(嫌い|苦手)`).test(text));
  const roleplay = !/なりきり|ロールプレイ/.test(settings.interests) && /宇宙船で旅|光の剣を磨|魔法学校に通|帝国の影に生き/.test(text);
  const repetition = history.reduce((max, h) => Math.max(max, similarity(text, h)), 0);
  const meta = /<think>|思考過程|以下の投稿を生成|as an ai|the user wants/i.test(text);
  const abstract = /星屑の残り香|漆黒の夜|フォースの静けさ|光る目になり/.test(text);
  const quote = text.match(/[「『]([^「」『』\n]{3,100})[」』](?:って|という)?(?:言葉|セリフ|教え|名言|シーン)/);
  const unverifiedQuote = Boolean(quote && !target.includes(quote[1]));
  const fictionalExperience = /スターウォーズ|star\s*wars/i.test(settings.interests)
    && /ライトセーバーを(?:振|使|手)|ミレニアムファルコンのエンジン/.test(text)
    && !/映画|動画|音源|ゲーム|玩具|おもちゃ|模型|コスプレ|VR|展示|イベント/.test(text);
  const unanswered = question && /(?:誰|だれ|どなた)/.test(question)
    && /(?:キャラ|人物|登場人物|推し)/.test(question)
    && !/(?:好きなのは|推しは|選ぶなら|が好き|を選|おすすめは|一番は|^[^。！？\n]{1,20}(?:かな|です|派)[。！、])/.test(text);
  const scores = { relevance: relevant || ambient ? 1 : needsSemanticReview ? 0.5 : 0, specificity: concrete && !unanswered ? 1 : 0, persona: contradiction || roleplay ? 0 : 1, novelty: Number((1 - repetition).toFixed(3)) };
  const reason = meta ? 'meta_output' : roleplay || fictionalExperience ? 'roleplay' : unverifiedQuote ? 'unverified_quote' : contradiction ? 'persona_conflict' : repetition >= 0.72 ? 'semantic_duplicate'
    : !relevant && !ambient && !needsSemanticReview ? 'off_topic' : unanswered ? 'unanswered_question' : !concrete || abstract ? 'vague' : 'accepted';
  return { accepted: reason === 'accepted', reason, scores };
}
module.exports = { evaluate, similarity, words };
