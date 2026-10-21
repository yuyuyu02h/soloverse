import Link from 'next/link';
import { SCREEN_PREVIEW } from '../lib/deployment';
import styles from './PreviewBanner.module.css';

export function PreviewBanner() {
  if (!SCREEN_PREVIEW) return null;
  return <aside className={styles.banner} aria-label="画面プレビュー">
    <div><strong>画面プレビュー</strong><span>ログイン・AI生成は準備中です</span></div>
    <nav aria-label="プレビュー画面"><Link href="/">トップ</Link><Link href="/onboarding">3モードを試す</Link><Link href="/admin">管理者画面</Link></nav>
  </aside>;
}
