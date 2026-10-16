import './globals.css';
import type { Metadata } from 'next';
import { PreviewBanner } from '../components/PreviewBanner';

export const metadata: Metadata = {
  title: 'SoloVerse',
  description: 'あなただけの世界',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body><PreviewBanner />{children}</body>
    </html>
  );
}
