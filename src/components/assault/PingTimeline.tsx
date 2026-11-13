'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, ArrowDown, Trash2, Plus, Send, Eye } from 'lucide-react';

export interface PingStep {
  id: string;
  step_key: string;
  label: string;
  offset_minutes: number;
  enabled: boolean;
  mention_roles: string[];
  message_template: string;
  sort_order: number;
}

export default function PingTimeline({
  steps,
  onCreate,
  onUpdate,
  onDelete,
  onReorder,
  onTest,
  onPreview,
}: {
  steps: PingStep[];
  onCreate: (s: Omit<PingStep, 'id' | 'sort_order'>) => Promise<void>;
  onUpdate: (id: string, patch: Partial<PingStep>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (ids: string[]) => Promise<void>;
  onTest: (id: string) => Promise<void>;
  onPreview: (id: string) => Promise<string>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [newStep, setNewStep] = useState({
    step_key: '',
    label: '',
    offset_minutes: 0,
    enabled: true,
    mention_roles: [] as string[],
    message_template: '',
  });

  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const arr = [...steps];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    await onReorder(arr.map(s => s.id));
  };

  const loadPreview = async (id: string) => {
    const text = await onPreview(id);
    setPreviews(p => ({ ...p, [id]: text }));
  };

  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const expanded = expandedId === s.id;
        return (
          <div key={s.id} className="border rounded">
            <div className="flex items-center gap-2 p-2 bg-muted/30">
              <Badge variant="outline" className="font-mono w-16 justify-center">
                {s.offset_minutes >= 0 ? '+' : ''}{s.offset_minutes}m
              </Badge>
              <span className="font-medium flex-1">{s.label}</span>
              <code className="text-xs text-muted-foreground">{s.step_key}</code>
              <Button size="sm" variant="ghost" onClick={() => move(i, -1)}><ArrowUp className="h-3 w-3" /></Button>
              <Button size="sm" variant="ghost" onClick={() => move(i, 1)}><ArrowDown className="h-3 w-3" /></Button>
              <Button
                size="sm"
                variant={s.enabled ? 'default' : 'secondary'}
                onClick={() => onUpdate(s.id, { enabled: !s.enabled })}
              >
                {s.enabled ? 'On' : 'Off'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setExpandedId(expanded ? null : s.id)}>
                {expanded ? 'Close' : 'Edit'}
              </Button>
            </div>
            {expanded && <StepEditor step={s} onUpdate={onUpdate} onDelete={onDelete} onTest={onTest} onPreview={loadPreview} preview={previews[s.id]} />}
          </div>
        );
      })}

      {!creating && (
        <Button variant="outline" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Step
        </Button>
      )}
      {creating && (
        <div className="border rounded p-3 space-y-2 bg-muted/20">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>Step Key</Label>
              <Input value={newStep.step_key} onChange={e => setNewStep(s => ({ ...s, step_key: e.target.value }))} placeholder="custom_key" />
            </div>
            <div>
              <Label>Label</Label>
              <Input value={newStep.label} onChange={e => setNewStep(s => ({ ...s, label: e.target.value }))} />
            </div>
            <div>
              <Label>Offset (min, negative = before launch)</Label>
              <Input type="number" value={newStep.offset_minutes} onChange={e => setNewStep(s => ({ ...s, offset_minutes: Number(e.target.value) }))} />
            </div>
          </div>
          <div>
            <Label>Mention Role IDs (comma-separated)</Label>
            <Input
              value={newStep.mention_roles.join(',')}
              onChange={e => setNewStep(s => ({ ...s, mention_roles: e.target.value.split(',').map(x => x.trim()).filter(Boolean) }))}
            />
          </div>
          <div>
            <Label>Message Template</Label>
            <Textarea rows={4} value={newStep.message_template} onChange={e => setNewStep(s => ({ ...s, message_template: e.target.value }))} />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={async () => {
                await onCreate(newStep);
                setCreating(false);
                setNewStep({ step_key: '', label: '', offset_minutes: 0, enabled: true, mention_roles: [], message_template: '' });
              }}
            >
              Create
            </Button>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepEditor({
  step,
  onUpdate,
  onDelete,
  onTest,
  onPreview,
  preview,
}: {
  step: PingStep;
  onUpdate: (id: string, patch: Partial<PingStep>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onTest: (id: string) => Promise<void>;
  onPreview: (id: string) => Promise<void>;
  preview?: string;
}) {
  const [draft, setDraft] = useState(step);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await onUpdate(step.id, {
        label: draft.label,
        offset_minutes: draft.offset_minutes,
        mention_roles: draft.mention_roles,
        message_template: draft.message_template,
      });
    } finally { setSaving(false); }
  };

  return (
    <div className="p-3 space-y-2 border-t">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label>Label</Label>
          <Input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} />
        </div>
        <div>
          <Label>Offset (min)</Label>
          <Input type="number" value={draft.offset_minutes} onChange={e => setDraft(d => ({ ...d, offset_minutes: Number(e.target.value) }))} />
        </div>
        <div>
          <Label>Mention Role IDs (comma)</Label>
          <Input
            value={draft.mention_roles.join(',')}
            onChange={e => setDraft(d => ({ ...d, mention_roles: e.target.value.split(',').map(x => x.trim()).filter(Boolean) }))}
          />
        </div>
      </div>
      <div>
        <Label>Message Template</Label>
        <Textarea
          rows={6}
          value={draft.message_template}
          onChange={e => setDraft(d => ({ ...d, message_template: e.target.value }))}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Vars: {'{{member_role}} {{staff_role}} {{guild_name}} {{zone_name}} {{shrine_info}} {{mob_order}} {{launch_timestamp}} {{launch_relative}}'}
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
        <Button size="sm" variant="outline" onClick={() => onPreview(step.id)}><Eye className="h-3 w-3 mr-1" />Preview</Button>
        <Button size="sm" variant="outline" onClick={() => onTest(step.id)}><Send className="h-3 w-3 mr-1" />Send Test Ping</Button>
        <Button size="sm" variant="destructive" onClick={() => onDelete(step.id)}><Trash2 className="h-3 w-3 mr-1" />Delete</Button>
      </div>
      {preview && (
        <div className="border rounded p-2 bg-background">
          <div className="text-xs text-muted-foreground mb-1">Preview:</div>
          <pre className="text-xs whitespace-pre-wrap">{preview}</pre>
        </div>
      )}
    </div>
  );
}
