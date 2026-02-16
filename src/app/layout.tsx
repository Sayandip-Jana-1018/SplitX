import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata: Metadata = {
  title: 'AutoSplit ~ Smart Expense',
  description:
    'Track group expenses effortlessly. Split bills, settle debts, and never argue about money again. Supports cash + UPI payments.',
  keywords: ['expense splitter', 'trip expenses', 'split bills', 'group payments', 'UPI'],
  authors: [{ name: 'Sayan' }],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'AutoSplit',
  },
  icons: [
    { rel: 'icon', url: '/icons/icon.svg', type: 'image/svg+xml' },
  ],
  openGraph: {
    title: 'AutoSplit ~ Smart Expense',
    description: 'Track group expenses effortlessly. Split bills, settle debts, and never argue about money again.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
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
      <body>
        <ThemeProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </ThemeProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
