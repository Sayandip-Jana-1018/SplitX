import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import AuthProvider from '@/components/providers/AuthProvider';
import ServiceWorker from '@/components/providers/ServiceWorker';

/*
 * Both fonts ship with the app (./fonts, OFL-1.1, Fontsource 5.3.0's Latin
 * subsets of the variable fonts), so a build never waits on Google Fonts: a
 * download that failed there once failed a release with it.
 */
const geist = localFont({
  src: './fonts/geist-latin-wght-normal.woff2',
  variable: '--font-geist',
  weight: '100 900',
  display: 'swap',
});

const jetBrainsMono = localFont({
  src: './fonts/jetbrains-mono-latin-wght-normal.woff2',
  variable: '--font-jetbrains-mono',
  weight: '100 800',
  display: 'swap',
  // Arial's metrics, the default, would make a poor stand-in for a monospace font.
  adjustFontFallback: false,
});

/**
 * Runs before first paint: resolves the saved theme (light / dark / system)
 * and palette so the UI never flashes the wrong colours.
 */
const THEME_BOOTSTRAP = `(function(){try{var d=document.documentElement,s=window.localStorage,t=s.getItem('SplitX-theme')||'system',p=s.getItem('SplitX-palette')||'amethyst-haze';if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}d.setAttribute('data-theme',t);d.setAttribute('data-palette',p);d.style.colorScheme=t}catch(e){}})();`;

export const metadata: Metadata = {
  title: {
    default: 'SplitX — Split expenses. Settle smarter.',
    template: '%s · SplitX',
  },
  description:
    'Shared money, beautifully simple. Track group expenses, see who owes whom in real time and settle up via UPI or cash in a tap.',
  keywords: ['expense splitter', 'split bills', 'group expenses', 'settle up', 'UPI', 'trip expenses'],
  authors: [{ name: 'Sayan' }],
  manifest: '/manifest.json',
  applicationName: 'SplitX',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SplitX',
  },
  // The SVG for browsers that take one, favicon.ico for the rest, and a
  // 180 px PNG for an iPhone's home screen, which otherwise shows a screenshot.
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    title: 'SplitX — Split expenses. Settle smarter.',
    description: 'Shared money, beautifully simple. Track, split and settle group expenses in seconds.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f5f8' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0e' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="dark"
      data-palette="amethyst-haze"
      className={`${geist.variable} ${jetBrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <AuthProvider>
          <ThemeProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
            <ServiceWorker />
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
