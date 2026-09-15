const { v4: uuidv4 } = require('uuid');
const { callLLM, buildWorldSystemPrompt, safeParseJSON } = require('./llm');

function resolveFollowerScale(position) {
  return { empathy: 'mid', admired: 'large', observer: 'small' }[position] || 'mid';
}

async function generateAICharacters({ position, interests, atmosphere, exclusions, userId }) {
  const followerScale = resolveFollowerScale(position);
  const exclusionArr = Array.isArray(exclusions) ? exclusions : [];

  const mockSettings = {
    position, interests, atmosphere,
    exclusions: exclusionArr.join(','),
    follower_scale: followerScale,
  };

  const system = buildWorldSystemPrompt(mockSettings, null, [
    '違反キャラ（ハッカー・犯罪者・批判的な人物）は生成しない',
    'キャラクターの性格・口調はコミュニティの雰囲気に完全に合わせる',
    'テーマに強い関心を持つ、現実世界の一般的なSNS利用者として設定する',
    '名前・ユーザー名・経歴を作品やテーマの固有名詞から作らない',
  ]);

  const positionDesc = {
    empathy:  'ユーザーと対等な友人として共感し合える仲間',
    admired:  'ユーザーをインフルエンサーとして尊敬するファン',
    observer: 'ユーザーを遠くから静かに見守るコミュニティメンバー',
  }[position] || '友好的なフォロワー';

  // 一度に10人生成するとmax_tokensを超えやすいので5人×2回に分割
  const allCharacters = [];

  for (let batch = 0; batch < 2; batch++) {
    const raw = await callLLM(
      system,
      `上記の世界設定に完全に従い、SNSフォロワーとなるAIキャラクターを5人生成してください。

【キャラクターの役割】
${positionDesc}

【生成ルール】
- テーマ「${interests}」に強い関心を持つ人物
- 年齢・性格・口調はバラバラにして多様性を持たせる
- reaction_frequency: high/mid/low のいずれか
- delay_profile: fast/normal/slow のいずれか
- reply_style: 具体的な返信傾向（例: 「絵文字多めで共感」「短く鋭いツッコミ」「質問で掘り下げる」）
- personalityには雰囲気（${atmosphere}）を反映させる
- 各人物に得意分野・好きな作品や場面・現実の日常の過ごし方を一つずつ持たせ、personalityとbioへ具体的に記載する
- 全員を同じ口調・年齢・感情にしない
- 表示名・username・bioはテーマと無関係な現実の人物として自然にする。原作人物・地名・組織・アイテム名、そのもじり、合成名は使わない
- 作品テーマでも、その世界の住人や登場人物として設定しない。あくまで作品を観る・読む・遊ぶファンにする
- 悪い例: JediJin / TatooineTomo / Kira Skywalker / 「銀河の酒場で暮らす」
- 良い例: ミナ / haru_27 / 佐藤ユウ / 「映画鑑賞とカフェ巡りが趣味」
${allCharacters.length ? `- 既に作った人物と重複しない: ${allCharacters.map(c => `${c.name}(@${c.username})`).join(', ')}` : ''}

必ずJSON配列のみを出力してください（説明文・\`\`\`・前置き・後書き一切不要）:
[{"name":"表示名","username":"英数字のみ","avatar_seed":"英単語","bio":"30字以内","personality":"一言","interests":"カンマ区切り","reply_style":"具体的な傾向","reaction_frequency":"high/mid/low","delay_profile":"fast/normal/slow"}]`,
      2000
    );

    const parsed = safeParseJSON(raw) || [];
    if (!parsed.length) {
      console.warn(`[worldGenerator] batch ${batch + 1} JSON parse failed, skipping`);
      continue;
    }

    allCharacters.push(...parsed);
  }

  if (allCharacters.length === 0) {
    throw new Error('キャラクター生成に失敗しました（全バッチでJSONパース不可）');
  }

  // LLM出力をそのままDBへ入れず、型・長さ・ユーザー名重複を正規化する。
  const seenUsernames = new Set();
  const normalized = [];
  for (const [index, rawCharacter] of allCharacters.slice(0, 10).entries()) {
    if (!rawCharacter || typeof rawCharacter !== 'object') continue;
    const c = rawCharacter;
    let username = String(c.username || `user_${index + 1}`)
      .replace(/^@/, '')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .slice(0, 24) || `user_${index + 1}`;
    const base = username;
    let suffix = 2;
    while (seenUsernames.has(username.toLowerCase())) {
      username = `${base.slice(0, 20)}_${suffix++}`;
    }
    seenUsernames.add(username.toLowerCase());

    normalized.push({
      id: uuidv4(),
      user_id: userId,
      name: String(c.name || '名無しユーザー').slice(0, 40),
      username,
      avatar_seed: String(c.avatar_seed || 'default').slice(0, 40),
      bio: String(c.bio || '').slice(0, 100),
      personality: String(c.personality || '明るい').slice(0, 100),
      interests: String(c.interests || interests).slice(0, 300),
      reply_style: String(c.reply_style || '共感・励まし').slice(0, 100),
      reaction_frequency: ['high', 'mid', 'low'].includes(c.reaction_frequency) ? c.reaction_frequency : 'mid',
      delay_profile: ['fast', 'normal', 'slow'].includes(c.delay_profile) ? c.delay_profile : 'normal',
    });
  }

  if (normalized.length < 3) {
    throw new Error('キャラクターを十分に生成できませんでした。もう一度お試しください');
  }
  return normalized;
}

module.exports = { generateAICharacters, resolveFollowerScale };
