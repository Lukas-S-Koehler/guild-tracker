import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import AccountBanner from '@/components/AccountBanner';
import { DreamMark } from '@/components/brand/DreamMark';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: 'Dream Guilds', template: '%s · Dream Guilds' },
  description: 'The Dream Guilds hub for IdleMMO: find your guild, track activity, raids and assaults.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#080d1a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <AuthProvider>
          <div className="min-h-screen flex flex-col overflow-x-clip">
            <Navigation />
            <AccountBanner />
            <main className="flex-1 min-w-0 container mx-auto px-4 py-6">{children}</main>
            <footer className="border-t border-crystal/10 py-5 text-sm text-muted-foreground">
              <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <DreamMark className="h-4 w-4" />
                  <span><span className="text-foreground font-medium">Dream Guilds</span> · IdleMMO guild network</span>
                </span>
                <span className="text-xs">Fan-made, not affiliated with IdleMMO</span>
              </div>
            </footer>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
