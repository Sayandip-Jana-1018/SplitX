import type { Metadata, Viewport } from 'next';
import { Geist, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import AuthProvider from '@/components/providers/AuthProvider';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  weight: ['400', '500', '600'],
  display: 'swap',
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
  icons: [{ rel: 'icon', url: '/icons/icon.svg', type: 'image/svg+xml' }],
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
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
