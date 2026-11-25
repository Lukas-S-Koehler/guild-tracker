import { AccessGate } from '@/components/access/AccessGate';

/** Assault pages: rankings + eligibility public, prep for assault guild members, the rest for Dream members. */
export default function AssaultLayout({ children }: { children: React.ReactNode }) {
  return <AccessGate area="assault">{children}</AccessGate>;
}
