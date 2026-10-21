const MODES = ['hobby', 'celebrity', 'community'];
const POSITIONS = { hobby: 'empathy', celebrity: 'admired', community: 'community' };
const LABELS = { hobby: '趣味共感モード', celebrity: '有名人体験モード', community: '界隈モード' };
const CONTEXT_LABELS = { hobby: '好きなこと・専門分野', celebrity: 'あなたの役割', community: '体験する界隈' };

function resolveMode(settings = {}) {
  settings ||= {};
  if (MODES.includes(settings.mode)) return settings.mode;
  // Existing observer worlds become community experiences without deleting their data.
  return settings.position === 'admired' ? 'celebrity'
    : ['community', 'observer'].includes(settings.position) ? 'community' : 'hobby';
}
function describeSettings(settings) {
  if (!settings) return null;
  const mode = resolveMode(settings);
  return { ...settings, mode, mode_label: LABELS[mode], context_label: CONTEXT_LABELS[mode] };
}
function readSetup(body, fallback = null) {
  const explicitMode = Object.hasOwn(body, 'mode');
  const legacyPositions = ['empathy', 'admired', 'observer', 'community'];
  if (explicitMode && !MODES.includes(body.mode)) throw new Error('体験モードを選んでください');
  if (!explicitMode && !fallback && !legacyPositions.includes(body.position)) throw new Error('体験モードを選んでください');
  const mode = explicitMode ? body.mode : resolveMode(fallback || body);
  const key = { hobby: 'hobbies', celebrity: 'celebrityRole', community: 'community' }[mode];
  const value = explicitMode ? body[key] : body.interests;
  if (!(typeof value === 'string' || (Array.isArray(value) && value.every(v => typeof v === 'string')))) throw new Error(`${CONTEXT_LABELS[mode]}を入力してください`);
  const interests = (Array.isArray(value) ? value.join(', ') : value).trim();
  if (!interests || interests.length > 300 || !/[\p{L}\p{N}]/u.test(interests)) throw new Error(`${CONTEXT_LABELS[mode]}は文字を含む1〜300字で入力してください`);
  return { mode, position: POSITIONS[mode], interests };
}

function experienceRules(settings) {
  const mode = resolveMode(settings);
  if (mode === 'celebrity') return [
    `ユーザーは「${settings.interests}」という役割の架空の有名人。住人はファン、初見、同業者など異なる距離感で接する`,
    '現実のSNSにありそうな反応の温度差を重視する。全員に共感・称賛・励ましを強制しない',
    '投稿内容を受けて、質問、考察、軽いツッコミ、穏やかな異論も自然に混ぜる。称賛だけで埋めない',
    '役割に関係する話のほか、本人の普通の日常投稿への自然な反応も認める',
    '発表されていない実績・新作・出演・炎上・ファンとの過去の交流を作り上げない。実在の有名人本人を名乗らない',
  ];
  if (mode === 'community') return [
    `「${settings.interests}」の界隈にいる架空の一般利用者として、日常のタイムラインと住人同士の会話を再現する`,
    'ユーザーを会話の中心に固定せず、住人同士の話題、独り言、内輪の短い反応も含める。ユーザーも自然に参加できる',
    '全員に共感・称賛・励ましを強制しない。熱量、知識、解釈、距離感の差や穏やかな異論も認める',
    '界隈の用語や関心を文脈に合わせて使う。全員を極端なステレオタイプや説明口調にしない',
    '実在のツイートを転載せず、実在アカウントを演じない。未確認の開催情報・発表・炎上・噂を事実として作らない',
  ];
  return [
    'ニッチな趣味や専門分野を分かち合う、対等な仲間として接する。ユーザーをスターとして扱わない',
    '気持ちや関心を尊重しつつ、体験の共有、具体策、質問、励ましなど接し方を分ける。全員が同じ共感語で始めない',
    '分からないことを断言せず、専門的な質問には知識の範囲で具体的に答える',
    '意見が違う場合も相手の関心を尊重し、建設的な補足や穏やかな異論にする',
  ];
}
function atmosphereRules(settings) {
  if (resolveMode(settings) === 'hobby') return {
    calm: ['優しく落ち着いたやり取り。否定から入らず、具体的な楽しさや工夫を共有する'],
    active: ['意見や質問を交わして深掘りする。建設的な異論は認め、人格攻撃はしない'],
    village: ['共通の趣味を深掘りする小さなコミュニティ。実際の会話履歴があるときだけ過去の交流に触れる'],
    vent: ['失敗や疲れも率直に話せる。愚痴は必須にせず、感情の温度差を持たせる'],
  }[settings.atmosphere] || ['友好的で具体的なやり取りをする'];
  return {
    calm: ['落ち着いたタイムライン。淡々とした感想や短い質問も含め、褒め合いを必須にしない'],
    active: ['にぎやかなタイムライン。異なる解釈、考察、質問、軽いツッコミを自然に交わす'],
    village: ['常連の空気や距離感を表現する。過去の交流は実際の会話履歴にあるものだけにする'],
    vent: ['率直な本音や不満、解釈の違いも含める。全員を怒らせず、執拗な攻撃や噂の捏造はしない'],
  }[settings.atmosphere] || ['自然な温度差のあるタイムラインにする'];
}
module.exports = { MODES, POSITIONS, LABELS, CONTEXT_LABELS, resolveMode, describeSettings, readSetup, experienceRules, atmosphereRules };
