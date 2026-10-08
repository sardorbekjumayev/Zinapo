import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Zinapo',
  description: 'Zinapo — 0–4-sinf o‘quvchilari uchun monitoringlar.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f1f0f8' },
    { media: '(prefers-color-scheme: dark)', color: '#14121f' },
  ],
};

/**
 * Runs before paint so a dark-mode user never sees a white flash.
 * Kept inline and tiny on purpose.
 */
const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('zn_theme');
    var dark = stored ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
