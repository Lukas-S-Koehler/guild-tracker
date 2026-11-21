'use client';

import { Fragment, useState, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookOpen, Check, Copy, ExternalLink, Info, Lightbulb, AlertTriangle } from 'lucide-react';
import { GUIDE_SECTIONS, GUIDE_SITE_URL, sectionToDiscord, shortTitle, type GuideBlock, type GuideSection } from '@/lib/game-guide';

// Minimal inline markdown: **bold**, *italic*, [label](url), `code`.
function Inline({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={k++} className="text-foreground font-semibold">{m[1]}</strong>);
    else if (m[2]) out.push(<em key={k++}>{m[2]}</em>);
    else if (m[5]) out.push(<code key={k++} className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">{m[5]}</code>);
    else out.push(<GuideLink key={k++} label={m[3]} url={m[4]} />);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function GuideLink({ label, url }: { label: string; url: string }) {
  const external = /^https?:/.test(url);
  return (
    <a
      href={url}
      target={external || url.endsWith('.html') ? '_blank' : undefined}
      rel="noopener noreferrer"
      className="text-primary underline-offset-4 hover:underline inline-flex items-center gap-0.5"
    >
      {label}
      {external && <ExternalLink className="h-3 w-3" />}
    </a>
  );
}

const CALLOUT_STYLE = {
  tip: { icon: Lightbulb, cls: 'border-emerald-500/40 bg-emerald-500/5', iconCls: 'text-emerald-500' },
  warn: { icon: AlertTriangle, cls: 'border-amber-500/40 bg-amber-500/5', iconCls: 'text-amber-500' },
  info: { icon: Info, cls: 'border-sky-500/40 bg-sky-500/5', iconCls: 'text-sky-500' },
} as const;

function Block({ b }: { b: GuideBlock }) {
  switch (b.type) {
    case 'p':
      if (b.text.startsWith('-# '))
        return <p className="text-xs text-muted-foreground"><Inline text={b.text.slice(3)} /></p>;
      return <p className="text-muted-foreground leading-relaxed"><Inline text={b.text} /></p>;
    case 'sub':
      return <h3 className="font-semibold text-foreground pt-2">{b.text}</h3>;
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul';
      return (
        <Tag className={`space-y-1.5 pl-5 text-muted-foreground ${b.ordered ? 'list-decimal' : 'list-disc'} marker:text-primary/70`}>
          {b.items.map((it, i) => (
            <li key={i} className="leading-relaxed pl-1"><Inline text={it} /></li>
          ))}
        </Tag>
      );
    }
    case 'callout': {
      const s = CALLOUT_STYLE[b.tone];
      const Icon = s.icon;
      return (
        <div className={`flex gap-3 rounded-lg border p-3 ${s.cls}`}>
          <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${s.iconCls}`} />
          <div className="space-y-0.5">
            {b.title && <div className="font-semibold text-foreground">{b.title}</div>}
            <div className="text-muted-foreground leading-relaxed"><Inline text={b.text} /></div>
          </div>
        </div>
      );
    }
    case 'table':
      return (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {b.head.map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={`px-3 py-1.5 ${j === 0 ? 'font-medium' : 'text-muted-foreground tabular-nums'}`}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'links':
      return (
        <ul className="space-y-1.5">
          {b.links.map((l) => (
            <li key={l.url} className="flex flex-wrap items-baseline gap-x-2">
              <GuideLink label={l.label} url={l.url} />
              {l.note && <span className="text-xs text-muted-foreground">— {l.note}</span>}
            </li>
          ))}
        </ul>
      );
  }
}

function CopyDiscord({ section }: { section: GuideSection }) {
  const [copied, setCopied] = useState<number | null>(null);
  const messages = sectionToDiscord(section, GUIDE_SITE_URL);
  const copy = async (i: number) => {
    await navigator.clipboard.writeText(messages[i]);
    setCopied(i);
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <div className="flex gap-1 shrink-0">
      {messages.map((_, i) => (
        <Button key={i} variant="outline" size="sm" onClick={() => copy(i)} title="Copy as Discord message">
          {copied === i ? <Check className="h-4 w-4 mr-1 text-emerald-500" /> : <Copy className="h-4 w-4 mr-1" />}
          {messages.length > 1 ? `Discord ${i + 1}/${messages.length}` : 'Discord'}
        </Button>
      ))}
    </div>
  );
}

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BookOpen className="h-6 w-6 text-primary" />
          IdleMMO Guide
        </h1>
        <p className="text-sm text-muted-foreground">
          Goals, typical paths and the stuff people wish they knew earlier.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2">
        {GUIDE_SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-full border px-3 py-1 text-xs hover:bg-muted transition-colors"
          >
            {s.emoji} {shortTitle(s)}
          </a>
        ))}
      </nav>

      {GUIDE_SECTIONS.map((s) => (
        <Card key={s.id} id={s.id} className="scroll-mt-20">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-xl">
                  <span className="mr-2">{s.emoji}</span>
                  {s.title}
                </CardTitle>
                <CardDescription>{s.blurb}</CardDescription>
              </div>
              <CopyDiscord section={s} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {s.blocks.map((b, i) => (
              <Fragment key={i}><Block b={b} /></Fragment>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
