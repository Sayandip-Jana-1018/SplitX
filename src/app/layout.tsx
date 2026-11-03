import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { GlassRoot } from '@/components/glass/GlassRoot';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import AuthProvider from '@/components/providers/AuthProvider';
import ServiceWorker from '@/components/providers/ServiceWorker';

/*
 * The fonts ship with the app (./fonts, OFL-1.1, Fontsource's subsets of the
 * variable fonts), so a build never waits on Google Fonts: a download that failed
 * there once failed a release with it. Plus Jakarta Sans keeps its ₹ in the Latin
 * Extended subset, so that is a second family the browser fetches only when a page
 * shows one. A metric-matched fallback in between would answer for the ₹ first.
 */
const jakarta = localFont({
  src: './fonts/plus-jakarta-sans-latin-wght-normal.woff2',
  variable: '--font-jakarta',
  weight: '200 800',
  display: 'swap',
  adjustFontFallback: false,
});

const jakartaExtended = localFont({
  src: './fonts/plus-jakarta-sans-latin-ext-wght-normal.woff2',
  variable: '--font-jakarta-ext',
  weight: '200 800',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
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
 * Runs before first paint: resolves the saved theme (light / dark / system),
 * palette, kind of glass and motion, so the UI never flashes the wrong ones.
 */
const THEME_BOOTSTRAP = `(function(){try{var d=document.documentElement,s=window.localStorage,t=s.getItem('SplitX-theme')||'system',p=s.getItem('SplitX-palette')||'amethyst-haze',g=s.getItem('SplitX-glass')||'liquid',m=s.getItem('SplitX-motion')==='calm'?'calm':'full';if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}d.setAttribute('data-theme',t);d.setAttribute('data-palette',p);d.setAttribute('data-glass-style',g);d.setAttribute('data-motion',m);d.style.colorScheme=t}catch(e){}})();`;

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
      data-glass-style="liquid"
      data-motion="full"
      className={`${jakarta.variable} ${jakartaExtended.variable} ${jetBrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <AuthProvider>
          <ThemeProvider>
            <GlassRoot />
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
