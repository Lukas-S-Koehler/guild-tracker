import { AccessGate } from '@/components/access/AccessGate';

/** My assault: members of the assault guilds only. */
export default function MyAssaultLayout({ children }: { children: React.ReactNode }) {
  return <AccessGate level="assaulter">{children}</AccessGate>;
}
