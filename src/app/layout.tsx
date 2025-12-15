import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import Navigation from '@/components/Navigation';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Guild Tracker',
  description: 'Track guild activity, donations, and challenges for IdleMMO',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <AuthProvider>
          <div className="min-h-screen flex flex-col">
            <Navigation />
            <main className="flex-1 container mx-auto px-4 py-6">{children}</main>
            <footer className="border-t py-4 text-center text-sm text-muted-foreground">
              Guild Tracker • Built for IdleMMO
            </footer>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
