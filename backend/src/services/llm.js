/**
 * LLMユーティリティ
 */

// 無料枠を使い切った場合に備え、Groq → Gemini → OpenRouter の順で切り替える。
// 各社のモデルIDは変わり得るため、環境変数で順序ごと差し替えられる。
const PROVIDERS = {
  groq: {
    apiKeyEnv: 'GROQ_API_KEY',
    modelsEnv: 'GROQ_MODELS',
    defaultModels: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
    urlEnv: 'GROQ_BASE_URL',
    defaultUrl: 'https://api.groq.com/openai/v1/chat/completions',
    intervalEnv: 'GROQ_REQUEST_INTERVAL_MS',
    defaultIntervalMs: 2500,
  },
  gemini: {
    apiKeyEnv: 'GEMINI_API_KEY',
    modelsEnv: 'GEMINI_MODELS',
    defaultModels: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'],
    urlEnv: 'GEMINI_BASE_URL',
    defaultUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    intervalEnv: 'GEMINI_REQUEST_INTERVAL_MS',
    defaultIntervalMs: 6500,
  },
  openrouter: {
    apiKeyEnv: 'OPENROUTER_API_KEY',
    modelsEnv: 'OPENROUTER_MODELS',
    defaultModels: ['openrouter/free'],
    urlEnv: 'OPENROUTER_BASE_URL',
    defaultUrl: 'https://openrouter.ai/api/v1/chat/completions',
    intervalEnv: 'OPENROUTER_REQUEST_INTERVAL_MS',
    defaultIntervalMs: 3500,
  },
};

function splitList(value) {
  return [...new Set(String(value || '').split(',').map(item => item.trim()).filter(Boolean))];
}

function getProviderOrder() {
  const requested = splitList(process.env.LLM_PROVIDER_ORDER || 'groq,gemini,openrouter');
  return requested.filter(name => Object.hasOwn(PROVIDERS, name));
}

function getProviderModels(providerName) {
  const provider = PROVIDERS[providerName];
  const configured = splitList(process.env[provider.modelsEnv]);
  return configured.length ? configured : provider.defaultModels;
}

function getTargets() {
  return getProviderOrder().flatMap(providerName => {
    const provider = PROVIDERS[providerName];
    const apiKey = process.env[provider.apiKeyEnv]?.trim();
    if (!apiKey) return [];
    return getProviderModels(providerName).map(model => ({ providerName, provider, apiKey, model }));
  });
}

function getModels() {
  return getTargets().map(target => `${target.providerName}:${target.model}`);
}

function readMilliseconds(envName, fallback, minimum = 0) {
  const raw = process.env[envName];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

// 無料枠のRPM制限を避けるため、プロバイダーごとに送信キューを共有する。
const pacers = new Map();
function getRequestInterval(target) {
  if (process.env.LLM_REQUEST_INTERVAL_MS != null) {
    return readMilliseconds('LLM_REQUEST_INTERVAL_MS', target.provider.defaultIntervalMs);
  }
  return readMilliseconds(target.provider.intervalEnv, target.provider.defaultIntervalMs);
}

function pacedFetch(target, url, opts) {
  const state = pacers.get(target.providerName) || { chain: Promise.resolve(), lastRequestAt: 0 };
  const signal = opts.signal;
  const run = state.chain.then(async () => {
    signal.throwIfAborted();
    const waitMs = Math.max(0, getRequestInterval(target) - (Date.now() - state.lastRequestAt));
    if (waitMs > 0) await require('node:timers/promises').setTimeout(waitMs, undefined, { signal });
    signal.throwIfAborted();
    if (isCoolingDown(target)) throw new Error('モデルはクールダウン中です');
    state.lastRequestAt = Date.now();
    return fetch(url, opts);
  });
  state.chain = run.then(() => undefined, () => undefined);
  pacers.set(target.providerName, state);
  // 先行リクエストの完了待ちもタイムアウトに含める。期限切れのキュー項目は送信しない。
  return new Promise((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    run.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// 失敗したモデルを短時間休ませ、バックグラウンドジョブが同じ上限を連打しないようにする。
const cooldowns = new Map();
const targetKey = target => `${target.providerName}:${target.model}`;
const providerKey = target => `${target.providerName}:*`;

function isCoolingDown(target) {
  const now = Date.now();
  return Math.max(cooldowns.get(targetKey(target)) || 0, cooldowns.get(providerKey(target)) || 0) > now;
}

function setCooldown(target, durationMs, providerWide = false) {
  const key = providerWide ? providerKey(target) : targetKey(target);
  cooldowns.set(key, Date.now() + Math.max(1000, durationMs));
}

function retryAfterMs(response) {
  const raw = response.headers.get('retry-after');
  if (!raw) return readMilliseconds('LLM_RATE_LIMIT_COOLDOWN_MS', 60000, 1000);
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(1000, date - Date.now()) : 60000;
}

function buildProviderRequest(target, messages, maxTokens, signal) {
  const url = process.env[target.provider.urlEnv] || target.provider.defaultUrl;
  const headers = {
    Authorization: `Bearer ${target.apiKey}`,
    'Content-Type': 'application/json',
  };
  const body = { model: target.model, messages };

  if (target.providerName === 'groq') {
    body.max_completion_tokens = maxTokens;
    if (/^openai\/gpt-oss-/.test(target.model)) {
      body.reasoning_effort = 'low';
      body.include_reasoning = false;
      // 推論と最終本文で共通の上限。短いSNS本文にも推論用の余裕が必要。
      body.max_completion_tokens = Math.max(1024, maxTokens + 512);
    }
    if (/^qwen\/qwen3\.[68]-27b$/.test(target.model)) body.reasoning_effort = 'none';
  } else {
    body.max_tokens = maxTokens;
  }

  if (target.providerName === 'openrouter') {
    headers['HTTP-Referer'] = process.env.APP_URL || 'http://localhost:3000';
    headers['X-Title'] = 'Soloverse';
    body.reasoning = { exclude: true };
  }

  return { url, options: { method: 'POST', headers, signal, body: JSON.stringify(body) } };
}

function responseContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => typeof part === 'string' ? part : (part?.text || '')).join('');
}

function responseError(data, status) {
  if (typeof data?.error === 'string') return data.error;
  return data?.error?.message || data?.message || `HTTP ${status}`;
}

async function callLLM(system, user, maxTokens = 1000) {
  const targets = getTargets();
  if (!targets.length) throw new Error('LLM APIキーが設定されていません。backend/.env を確認してください');

  // 呼び出し元のプロンプトに「JSON」という指示語が含まれるかどうかで、
  // JSON出力を期待している呼び出しかどうかを自動判定する(呼び出し側の
  // シグネチャを変更せずに済むようにするための簡易ヒューリスティック)。
  const expectJSON = /json/i.test(user);

  let lastError = null;
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  const requestTimeoutMs = readMilliseconds('LLM_REQUEST_TIMEOUT_MS', 45000, 1000);
  const totalTimeoutMs = readMilliseconds('LLM_TOTAL_TIMEOUT_MS', 120000, 1000);
  const deadline = Date.now() + totalTimeoutMs;
  const blockedProviders = new Set();

  for (const target of targets) {
    if (blockedProviders.has(target.providerName) || isCoolingDown(target)) continue;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      lastError = new Error(`全体タイムアウト（${totalTimeoutMs / 1000}秒）`);
      break;
    }

    const controller = new AbortController();
    const timeoutMs = Math.min(requestTimeoutMs, remainingMs);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const request = buildProviderRequest(target, messages, maxTokens, controller.signal);
      const response = await pacedFetch(target, request.url, request.options);
      const responseText = await response.text();
      let data;
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch (_) {
        if (response.ok) throw new Error(`不正なAPI応答 (HTTP ${response.status})`);
        data = {}; // HTMLのエラーでもHTTPステータスに基づいて休止する
      }
      if (!response.ok) {
        const status = response.status;
        const msg = responseError(data, status);
        const label = `${target.providerName}/${target.model}`;
        if (status === 429) {
          const providerWide = target.providerName === 'openrouter';
          setCooldown(target, retryAfterMs(response), providerWide);
          if (providerWide) blockedProviders.add(target.providerName);
          console.warn(`[LLM] ${label} -> 429 レート制限または日次上限: ${msg}`);
        } else if (status === 401 || status === 403) {
          setCooldown(target, 5 * 60 * 1000, true);
          blockedProviders.add(target.providerName);
          console.warn(`[LLM] ${label} -> ${status} APIキーまたは権限エラー: ${msg}`);
        } else {
          setCooldown(target, status >= 500 ? 15000 : 5 * 60 * 1000);
          console.warn(`[LLM] ${label} -> ${status}: ${msg}`);
        }
        lastError = new Error(`${label}: ${msg}`);
        continue;
      }
      const rawContent = responseContent(data);
      const cleaned = stripReasoningArtifacts(rawContent);

      // 思考過程の漏れ、またはJSON期待なのにJSONらしき構造が全く無い場合は
      // このモデルの応答を「失敗」扱いにして次のモデルにフォールバックする。
      // 以前はここでそのまま return していたため、思考過程の文章がそのまま
      // 投稿・リプライとしてDBに保存されてしまう事故が起きていた。
      const finishReason = data.choices?.[0]?.finish_reason;
      let parsedJSON;
      if (expectJSON) {
        try { parsedJSON = JSON.parse(cleaned.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim()); } catch (_) {}
      }
      const invalidReason = !cleaned ? '空応答'
        : finishReason === 'length' ? '出力上限による途中切れ'
        : expectJSON && (!parsedJSON || typeof parsedJSON !== 'object') ? 'JSON形式エラー'
        : looksLikeReasoningLeak(cleaned) ? '思考過程の混入' : null;
      if (invalidReason) {
        setCooldown(target, readMilliseconds('LLM_INVALID_OUTPUT_COOLDOWN_MS', 300000, 1000));
        console.warn(`[LLM] ${target.providerName}/${target.model}: ${invalidReason}; finish_reason=${finishReason || 'unknown'}, completion_tokens=${data.usage?.completion_tokens ?? 'unknown'}。次へ切り替えます`);
        lastError = new Error(`${target.providerName}/${target.model}: ${invalidReason}`);
        continue;
      }

      cooldowns.delete(targetKey(target));
      console.log(`[LLM] provider: ${target.providerName}, requested: ${target.model}, used: ${data.model || target.model}`);
      return cleaned;
    } catch (e) {
      const message = e.name === 'AbortError'
        ? `リクエストが${timeoutMs / 1000}秒でタイムアウトしました`
        : e.message;
      setCooldown(target, 15000);
      blockedProviders.add(target.providerName);
      console.warn(`[LLM] ${target.providerName}/${target.model} fetch error:`, message);
      lastError = new Error(`${target.providerName}/${target.model}: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`LLM呼び出しに失敗しました: ${lastError?.message || '全モデルが休止中です。しばらく待って再試行してください'}`);
}

/**
 * 推論モデルの「思考過程」がcontentに紛れ込んだ場合の保険的なサニタイズ。
 * reasoning:excludeを指定していても、一部の無料プロバイダ経由だと
 * 「The user wants me to write...」のような前置きがそのまま返ってくることがある。
 * 明確な思考過程パターンを検出したら、それらしき行を取り除く。
 */
function stripReasoningArtifacts(raw) {
  if (!raw) return raw;
  let text = raw.trim();

  // JSON配列/オブジェクトの出力が期待される呼び出し元では
  // そのままJSON.parseされるため、先頭が { か [ ならここでは何もしない
  if (text.startsWith('{') || text.startsWith('[')) return text;

  const thinkingPatterns = [
    /^the user (wants|is asking|wants me to)[\s\S]*?(?:\n\n|$)/i,
    /^we need to[\s\S]*?(?:\n\n|$)/i,
    /^i need to[\s\S]*?(?:\n\n|$)/i,
    /^i'll (write|craft|create|produce|need)[\s\S]*?(?:\n\n|$)/i,
    /^let'?s? (write|craft|make|produce|think)[\s\S]*?(?:\n\n|$)/i,
    /^let me[\s\S]*?(?:\n\n|$)/i,
    /^okay,?\s*(so|i)[\s\S]*?(?:\n\n|$)/i,
    /^constraints?:[\s\S]*?(?:\n\n|$)/i,
    /^<think>[\s\S]*?<\/think>/i,
  ];

  for (const pattern of thinkingPatterns) {
    if (pattern.test(text)) {
      console.warn('[LLM] 思考過程の前置きを除去しました');
      text = text.replace(pattern, '').trim();
    }
  }

  // 除去した結果、本文が「」や行末の短い文だけになるケースに対応:
  // 最後の改行ブロック(実際の投稿文である可能性が高い)を優先的に使う
  // 正常な複数段落・コードフェンス付きJSONを切り捨てない。

  return text;
}

/**
 * strip後もなお「思考過程っぽい」テキストが残っていないかを判定する。
 * これに該当する場合、callLLM側で結果を捨てて次のモデルにフォールバックする。
 */
function looksLikeReasoningLeak(text) {
  if (!text) return true;

  // JSON配列/オブジェクトはここでは判定しない(呼び出し元でパース検証する)
  if (text.startsWith('{') || text.startsWith('[')) return false;

  // 典型的な思考過程の書き出し(strip後もなお残っている場合)
  if (/^(the user|i need to|let me|okay,?\s*(so|i)|constraints?:|we need to|i'll (write|craft|create|produce|need)|let'?s? (write|craft|make|produce|think))/i.test(text)) {
    return true;
  }

  // 「あ(1)」「の(2)」のように文字数を1文字ずつ数えている典型パターン
  const countMarkers = text.match(/\([0-9]{1,3}\)/g);
  if (countMarkers && countMarkers.length >= 3) return true;

  // 日本語の投稿を期待しているのに、英字の比率が異常に高い
  // (説明文・メタ発言が混入している可能性が高い)
  const nonSpaceChars = text.replace(/\s/g, '');
  if (nonSpaceChars.length > 20) {
    const latinChars = (text.match(/[A-Za-z]/g) || []).length;
    if (latinChars / nonSpaceChars.length > 0.5) return true;
  }

  return false;
}

/**
 * 途中で切れたJSONを可能な限り回復してパースする
 * LLMがmax_tokensで切断されたとき用
 */
function safeParseJSON(raw) {
  if (typeof raw !== 'string') return null;
  const clean = raw.replace(/```json|```/gi, '').trim();

  // ① そのままパース
  try { return JSON.parse(clean); } catch (_) {}

  // ② 配列を抽出してパース
  const arrMatch = clean.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch (_) {}
  }

  // ③ 途中で切れた配列を修復して再試行（閉じ括弧がない場合も対象）
  const arrayStart = clean.indexOf('[');
  if (arrayStart !== -1) {
    const partial = clean.slice(arrayStart);
    // 最後の } の位置を見つけて ] で閉じる
    const lastClose = partial.lastIndexOf('}');
    if (lastClose !== -1) {
      const repaired = partial.slice(0, lastClose + 1) + ']';
      try {
        const result = JSON.parse(repaired);
        console.warn('[LLM] JSON repaired: recovered', result.length, 'items');
        return result;
      } catch (_) {}
    }
  }

  // ④ 個別オブジェクトを1件ずつ拾う
  const items = [];
  const objMatches = clean.matchAll(/\{[^{}]*\}/g);
  for (const m of objMatches) {
    try {
      const obj = JSON.parse(m[0]);
      items.push(obj);
    } catch (_) {}
  }
  if (items.length > 0) {
    console.warn('[LLM] JSON partially recovered:', items.length, 'items via regex');
    return items;
  }

  return null; // 完全に失敗
}

/**
 * 世界設定から共通systemプロンプトを生成
 */
function buildWorldSystemPrompt(settings, characterInfo = null, extraRules = []) {
  const exclusions = (settings.exclusions || '').split(',').filter(Boolean);

  const atmosphereRules = {
    calm: [
      '常に明るく優しいトーンで話す',
      '相手の良いところを見つけて褒める',
      '否定・批判・反論は絶対にしない',
      '共感の言葉(「わかる!」「いいね!」「素敵!」)を積極的に使う',
    ],
    active: [
      '意見をはっきり述べる(攻撃的にはならない)',
      '「それってどういう意味?」「自分はこう思う」と議論を楽しむ',
      '知的好奇心を示す質問や考察を投稿する',
      '建設的な議論はOK、人格攻撃はNG',
    ],
    village: [
      '「またね」「久しぶり!」「最近どう?」など常連感のある言葉を使う',
      '他のキャラクターの名前を出して絡む(「@○○ それ前も言ってたよね!」)',
      '小さなコミュニティの温かさを大切にする',
      '新しい話題より、共通の趣味の深掘りをする',
    ],
    vent: [
      '愚痴・疲れた・もう限界、などの感情吐き出しOK',
      '相手の愚痴には「わかる〜辛いね」「それは無理だわ」と共感する',
      '感情を率直に表現する(ただし犯罪・暴力はNG)',
      'テンションが高かったり低かったりしていい',
      '愚痴は許容されるだけで必須ではない。全員が絶望・疲労を口にしない',
    ],
  }[settings.atmosphere] || ['常に友好的で建設的な投稿をする'];

  const positionRules = {
    empathy: [
      'ユーザーの投稿には必ず共感の言葉で反応する',
      '「わかる」「自分もそう思う」「大丈夫?」と寄り添う',
      'ユーザーをスターとして扱わない・対等な友人として接する',
    ],
    admired: [
      'ユーザーの投稿には興奮・称賛・羨望で反応する',
      '「すごい!」「さすがです!」「真似したい!」と持ち上げる',
      'ユーザーをインフルエンサー・憧れの存在として尊敬する',
      'リプライは熱量高めで、ファンらしい口調にする',
    ],
    observer: [
      'ユーザーの投稿には控えめに反応する(毎回ではない)',
      '反応は控えめ。ただし質問を受けたら相槌だけで済ませず、具体的に答える',
      '自分たちのコミュニティの話題で盛り上がることが多い',
    ],
  }[settings.position] || [];

  const hardBans = [
    '【絶対禁止】違法行為・ハッキング・不正アクセス・犯罪・薬物の話題',
    '【絶対禁止】暴力・脅迫・差別・ヘイトスピーチ',
  ];
  if (exclusions.includes('no_criticism'))  hardBans.push('【絶対禁止】批判・否定・悪口・皮肉・嫌み');
  if (exclusions.includes('no_politics'))   hardBans.push('【絶対禁止】政治・選挙・炎上・社会問題の話題');
  if (exclusions.includes('no_comparison')) hardBans.push('【絶対禁止】他者との比較・マウンティング・自慢');

  const charSection = characterInfo
    ? `\n【あなたのキャラクター情報】\n名前: ${characterInfo.name}(@${characterInfo.username})\n性格: ${characterInfo.personality}\n興味: ${characterInfo.interests}\n返信スタイル: ${characterInfo.reply_style}\n`
    : '';

  // 思考モデル(gpt-oss, Nemotron等)が「The user wants...」のような
  // 思考過程やタスクの復唱、文字数を1文字ずつ数える行為をそのまま
  // 出力してしまう事故が多発したため、全プロンプト共通で明示的に禁止する。
  const outputFormatRules = [
    '思考過程・下書き・自己解説は出力しない。指定されたJSONまたは本文だけを出力する',
    '「The user wants」「〜を生成します」等のタスクの復唱・前置きは書かない',
    '文字数を1文字ずつ数える行為(例:「あ(1) い(2)」)はしない。文字数指定は目安として守るだけでよい',
    '本文は自然な日本語。JSONキー、ユーザー名、作品の正式名称は英字でもよい',
    '質問には先に結論を答え、具体的な理由を一つ添える。曖昧なら短く確認する',
    '同じ茶・コーヒー・天気の話や抽象的な比喩を繰り返さない。具体的な場面・体験・好みを一つ述べる',
    '返信先が指定されたら、その投稿の内容に直接答える。無関係な話題へ逸らさない',
    '興味・関心にロールプレイやなりきりが明示されていなければ、作品を楽しむファンとして会話する。作品世界の出来事を自分の現実の体験として語らない',
    '既存の表示名は維持する。新しく作る人物の名前・ユーザー名・経歴に、原作人物・地名・組織・アイテム名やそのもじりを使わない',
    '作品テーマの悪い例:「宇宙船で旅をしている」「魔法学校へ通っている」。良い例:「宇宙船の登場シーンを映画館で観た」「魔法学校の設定を考察している」',
  ];

  return `あなたはSNS「SoloVerse」のAIキャラクターです。
${charSection}
【テーマ・趣味(必ずこれに関連した内容を投稿する)】
${settings.interests}

【コミュニティの雰囲気(必ず守る行動ルール)】
${atmosphereRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

【ユーザーへの接し方(必ず守る)】
${positionRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}

【絶対禁止事項(いかなる場合も違反しない)】
${hardBans.map((r, i) => `${i + 1}. ${r}`).join('\n')}

【出力形式のルール(最重要・必ず守る)】
${outputFormatRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}
${extraRules.length > 0 ? '\n【追加ルール】\n' + extraRules.map((r, i) => `${i + 1}. ${r}`).join('\n') : ''}`;
}

module.exports = {
  callLLM,
  buildWorldSystemPrompt,
  safeParseJSON,
  // テストおよびヘルスチェック用。APIキー自体は返さない。
  getModels,
  isLLMConfigured: () => getTargets().length > 0,
};
