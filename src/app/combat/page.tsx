'use client';

import Link from 'next/link';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import CombatClient from './CombatClient';

export default function CombatPage() {
  const { user, loading } = useAuth();
  return (
    <ProtectedRoute requiredRole="MEMBER">
      {!loading && !user ? (
        <div className="container mx-auto max-w-xl py-16">
          <Card>
            <CardContent className="pt-6 space-y-3 text-center">
              <p className="font-semibold">The combat tool is for signed-in guild members.</p>
              <p className="text-sm text-muted-foreground">
                Sign in to pull your stats and pet automatically. The basic calculator is still at{' '}
                <a className="underline" href="/tools/combat-calculator.html">/tools/combat-calculator.html</a>.
              </p>
              <Link href="/login"><Button>Sign in</Button></Link>
            </CardContent>
          </Card>
        </div>
      ) : (
        <CombatClient />
      )}
    </ProtectedRoute>
  );
}
