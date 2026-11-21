'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { ArrowLeft, Check, CheckCheck, LogOut, MessagesSquare, Pencil, Plus, Search, SendHorizontal, Trash2, UserMinus, UserPlus, Users } from 'lucide-react';
import { CHAT_MESSAGE_MAX, type ChatConversationRow, type ChatMessageRow, type ChatThread, type ChatUser } from '@bht/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { showApiError, useApiQuery } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Checkbox, Label, Skeleton } from '@/components/ui/primitives';
import { RequirePermission } from '@/components/app/no-access';
import { useSession } from '@/components/app/session';
import { chatScreen } from '@/components/app/live-updates';

const reloadChat = (client: ReturnType<typeof useQueryClient>) => void client.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('/chat') });

export default function ChatPage() {
  return (
    <RequirePermission permission="chat.view">
      <Suspense>
        <Chat />
      </Suspense>
    </RequirePermission>
  );
}

function Chat() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const selected = Number(sp.get('c')) || null;
  const select = useCallback((id: number | null) => router.replace(id ? `${pathname}?c=${id}` : pathname, { scroll: false }), [router, pathname]);
  const conversations = useApiQuery<ChatConversationRow[]>('/chat/conversations');

  // no pop-up for messages in the chat that is open
  useEffect(() => {
    chatScreen.conversationId = selected;
    return () => {
      chatScreen.conversationId = null;
    };
  }, [selected]);

  return (
    <div className="-mx-4 -my-6 grid h-[calc(100dvh-3.5rem)] overflow-hidden border-b bg-card sm:mx-0 sm:my-0 sm:h-[calc(100dvh-6.5rem)] sm:rounded-lg sm:border md:grid-cols-[320px_1fr]">
      <aside className={cn('flex min-h-0 flex-col border-r', selected && 'hidden md:flex')} aria-label="Chats">
        <ConversationList rows={conversations.data} loading={conversations.isLoading} selected={selected} onSelect={select} />
      </aside>
      <section className={cn('flex min-h-0 min-w-0 flex-col', !selected && 'hidden md:flex')} aria-label="Conversation">
        {selected ? (
          <Thread key={selected} id={selected} onBack={() => select(null)} onGone={() => select(null)} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <MessagesSquare className="size-10 text-muted-foreground/50" />
            <p className="font-medium text-foreground">Chat with your colleagues</p>
            <p>Choose a chat on the left, or start a new one. Messages arrive at once.</p>
          </div>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ helpers

const COLORS = ['bg-orange-500', 'bg-sky-600', 'bg-emerald-600', 'bg-violet-600', 'bg-rose-600', 'bg-amber-600', 'bg-teal-600', 'bg-indigo-600'];
function Avatar({ name, id, online, group, className }: { name: string; id: number; online?: boolean; group?: boolean; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
  return (
    <span className={cn('relative flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white', COLORS[id % COLORS.length], className)} aria-hidden>
      {group ? <Users className="size-4" /> : initials}
      {online && <span className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-card bg-success" />}
    </span>
  );
}

const time = (iso: string) => format(parseISO(iso), 'HH:mm');
function when(iso: string) {
  const d = parseISO(iso);
  return isToday(d) ? format(d, 'HH:mm') : isYesterday(d) ? 'Yesterday' : format(d, 'd MMM');
}
function dayLabel(iso: string) {
  const d = parseISO(iso);
  return isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday' : format(d, 'd MMMM yyyy');
}

/** Message text with web links made clickable. */
function Body({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {p}
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
}

// ------------------------------------------------------------------ list

function ConversationList({ rows, loading, selected, onSelect }: { rows?: ChatConversationRow[]; loading: boolean; selected: number | null; onSelect: (id: number) => void }) {
  const [search, setSearch] = useState('');
  const [starting, setStarting] = useState(false);
  const shown = (rows ?? []).filter((r) => r.title.toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <h1 className="flex-1 text-base font-semibold">Chats</h1>
        <Button size="sm" onClick={() => setStarting(true)}>
          <Plus /> New
        </Button>
      </div>
      <div className="border-b px-3 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats" className="h-9 pl-8" aria-label="Search chats" />
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <li className="space-y-2 p-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </li>
        )}
        {!loading && !shown.length && (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">{rows?.length ? 'No chat matches.' : 'No chats yet. Press “New” to start one.'}</li>
        )}
        {shown.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              aria-current={r.id === selected ? 'true' : undefined}
              className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/60', r.id === selected && 'bg-muted')}
            >
              <Avatar name={r.title} id={r.other?.id ?? r.id} online={r.other?.online} group={r.type === 'GROUP'} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={cn('flex-1 truncate text-sm', r.unread ? 'font-semibold' : 'font-medium')}>{r.title}</span>
                  {r.lastMessage && <span className={cn('shrink-0 text-[11px]', r.unread ? 'font-semibold text-primary' : 'text-muted-foreground')}>{when(r.lastMessage.at)}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="flex-1 truncate text-xs text-muted-foreground">
                    {r.lastMessage ? `${r.lastMessage.mine ? 'You: ' : r.type === 'GROUP' && r.lastMessage.senderName ? `${r.lastMessage.senderName.split(' ')[0]}: ` : ''}${r.lastMessage.body}` : 'No messages yet'}
                  </span>
                  {r.unread > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground" aria-label={`${r.unread} unread`}>
                      {r.unread}
                    </span>
                  )}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {starting && (
        <NewChatDialog
          onClose={() => setStarting(false)}
          onOpen={(id) => {
            setStarting(false);
            onSelect(id);
          }}
        />
      )}
    </>
  );
}

function PeoplePicker({ users, chosen, onToggle }: { users: ChatUser[]; chosen: number[]; onToggle: (id: number, on: boolean) => void }) {
  const [search, setSearch] = useState('');
  const shown = users.filter((u) => `${u.name} ${u.role}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a person" className="h-9 pl-8" aria-label="Find a person" />
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
        {shown.map((u) => (
          <div key={u.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm">
            <Checkbox id={`pick-${u.id}`} checked={chosen.includes(u.id)} onCheckedChange={(c) => onToggle(u.id, c === true)} />
            <Label htmlFor={`pick-${u.id}`} className="flex-1 font-normal">
              {u.name} <span className="text-muted-foreground">· {u.role}</span>
            </Label>
            {u.online && <span className="size-2 rounded-full bg-success" aria-label="online" />}
          </div>
        ))}
        {!shown.length && <p className="px-1 py-2 text-sm text-muted-foreground">Nobody found.</p>}
      </div>
    </div>
  );
}

function NewChatDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (id: number) => void }) {
  const users = useApiQuery<ChatUser[]>('/chat/users');
  const [mode, setMode] = useState<'person' | 'group'>('person');
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [members, setMembers] = useState<number[]>([]);
  const direct = useMutation({ mutationFn: (userId: number) => api<{ id: number }>('/chat/conversations/direct', { method: 'POST', body: { userId } }), onSuccess: (c) => onOpen(c.id), onError: (e) => showApiError(e), meta: { skipInvalidate: true } });
  const group = useMutation({ mutationFn: () => api<{ id: number }>('/chat/conversations/group', { method: 'POST', body: { name, memberIds: members } }), onSuccess: (c) => onOpen(c.id), onError: (e) => showApiError(e), meta: { skipInvalidate: true } });
  const shown = (users.data ?? []).filter((u) => `${u.name} ${u.role}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New chat</DialogTitle>
          <DialogDescription>Talk to one colleague, or make a group (for example “Forging shift A”).</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 rounded-full glass p-1" role="tablist" aria-label="Chat type">
          {(['person', 'group'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn('flex-1 rounded-full py-1.5 text-sm font-semibold', mode === m ? 'bg-ink text-ink-foreground' : 'text-muted-foreground')}>
              {m === 'person' ? 'One person' : 'Group'}
            </button>
          ))}
        </div>
        {mode === 'person' ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a person" className="h-9 pl-8" aria-label="Find a person" autoFocus />
            </div>
            <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
              {shown.map((u) => (
                <li key={u.id}>
                  <button type="button" disabled={direct.isPending} onClick={() => direct.mutate(u.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/60">
                    <Avatar name={u.name} id={u.id} online={u.online} className="size-8 text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{u.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {u.role}
                        {u.online ? ' · online' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {users.data && !shown.length && <li className="px-3 py-4 text-sm text-muted-foreground">Nobody found.</li>}
            </ul>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return toast.error('Give the group a name');
              if (!members.length) return toast.error('Choose at least one person');
              group.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="group-name">Group name</Label>
              <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Forging shift A" />
            </div>
            <PeoplePicker users={users.data ?? []} chosen={members} onToggle={(id, on) => setMembers(on ? [...members, id] : members.filter((x) => x !== id))} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={group.isPending}>
                Make group{members.length ? ` (${members.length + 1})` : ''}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ thread

function Thread({ id, onBack, onGone }: { id: number; onBack: () => void; onGone: () => void }) {
  const { user } = useSession();
  const client = useQueryClient();
  const path = `/chat/conversations/${id}`;
  const { data, isError } = useApiQuery<ChatThread>(path);
  const [older, setOlder] = useState<ChatMessageRow[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState<ChatMessageRow | null>(null);
  const [members, setMembers] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const keepFromBottom = useRef<number | null>(null);
  const sentRead = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isError) onGone();
  }, [isError, onGone]);

  const messages = useMemo(() => {
    const seen = new Set<number>();
    return [...older, ...(data?.messages ?? [])].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  }, [older, data]);
  const hasMore = olderMore ?? data?.hasMore ?? false;
  const lastId = messages[messages.length - 1]?.id ?? 0;

  // stay at the bottom for new messages; keep the place when older ones are added on top
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (keepFromBottom.current != null) {
      el.scrollTop = el.scrollHeight - keepFromBottom.current;
      keepFromBottom.current = null;
    } else el.scrollTop = el.scrollHeight;
  }, [lastId, messages.length]);

  // tell the others I have seen it (while this tab is in front)
  useEffect(() => {
    const mark = () => {
      if (!lastId || document.hidden || lastId <= sentRead.current) return;
      sentRead.current = lastId;
      void api(`${path}/read`, { method: 'POST', body: { messageId: lastId } })
        .then(() => reloadChat(client))
        .catch(() => (sentRead.current = 0));
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [lastId, path, client]);

  const loadOlder = async () => {
    if (!messages.length) return;
    setLoadingOlder(true);
    try {
      const page = await api<ChatThread>(path, { query: { before: messages[0].id } });
      keepFromBottom.current = logRef.current ? logRef.current.scrollHeight - logRef.current.scrollTop : null;
      setOlder([...page.messages, ...older]);
      setOlderMore(page.hasMore);
    } catch (e) {
      showApiError(e);
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = useMutation({
    mutationFn: (body: string) => api<ChatMessageRow>(`${path}/messages`, { method: 'POST', body: { body } }),
    onSuccess: (msg) => {
      client.setQueryData<ChatThread>([path, {}], (t) => (t ? { ...t, messages: [...t.messages, msg] } : t));
      reloadChat(client);
    },
    onError: (e, body) => {
      setDraft(body);
      showApiError(e);
    },
    meta: { skipInvalidate: true },
  });
  const remove = useMutation({
    mutationFn: (m: ChatMessageRow) => api(`/chat/messages/${m.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setOlder((o) => o.map((m) => (m.id === deleting?.id ? { ...m, deleted: true, body: '' } : m)));
      setDeleting(null);
      reloadChat(client);
    },
    onError: (e) => showApiError(e),
    meta: { skipInvalidate: true },
  });

  const submit = () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    setDraft('');
    send.mutate(body);
    inputRef.current?.focus();
  };

  if (!data) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  const c = data.conversation;
  const others = c.members.filter((m) => m.id !== user.id);
  const subtitle =
    c.type === 'DIRECT'
      ? c.other
        ? `${c.other.role} · ${c.other.online ? 'online' : 'offline'}`
        : ''
      : `${c.memberCount} members · ${others.filter((m) => m.online).length ? `${others.filter((m) => m.online).length} online` : others.map((m) => m.name.split(' ')[0]).join(', ')}`;
  /** Seen by everyone else (direct: the other person). */
  const seen = (m: ChatMessageRow) => others.length > 0 && others.every((o) => (data.readUpTo[o.id] ?? 0) >= m.id);

  return (
    <>
      <header className="flex items-center gap-3 border-b px-3 py-2.5 sm:px-4">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onBack} aria-label="Back to chats">
          <ArrowLeft />
        </Button>
        <Avatar name={c.title} id={c.other?.id ?? c.id} online={c.other?.online} group={c.type === 'GROUP'} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{c.title}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {c.type === 'GROUP' && (
          <Button variant="outline" size="sm" onClick={() => setMembers(true)}>
            <Users /> <span className="hidden sm:inline">Members</span>
          </Button>
        )}
      </header>

      <div ref={logRef} role="log" aria-live="polite" aria-label={`Messages with ${c.title}`} className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-muted/30 px-3 py-4 sm:px-6">
        {hasMore && (
          <div className="pb-2 text-center">
            <Button variant="outline" size="sm" onClick={loadOlder} loading={loadingOlder}>
              Load earlier messages
            </Button>
          </div>
        )}
        {!messages.length && <p className="py-10 text-center text-sm text-muted-foreground">No messages yet. Say hello!</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
          const mine = m.senderId === user.id;
          const sameSender = !newDay && prev && prev.senderId === m.senderId && prev.senderId !== null;
          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-3 text-center">
                  <span className="rounded-full bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground">{dayLabel(m.createdAt)}</span>
                </div>
              )}
              {m.senderId === null ? (
                <p className="my-2 text-center text-xs text-muted-foreground">{m.body}</p>
              ) : (
                <div className={cn('group flex items-end gap-1.5', mine ? 'justify-end' : 'justify-start', !sameSender && 'mt-2')}>
                  {mine && !m.deleted && (
                    <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label="Delete message" onClick={() => setDeleting(m)}>
                      <Trash2 />
                    </Button>
                  )}
                  <div
                    data-slot="message"
                    className={cn(
                      'max-w-[80%] rounded-xl px-3 py-1.5 text-sm sm:max-w-[65%]',
                      mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-card',
                      m.deleted && 'italic opacity-70',
                    )}
                  >
                    {c.type === 'GROUP' && !mine && !sameSender && <p className="text-xs font-semibold text-primary">{m.senderName}</p>}
                    <p className="wrap-break-word whitespace-pre-wrap">{m.deleted ? 'This message was deleted' : <Body text={m.body} />}</p>
                    <p className={cn('mt-0.5 flex items-center justify-end gap-1 text-[10px]', mine ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
                      {time(m.createdAt)}
                      {mine && !m.deleted && (seen(m) ? <CheckCheck className="size-3.5" aria-label="Seen" /> : <Check className="size-3.5" aria-label="Sent" />)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <form
        className="flex items-end gap-2 border-t px-3 py-3 sm:px-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={CHAT_MESSAGE_MAX}
          autoFocus
          placeholder="Type a message"
          aria-label="Message"
          className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-input bg-background px-4 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
        />
        <Button type="submit" size="icon" className="rounded-full" disabled={!draft.trim()} aria-label="Send">
          <SendHorizontal />
        </Button>
      </form>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this message?"
        description="It is removed for everyone in the chat."
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
      {members && <MembersDialog thread={data} onClose={() => setMembers(false)} onLeft={onGone} />}
    </>
  );
}

function MembersDialog({ thread, onClose, onLeft }: { thread: ChatThread; onClose: () => void; onLeft: () => void }) {
  const { user } = useSession();
  const client = useQueryClient();
  const c = thread.conversation;
  const path = `/chat/conversations/${c.id}`;
  const users = useApiQuery<ChatUser[]>('/chat/users', undefined, c.isAdmin);
  const [adding, setAdding] = useState<number[]>([]);
  const [name, setName] = useState(c.title);
  const [leaving, setLeaving] = useState(false);
  const done = (msg: string) => {
    toast.success(msg);
    reloadChat(client);
  };
  const add = useMutation({ mutationFn: () => api(`${path}/members`, { method: 'POST', body: { userIds: adding } }), onSuccess: () => (setAdding([]), done('Added to the group')), onError: (e) => showApiError(e), meta: { skipInvalidate: true } });
  const removeOne = useMutation({ mutationFn: (userId: number) => api(`${path}/members/${userId}`, { method: 'DELETE' }), onSuccess: () => done('Removed from the group'), onError: (e) => showApiError(e), meta: { skipInvalidate: true } });
  const rename = useMutation({ mutationFn: () => api(path, { method: 'PUT', body: { name } }), onSuccess: () => done('Group renamed'), onError: (e) => showApiError(e), meta: { skipInvalidate: true } });
  const leave = useMutation({
    mutationFn: () => api(`${path}/members/${user.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      done('You left the group');
      onClose();
      onLeft();
    },
    onError: (e) => showApiError(e),
    meta: { skipInvalidate: true },
  });
  const notIn = (users.data ?? []).filter((u) => !c.members.some((m) => m.id === u.id));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{c.title}</DialogTitle>
          <DialogDescription>{c.memberCount} members</DialogDescription>
        </DialogHeader>
        {c.isAdmin && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && name.trim() !== c.title) rename.mutate();
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="rename-group">Group name</Label>
              <Input id="rename-group" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </div>
            <Button type="submit" variant="outline" loading={rename.isPending}>
              <Pencil /> Rename
            </Button>
          </form>
        )}
        <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border">
          {c.members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2">
              <Avatar name={m.name} id={m.id} online={m.online} className="size-8 text-xs" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {m.name}
                  {m.id === user.id ? ' (you)' : ''}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {m.role}
                  {m.online ? ' · online' : ''}
                </span>
              </span>
              {m.isAdmin && <Badge variant="secondary">Admin</Badge>}
              {c.isAdmin && m.id !== user.id && (
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.name}`} onClick={() => removeOne.mutate(m.id)}>
                  <UserMinus />
                </Button>
              )}
            </li>
          ))}
        </ul>
        {c.isAdmin && notIn.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Add people</p>
            <PeoplePicker users={notIn} chosen={adding} onToggle={(id, on) => setAdding(on ? [...adding, id] : adding.filter((x) => x !== id))} />
            <Button size="sm" disabled={!adding.length} loading={add.isPending} onClick={() => add.mutate()}>
              <UserPlus /> Add {adding.length || ''}
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" className="text-destructive" onClick={() => setLeaving(true)}>
            <LogOut /> Leave group
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
        <ConfirmDialog
          open={leaving}
          onOpenChange={setLeaving}
          title="Leave this group?"
          description="You will not get its messages any more. An admin can add you again."
          confirmLabel="Leave"
          loading={leave.isPending}
          onConfirm={() => leave.mutate()}
        />
      </DialogContent>
    </Dialog>
  );
}

