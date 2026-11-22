'use client';

import ProtectedRoute from '@/components/ProtectedRoute';
import WarningsContent from '@/components/warnings/WarningsPanel';

export default function WarningsPage() {
  return (
    <ProtectedRoute requiredRole="MEMBER">
      <WarningsContent />
    </ProtectedRoute>
  );
}
