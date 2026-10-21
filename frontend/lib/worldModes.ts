export type ExperienceMode = 'hobby' | 'celebrity' | 'community';

export const MODE_OPTIONS: { value: ExperienceMode; label: string; desc: string }[] = [
  { value: 'hobby', label: '趣味共感モード', desc: 'ニッチな趣味や専門分野を、話の通じる仲間と分かち合う' },
  { value: 'celebrity', label: '有名人体験モード', desc: '自分の投稿に人が集まる、有名人としてのSNSを体験する' },
  { value: 'community', label: '界隈モード', desc: 'V系やVTuberなど、その界隈らしい会話と空気を味わう' },
];
export const CONTEXT_FIELDS = { hobby: 'hobbies', celebrity: 'celebrityRole', community: 'community' };
export const CONTEXT_LABELS = { hobby: '好きなこと・専門分野', celebrity: 'あなたの役割', community: '体験する界隈' };
export const ROLE_OPTIONS = ['ミュージシャン', '俳優', 'アイドル', 'VTuber', '動画クリエイター', '作家', 'プロゲーマー'];
export const COMMUNITY_OPTIONS = ['V系界隈', 'VTuber界隈', 'ボカロ界隈', '同人・創作界隈', 'ゲーム配信界隈', '地下アイドル界隈'];
export function atmosphereOptions(mode: ExperienceMode | '') {
  if (mode === 'hobby') return [
    { value: 'calm', label: '穏やかに分かち合う', desc: '楽しさや工夫を、落ち着いて話せる場所' },
    { value: 'active', label: '専門的な話も深掘り', desc: '質問や考察、建設的な意見交換を楽しむ' },
    { value: 'village', label: '顔なじみの集まり', desc: '同じ趣味を持つ、小さなコミュニティ' },
    { value: 'vent', label: '本音や悩みも話せる', desc: '失敗やもやもやも分かち合える場所' },
  ];
  return [
    { value: 'calm', label: '落ち着いた空気', desc: '淡々とした感想や短い会話が流れる' },
    { value: 'active', label: 'にぎやかなタイムライン', desc: '考察、ツッコミ、異なる意見も飛び交う' },
    { value: 'village', label: '常連のいる空気', desc: '内輪の会話や、それぞれの距離感を楽しむ' },
    { value: 'vent', label: '本音が出るタイムライン', desc: '熱量の差や、率直な感想・不満もある' },
  ];
}
