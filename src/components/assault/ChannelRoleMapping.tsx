'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export interface MappingValue {
  discord_guild_id: string | null;
  announcement_channel_id: string | null;
  member_role_id: string | null;
  staff_role_id: string | null;
}

export default function ChannelRoleMapping({
  value,
  onSave,
}: {
  value: MappingValue;
  onSave: (v: MappingValue) => Promise<void>;
}) {
  const [draft, setDraft] = useState<MappingValue>(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(value), [value]);

  const set = (k: keyof MappingValue, v: string) =>
    setDraft(d => ({ ...d, [k]: v || null }));

  return (
    <div className="space-y-3">
      <div>
        <Label>Discord Guild (Server) ID</Label>
        <Input value={draft.discord_guild_id ?? ''} onChange={e => set('discord_guild_id', e.target.value)} />
      </div>
      <div>
        <Label>Announcement Channel ID</Label>
        <Input value={draft.announcement_channel_id ?? ''} onChange={e => set('announcement_channel_id', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>@Member Role ID</Label>
          <Input value={draft.member_role_id ?? ''} onChange={e => set('member_role_id', e.target.value)} />
        </div>
        <div>
          <Label>@Staff Role ID</Label>
          <Input value={draft.staff_role_id ?? ''} onChange={e => set('staff_role_id', e.target.value)} />
        </div>
      </div>
      <Button
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try { await onSave(draft); } finally { setSaving(false); }
        }}
      >
        {saving ? 'Saving…' : 'Save Mapping'}
      </Button>
    </div>
  );
}
