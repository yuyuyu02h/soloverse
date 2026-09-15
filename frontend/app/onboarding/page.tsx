'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getUser, setUser } from '../../lib/api';

type Step = 1 | 2 | 3 | 4 | 'loading' | 'done';

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
  }, []);

  useEffect(() => {
    if (step === 'loading') {
      intervalRef.current = setInterval(() => {
        setLoadingMsg(m => (m + 1) % LOADING_MESSAGES.length);
      }, 2200);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [step]);

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const toggleExclusion = (val: string) => {
    setExclusions(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    );
  };

  const allInterests = [
    ...selectedTags,
    ...(customInterest.trim() ? [customInterest.trim()] : []),
  ].join(', ');

  const submit = async () => {
    if (submittedRef.current) return; // 二重送信防止
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
      submittedRef.current = false; // 失敗したらリセットして再試行可能に
      const msg = e instanceof Error ? e.message : '世界の生成に失敗しました';
      setError(msg);
      setStep(4);
    }
  };

  // ─── ローディング画面 ───
  if (step === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1.5rem', animation: 'pulse 2s infinite' }}>🌐</div>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '1rem' }}>
          あなたの世界を構築しています
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', minHeight: '1.4em', transition: 'opacity 0.3s' }}>
          {LOADING_MESSAGES[loadingMsg]}
        </p>
        <div style={{ marginTop: '2rem', display: 'flex', gap: '6px' }}>
          {[0,1,2].map(i => (
            <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)', opacity: loadingMsg % 3 === i ? 1 : 0.3, transition: 'opacity 0.3s' }} />
          ))}
        </div>
        <style>{`@keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1)} }`}</style>
      </div>
    );
  }

  const progress = (typeof step === 'number' ? step - 1 : 4) / 4;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
      {/* プログレスバー */}
      <div style={{ width: '100%', maxWidth: '480px', marginBottom: '2rem' }}>
        <div style={{ height: '3px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progress * 100}%`, background: 'var(--accent)', transition: 'width 0.4s ease', borderRadius: '2px' }} />
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem', textAlign: 'right' }}>
          {typeof step === 'number' ? `${step} / 4` : ''}
        </p>
      </div>

      <div style={{ width: '100%', maxWidth: '480px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '2rem' }}>

        {/* STEP 1 */}
        {step === 1 && (
          <StepWrapper title="この世界で、あなたはどんな存在になりたいですか？">
            {[
              { value: 'empathy', label: '共感してほしい', desc: '気持ちをわかってくれる仲間に囲まれたい' },
              { value: 'admired', label: '憧れられたい', desc: '有名人・インフルエンサーとして注目を集めたい' },
              { value: 'observer', label: 'ただ見ていたい', desc: '自分のペースで、静かに世界に溶け込みたい' },
            ].map(opt => (
              <ChoiceCard key={opt.value} selected={position === opt.value} onClick={() => setPosition(opt.value)} label={opt.label} desc={opt.desc} />
            ))}
            <NextButton disabled={!position} onClick={() => setStep(2)} />
          </StepWrapper>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <StepWrapper title="好きなことを教えてください" sub="ニッチなほど、ここではわかってくれる人が多くいます">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '1rem' }}>
              {INTEREST_TAGS.map(tag => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '20px',
                    border: `1px solid ${selectedTags.includes(tag) ? 'var(--accent)' : 'var(--border)'}`,
                    background: selectedTags.includes(tag) ? 'var(--accent)' : 'var(--surface2)',
                    color: 'var(--text)',
                    fontSize: '0.85rem',
                    transition: 'all 0.15s',
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
            <input
              aria-label="その他の興味・関心"
              placeholder="その他（自由記述）"
              value={customInterest}
              onChange={e => setCustomInterest(e.target.value)}
              maxLength={100}
              style={{ width: '100%', padding: '0.6rem 0.85rem', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', fontSize: '0.9rem', outline: 'none' }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '1.25rem' }}>
              <BackButton onClick={() => setStep(1)} />
              <NextButton disabled={selectedTags.length === 0 && !customInterest.trim()} onClick={() => setStep(3)} flex />
            </div>
          </StepWrapper>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <StepWrapper title="あなたの理想のタイムラインは？">
            {[
              { value: 'calm', label: '穏やか・褒め合う', desc: '否定や議論のない、温かい空間' },
              { value: 'active', label: '活発に議論する', desc: '刺激的な意見交換が飛び交う場所' },
              { value: 'village', label: 'みんなが自分を少し知っている', desc: '村的な、ちょうどいい距離感のコミュニティ' },
              { value: 'vent', label: '過激・吐き出し場', desc: '感情をそのままぶつけられる場所' },
            ].map(opt => (
              <ChoiceCard key={opt.value} selected={atmosphere === opt.value} onClick={() => setAtmosphere(opt.value)} label={opt.label} desc={opt.desc} />
            ))}
            <div style={{ display: 'flex', gap: '8px', marginTop: '0.5rem' }}>
              <BackButton onClick={() => setStep(2)} />
              <NextButton disabled={!atmosphere} onClick={() => setStep(4)} flex />
            </div>
          </StepWrapper>
        )}

        {/* STEP 4 */}
        {step === 4 && (
          <StepWrapper title="この世界から消したいものを選んでください" sub="複数選択可・選ばなくてもOK">
            {[
              { value: 'no_criticism', label: '批判・否定コメント' },
              { value: 'no_politics', label: '政治・炎上系の話題' },
              { value: 'no_comparison', label: '比較・マウンティング' },
            ].map(opt => (
              <button
                key={opt.value}
                onClick={() => toggleExclusion(opt.value)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.75rem 1rem',
                  marginBottom: '0.5rem',
                  background: exclusions.includes(opt.value) ? 'rgba(124,106,247,0.15)' : 'var(--surface2)',
                  border: `1px solid ${exclusions.includes(opt.value) ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius: '8px',
                  color: 'var(--text)',
                  fontSize: '0.95rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ width: '18px', height: '18px', borderRadius: '4px', border: `2px solid ${exclusions.includes(opt.value) ? 'var(--accent)' : 'var(--border)'}`, background: exclusions.includes(opt.value) ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', flexShrink: 0 }}>
                  {exclusions.includes(opt.value) ? '✓' : ''}
                </span>
                {opt.label}
              </button>
            ))}
            {error && (
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: '0.5rem' }}>
                <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: 0 }}>
                  ⚠️ {error}
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '4px 0 0' }}>
                  もう一度「世界を生成する」を押してください
                </p>
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '0.75rem' }}>
              <BackButton onClick={() => setStep(3)} />
              <button
                onClick={submit}
                disabled={submittedRef.current}
                style={{ flex: 1, padding: '0.75rem', background: 'var(--accent)', border: 'none', borderRadius: '8px', color: 'var(--text)', fontSize: '0.95rem', fontWeight: 600 }}
              >
                世界を生成する ✦
              </button>
            </div>
          </StepWrapper>
        )}
      </div>
    </div>
  );
}

function StepWrapper({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 style={{ fontSize: '1.15rem', fontWeight: 700, lineHeight: 1.4, marginBottom: sub ? '0.4rem' : '1.25rem' }}>{title}</h2>
      {sub && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>{sub}</p>}
      {children}
    </div>
  );
}

function ChoiceCard({ selected, onClick, label, desc }: { selected: boolean; onClick: () => void; label: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '0.85rem 1rem',
        marginBottom: '0.6rem',
        background: selected ? 'rgba(124,106,247,0.15)' : 'var(--surface2)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: '10px',
        color: 'var(--text)',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{label}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '2px' }}>{desc}</div>
    </button>
  );
}

function NextButton({ onClick, disabled, flex }: { onClick: () => void; disabled: boolean; flex?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...(flex ? { flex: 1 } : { width: '100%', marginTop: '1.25rem' }),
        padding: '0.75rem',
        background: disabled ? 'var(--surface2)' : 'var(--accent)',
        border: 'none',
        borderRadius: '8px',
        color: disabled ? 'var(--text-muted)' : 'var(--text)',
        fontSize: '0.95rem',
        fontWeight: 600,
        transition: 'background 0.15s',
      }}
    >
      次へ →
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ padding: '0.75rem 1rem', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '0.9rem' }}
    >
      ← 戻る
    </button>
  );
}
