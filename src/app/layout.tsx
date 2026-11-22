import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';
import AccountBanner from '@/components/AccountBanner';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Guild Tracker',
  description: 'Track guild activity, donations, and challenges for IdleMMO',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
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
            <footer className="border-t py-4 text-center text-sm text-muted-foreground">
              Guild Tracker • Built for IdleMMO
            </footer>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
