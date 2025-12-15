import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Guild Tracker',
  description: 'Track guild activity, donations, and challenges for IdleMMO',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <div className="min-h-screen flex flex-col">
          <header className="border-b sticky top-0 z-50 bg-background/95 backdrop-blur">
            <div className="container mx-auto px-4">
              <nav className="flex items-center justify-between h-14">
                <Link href="/" className="font-bold text-lg">
                  ⚔️ Guild Tracker
                </Link>
                <div className="flex items-center gap-1 text-sm">
                  <Link href="/" className="px-3 py-2 rounded-md hover:bg-muted transition-colors">
                    Dashboard
                  </Link>
                  <Link href="/activity" className="px-3 py-2 rounded-md hover:bg-muted transition-colors">
                    Activity Log
                  </Link>
                  <Link href="/challenges" className="px-3 py-2 rounded-md hover:bg-muted transition-colors">
                    Challenges
                  </Link>
                  <Link href="/leaderboard" className="px-3 py-2 rounded-md hover:bg-muted transition-colors">
                    Leaderboard
                  </Link>
                  <Link href="/reports" className="px-3 py-2 rounded-md hover:bg-muted transition-colors">
                    Reports
                  </Link>
                </div>
              </nav>
            </div>
          </header>
          <main className="flex-1 container mx-auto px-4 py-6">{children}</main>
          <footer className="border-t py-4 text-center text-sm text-muted-foreground">
            Guild Tracker • Built for IdleMMO
          </footer>
        </div>
      </body>
    </html>
  );
}
