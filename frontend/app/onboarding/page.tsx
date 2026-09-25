'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getUser, setUser } from '../../lib/api';
import styles from './page.module.css';

type Step = 1 | 2 | 3 | 4 | 'loading';

const INTEREST_TAGS = [
  'アニメ', '漫画', 'ゲーム', '音楽', '映画', '読書', '料理', 'スポーツ',
  '鉄道', 'アウトドア', 'ファッション', 'アート', 'テクノロジー', '写真',
  '旅行', 'ペット', 'DIY', 'フィットネス', '文学', 'SF', 'ホラー', 'VTUBER',
  '声優', 'コスプレ', '同人', 'プログラミング', '歴史', '哲学', '占い',
];

const LOADING_MESSAGES = [
  'あなたの世界の土台を築いています...',
  '住人たちを集めています...',
  'それぞれの個性を磨いています...',
  'タイムラインに命を吹き込んでいます...',
  'もうすぐ、あなただけの世界が始まります...',
];

const POSITION_OPTIONS = [
  { value: 'empathy', label: '共感してほしい', desc: '気持ちをわかってくれる仲間に囲まれたい' },
  { value: 'admired', label: '憧れられたい', desc: '有名人・インフルエンサーとして注目を集めたい' },
  { value: 'observer', label: 'ただ見ていたい', desc: '自分のペースで、静かに世界に溶け込みたい' },
];

const ATMOSPHERE_OPTIONS = [
  { value: 'calm', label: '穏やか・褒め合う', desc: '否定や議論のない、温かい空間' },
  { value: 'active', label: '活発に議論する', desc: '刺激的な意見交換が飛び交う場所' },
  { value: 'village', label: 'みんなが自分を少し知っている', desc: '村的な、ちょうどいい距離感のコミュニティ' },
  { value: 'vent', label: '過激・吐き出し場', desc: '感情をそのままぶつけられる場所' },
];

const EXCLUSION_OPTIONS = [
  { value: 'no_criticism', label: '批判・否定コメント' },
  { value: 'no_politics', label: '政治・炎上系の話題' },
  { value: 'no_comparison', label: '比較・マウンティング' },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [position, setPosition] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customInterest, setCustomInterest] = useState('');
  const [atmosphere, setAtmosphere] = useState('');
  const [exclusions, setExclusions] = useState<string[]>([]);
  const [loadingMsg, setLoadingMsg] = useState(0);
  const [error, setError] = useState('');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  // StrictModeでuseEffectが2回走っても二重送信を防ぐフラグ
  const submittedRef = useRef(false);

  useEffect(() => {
    const token = getToken();
    if (!token) { router.replace('/'); return; }
    api.get('/api/auth/me').then(user => {
      setUser(user);
      if (user.onboardingDone) router.replace('/timeline');
    }).catch(() => {});
  }, [router]);

  useEffect(() => {
    if (step === 'loading') {
      intervalRef.current = setInterval(() => {
        setLoadingMsg(m => (m + 1) % LOADING_MESSAGES.length);
      }, 2200);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [step]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const toggleExclusion = (val: string) => {
    setExclusions(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  };

  const allInterests = [
    ...selectedTags,
    ...(customInterest.trim() ? [customInterest.trim()] : []),
  ].join(', ');

  const submit = async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setStep('loading');
    setError('');
    try {
      await api.post('/api/onboarding/submit', {
        position,
        interests: allInterests,
        atmosphere,
        exclusions,
      });
      const currentUser = getUser();
      if (currentUser) setUser({ ...currentUser, onboardingDone: true });
      setTimeout(() => router.replace('/timeline'), 500);
    } catch (e: unknown) {
      submittedRef.current = false;
      const msg = e instanceof Error ? e.message : '世界の生成に失敗しました';
      setError(msg);
      setStep(4);
    }
  };

  const activeStep = step === 'loading' ? 4 : step;
  const nextDisabled = step === 1 ? !position
    : step === 2 ? selectedTags.length === 0 && !customInterest.trim()
    : step === 3 ? !atmosphere
    : submittedRef.current;

  const advance = () => {
    if (step === 1) setStep(2);
    else if (step === 2) setStep(3);
    else if (step === 3) setStep(4);
    else if (step === 4) void submit();
  };

  return (
    <div className={styles.page}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Syne:wght@700;800&family=Space+Grotesk:wght@400;500&display=swap" rel="stylesheet" />
      <div className={styles.ambient} aria-hidden="true" />

      <header className={styles.header}>
        <div className={styles.brand}>Soloverse <i /></div>
        <div className={styles.headerMeta}><span>CREATE YOUR WORLD</span><b>SETUP</b></div>
      </header>

      <main className={styles.main}>
        <section className={styles.formArea} aria-label="オンボーディング">
          <div className={styles.progressHead}>
            <span>WORLD CONFIGURATION</span>
            <span className={styles.count}>{String(activeStep).padStart(2, '0')} / 04</span>
          </div>
          <div className={styles.progressTrack} role="progressbar" aria-label="オンボーディングの進行状況" aria-valuemin={0} aria-valuemax={4} aria-valuenow={step === 'loading' ? 4 : step - 1}>
            {[0, 1, 2, 3].map(index => (
              <span key={index} className={index < activeStep - 1 ? styles.progressDone : index === activeStep - 1 ? styles.progressActive : ''} />
            ))}
          </div>

          <div className={styles.panel} aria-busy={step === 'loading'}>
            {step === 'loading' ? (
              <div className={styles.loadingPanel} role="status" aria-live="polite">
                <div className={styles.loadingOrb} aria-hidden="true" />
                <h2>あなたの世界を構築しています</h2>
                <p>{LOADING_MESSAGES[loadingMsg]}</p>
              </div>
            ) : (
              <>
                {step === 1 && (
                  <StepContent kicker="01 — YOUR PRESENCE" title="この世界で、あなたはどんな存在になりたいですか？">
                    <div className={styles.choices}>
                      {POSITION_OPTIONS.map(opt => (
                        <ChoiceCard key={opt.value} selected={position === opt.value} onClick={() => setPosition(opt.value)} label={opt.label} desc={opt.desc} />
                      ))}
                    </div>
                  </StepContent>
                )}

                {step === 2 && (
                  <StepContent kicker="02 — YOUR INTERESTS" title="好きなことを教えてください" sub="ニッチなほど、ここではわかってくれる人が多くいます">
                    <div className={styles.tagGrid} aria-label="興味・関心">
                      {INTEREST_TAGS.map(tag => (
                        <button key={tag} type="button" className={styles.tag} aria-pressed={selectedTags.includes(tag)} onClick={() => toggleTag(tag)}>{tag}</button>
                      ))}
                    </div>
                    <label className={styles.customLabel} htmlFor="custom-interest">その他の興味・関心</label>
                    <input id="custom-interest" className={styles.customInput} placeholder="その他（自由記述）" value={customInterest} onChange={event => setCustomInterest(event.target.value)} maxLength={100} />
                  </StepContent>
                )}

                {step === 3 && (
                  <StepContent kicker="03 — YOUR ATMOSPHERE" title="あなたの理想のタイムラインは？">
                    <div className={styles.choices}>
                      {ATMOSPHERE_OPTIONS.map(opt => (
                        <ChoiceCard key={opt.value} selected={atmosphere === opt.value} onClick={() => setAtmosphere(opt.value)} label={opt.label} desc={opt.desc} />
                      ))}
                    </div>
                  </StepContent>
                )}

                {step === 4 && (
                  <StepContent kicker="04 — YOUR BOUNDARIES" title="この世界から消したいものを選んでください" sub="複数選択可・選ばなくてもOK">
                    <div className={styles.choices}>
                      {EXCLUSION_OPTIONS.map(opt => (
                        <ChoiceCard key={opt.value} selected={exclusions.includes(opt.value)} onClick={() => toggleExclusion(opt.value)} label={opt.label} multi />
                      ))}
                    </div>
                    {error && (
                      <div className={styles.error} role="alert">
                        <p>{error}</p>
                        <small>もう一度「世界を生成する」を押してください</small>
                      </div>
                    )}
                  </StepContent>
                )}

                <div className={styles.actions}>
                  {step > 1 && <button type="button" className={styles.back} onClick={() => setStep((step - 1) as Step)}>← 戻る</button>}
                  <button type="button" className={styles.next} disabled={nextDisabled} onClick={advance}>
                    {step === 4 ? '世界を生成する' : '次へ'} <span aria-hidden="true">→</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      </main>

      <footer className={styles.footer}><span>SOLOVERSE PROTOCOL</span><span>© 2026</span></footer>
    </div>
  );
}

function StepContent({ kicker, title, sub, children }: { kicker: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <>
      <span className={styles.panelKicker}>{kicker}</span>
      <h1 className={styles.title}>{title}</h1>
      {sub && <p className={styles.sub}>{sub}</p>}
      {children}
    </>
  );
}

function ChoiceCard({ selected, onClick, label, desc, multi = false }: { selected: boolean; onClick: () => void; label: string; desc?: string; multi?: boolean }) {
  return (
    <button type="button" className={styles.choice} aria-pressed={selected} onClick={onClick}>
      <span><strong>{label}</strong>{desc && <small>{desc}</small>}</span>
      <span className={multi ? styles.multiMark : styles.choiceMark} aria-hidden="true">{selected ? '✓' : ''}</span>
    </button>
  );
}
