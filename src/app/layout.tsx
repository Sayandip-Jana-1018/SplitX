import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Playfair_Display } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import AuthProvider from '@/components/providers/AuthProvider';

const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SplitX ~ Smart Expense',
  description:
    'Track group expenses effortlessly. Split bills, settle debts, and never argue about money again. Supports cash + UPI payments.',
  keywords: ['expense splitter', 'trip expenses', 'split bills', 'group payments', 'UPI'],
  authors: [{ name: 'Sayan' }],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SplitX',
  },
  icons: [
    { rel: 'icon', url: '/icons/icon.svg', type: 'image/svg+xml' },
  ],
  openGraph: {
    title: 'SplitX ~ Smart Expense',
    description: 'Track group expenses effortlessly. Split bills, settle debts, and never argue about money again.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0f' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" data-palette="amethyst-haze" suppressHydrationWarning>
      <body className={`${playfairDisplay.variable} ${jetBrainsMono.variable}`}>
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
