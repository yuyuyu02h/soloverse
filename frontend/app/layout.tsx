import './globals.css';
import type { Metadata } from 'next';
import { PreviewBanner } from '../components/PreviewBanner';
import { GenerationActivity } from '../components/GenerationActivity';

export const metadata: Metadata = {
  title: 'SoloVerse',
  description: 'あなただけの世界',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body><GenerationActivity /><PreviewBanner />{children}</body>
    </html>
  );
}
