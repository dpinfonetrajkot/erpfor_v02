'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { Bell, CheckCheck, ClipboardList, Megaphone, Search, Send } from 'lucide-react';
import type { z } from 'zod';
import { NOTICE_TARGET_LABELS, NOTICE_TARGETS, noticeSchema, type NoticeInput, type NotificationRow } from '@bht/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { fmtAgo } from '@/lib/format';
import { useZodForm } from '@/lib/forms';
import { showApiError, useApiQuery } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { Checkbox, Label, Switch } from '@/components/ui/primitives';
import { FormDialog } from './form-dialog';
import { SelectField, TextareaField, TextField } from './form';
import { desktopAlertsOn, setDesktopAlerts } from './live-updates';
import { useSession } from './session';

interface NotificationList {
  items: NotificationRow[];
  unread: number;
  hasMore: boolean;
}

/** A small red count on an icon button. */
export function CountBadge({ n, label }: { n: number; label: string }) {
  if (!n) return null;
  return (
    <span aria-label={label} className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white">
      {n > 99 ? '99+' : n}
    </span>
  );
}

/** The bell: my notifications, mark read, desktop alerts, and "Send notice" for those allowed. */
export function NotificationBell() {
  const { can } = useSession();
  const router = useRouter();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [alerts, setAlerts] = useState(false);
  const { data } = useApiQuery<NotificationList>('/notifications');
  useEffect(() => setAlerts(desktopAlertsOn()), []);

  const reload = () => void client.invalidateQueries({ predicate: (q) => q.queryKey[0] === '/notifications' });
  const read = useMutation({ mutationFn: (id: number) => api(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: reload, meta: { skipInvalidate: true } });
  const readAll = useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: reload, meta: { skipInvalidate: true } });
  const unread = data?.unread ?? 0;

  const openItem = (n: NotificationRow) => {
    if (!n.readAt) read.mutate(n.id);
    if (n.link) {
      setOpen(false);
      router.push(n.link);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
            <Bell />
            <CountBadge n={unread} label={`${unread} unread`} />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
          <div className="flex items-center gap-2 border-b px-4 py-2.5">
            <h2 className="flex-1 text-sm font-semibold">Notifications</h2>
            {unread > 0 && (
              <Button variant="ghost" size="sm" onClick={() => readAll.mutate()}>
                <CheckCheck /> Mark all read
              </Button>
            )}
            {can('notifications.create') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  setSending(true);
                }}
              >
                <Send /> Send notice
              </Button>
            )}
          </div>
          <ul className="max-h-[60vh] divide-y overflow-y-auto" aria-label="Notifications">
            {!data?.items.length && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing yet. Work that reaches you and notices from colleagues show here.</li>}
            {data?.items.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)} className={cn('flex w-full gap-3 px-4 py-2.5 text-left hover:bg-muted/60', !n.readAt && 'bg-primary/5')}>
                  <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full', n.kind === 'NOTICE' ? 'bg-info/15 text-info' : 'bg-primary/12 text-primary')}>
                    {n.kind === 'NOTICE' ? <Megaphone className="size-3.5" /> : <ClipboardList className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[13px] leading-snug', !n.readAt && 'font-semibold')}>{n.title}</span>
                    {n.body && <span className="mt-0.5 block text-xs leading-snug whitespace-pre-line text-muted-foreground">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {n.sender ? `${n.sender} · ` : ''}
                      {fmtAgo(n.createdAt)}
                    </span>
                  </span>
                  {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                </button>
              </li>
            ))}
          </ul>
          <label className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-xs text-muted-foreground">
            <span>Desktop alerts when the ERP tab is in the background</span>
            <Switch
              checked={alerts}
              aria-label="Desktop alerts"
              onCheckedChange={async (on) => {
                const result = await setDesktopAlerts(on);
                setAlerts(result);
                if (on && !result) toast.error('The browser blocked notifications. Allow them in the site settings (lock icon in the address bar).');
              }}
            />
          </label>
        </PopoverContent>
      </Popover>
      {sending && <SendNoticeDialog onClose={() => setSending(false)} />}
    </>
  );
}

interface Targets {
  roles: { id: number; name: string; users: number }[];
  users: { id: number; name: string; role: string }[];
}

function SendNoticeDialog({ onClose }: { onClose: () => void }) {
  const { data: targets } = useApiQuery<Targets>('/notifications/targets');
  const defaults: z.input<typeof noticeSchema> = { title: '', body: '', link: '', target: 'ALL', roleIds: [], userIds: [] };
  const form = useZodForm(noticeSchema, defaults);
  const [target, roleIds, userIds] = useWatch({ control: form.control, name: ['target', 'roleIds', 'userIds'] });
  const [search, setSearch] = useState('');
  const send = useMutation({
    mutationFn: (v: NoticeInput) => api<{ sent: number }>('/notifications/send', { method: 'POST', body: v }),
    onSuccess: (r) => {
      toast.success(r.sent ? `Notice sent to ${r.sent} ${r.sent === 1 ? 'person' : 'people'}` : 'Nobody to send it to');
      onClose();
    },
    onError: (err) => showApiError(err, form),
    meta: { skipInvalidate: true },
  });
  const toggle = (field: 'roleIds' | 'userIds', id: number, on: boolean) => {
    const now = (field === 'roleIds' ? roleIds : userIds) ?? [];
    form.setValue(field, on ? [...now, id] : now.filter((x) => x !== id), { shouldValidate: form.formState.isSubmitted });
  };
  const users = useMemo(() => (targets?.users ?? []).filter((u) => `${u.name} ${u.role}`.toLowerCase().includes(search.toLowerCase())), [targets, search]);
  const listError = (target === 'ROLES' ? form.formState.errors.roleIds : form.formState.errors.userIds)?.message;

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title="Send a notice" description="It appears at once in their bell (and as a desktop alert for those who turned it on)." onSubmit={form.handleSubmit((v) => send.mutate(v))} saving={send.isPending} submitLabel="Send">
      <TextField form={form} name="title" label="Title" required placeholder="Plant closed on Saturday for maintenance" />
      <TextareaField form={form} name="body" label="Message" rows={3} />
      <TextField form={form} name="link" label="Screen to open (optional)" placeholder="/sales/orders" hint="Copy the address after the site name, e.g. /hr/leaves" />
      <SelectField form={form} name="target" label="Send to" options={NOTICE_TARGETS.map((t) => ({ value: t, label: NOTICE_TARGET_LABELS[t] }))} />
      {target === 'ROLES' && (
        <fieldset className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg border p-3" aria-label="Roles">
          {targets?.roles.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-sm">
              <Checkbox id={`role-${r.id}`} checked={roleIds?.includes(r.id)} onCheckedChange={(c) => toggle('roleIds', r.id, c === true)} />
              <Label htmlFor={`role-${r.id}`} className="font-normal">
                {r.name} <span className="text-muted-foreground">({r.users})</span>
              </Label>
            </div>
          ))}
        </fieldset>
      )}
      {target === 'USERS' && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a person" className="h-9 pl-8" aria-label="Find a person" />
          </div>
          <fieldset className="max-h-48 space-y-1.5 overflow-y-auto rounded-lg border p-3" aria-label="People">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-2 text-sm">
                <Checkbox id={`user-${u.id}`} checked={userIds?.includes(u.id)} onCheckedChange={(c) => toggle('userIds', u.id, c === true)} />
                <Label htmlFor={`user-${u.id}`} className="font-normal">
                  {u.name} <span className="text-muted-foreground">· {u.role}</span>
                </Label>
              </div>
            ))}
          </fieldset>
          {!!userIds?.length && <p className="text-xs text-muted-foreground">{userIds.length} chosen</p>}
        </div>
      )}
      {listError && (
        <p role="alert" className="text-xs text-destructive">
          {listError}
        </p>
      )}
    </FormDialog>
  );
}
