'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { LiveEvent } from '@bht/shared';
import { api } from '@/lib/api';

/** The chat open on screen right now (no pop-up for messages in it). Set by the chat page. */
export const chatScreen = { conversationId: null as number | null };

const ALERTS_KEY = 'erp.desktopAlerts';

/** Desktop pop-ups when the ERP tab is in the background: needs the user's "on" and the browser's permission. */
export function desktopAlertsOn(): boolean {
  try {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted' && localStorage.getItem(ALERTS_KEY) === '1';
  } catch {
    return false;
  }
}

export async function setDesktopAlerts(on: boolean): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (on && Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') return false;
  try {
    localStorage.setItem(ALERTS_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
  return on;
}

function desktopAlert(title: string, body: string | null | undefined, onClick: () => void) {
  if (!document.hidden || !desktopAlertsOn()) return;
  try {
    const n = new Notification(title, { body: body ?? undefined, icon: '/icon.svg', tag: title });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

const startsWith = (prefix: string) => (q: { queryKey: readonly unknown[] }) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(prefix);
const reloadChat = (client: QueryClient) => void client.invalidateQueries({ predicate: startsWith('/chat') });

/**
 * The live connection of this screen (server-sent events from /api/events):
 * - change: someone saved ERP data, so what is on screen is loaded again;
 * - chat / notification: new message or notice, with a pop-up (and a desktop alert when the tab is in the background);
 * - presence: someone came online / went offline.
 */
export function useLiveUpdates(userId: number) {
  const client = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    let source: EventSource | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let presenceTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    // several saves close together give one reload; chat and the bell look after themselves
    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(
        () => void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'session' && !startsWith('/chat')(q) && !startsWith('/notifications')(q) }),
        300,
      );
    };
    const parse = (e: Event) => JSON.parse((e as MessageEvent<string>).data) as LiveEvent;

    const onChat = (e: Event) => {
      const ev = parse(e);
      if (ev.type !== 'chat') return;
      reloadChat(client);
      if (ev.from === userId) return;
      const open = () => router.push(`/chat?c=${ev.conversationId}`);
      const looking = chatScreen.conversationId === ev.conversationId && !document.hidden;
      if (!looking) {
        const title = ev.title === ev.fromName ? (ev.fromName ?? 'New message') : `${ev.fromName ?? 'Someone'} in ${ev.title}`;
        toast.message(title, { description: ev.preview, action: { label: 'Open', onClick: open } });
      }
      desktopAlert(ev.title === ev.fromName ? (ev.fromName ?? 'New message') : `${ev.fromName} · ${ev.title}`, ev.preview, open);
    };
    const onNotification = (e: Event) => {
      const ev = parse(e);
      if (ev.type !== 'notification') return;
      void client.invalidateQueries({ predicate: startsWith('/notifications') });
      const open = () => ev.link && router.push(ev.link);
      toast.info(ev.title, { description: ev.body ?? undefined, ...(ev.link ? { action: { label: 'Open', onClick: open } } : {}) });
      desktopAlert(ev.title, ev.body, open);
    };
    const onPresence = () => {
      clearTimeout(presenceTimer);
      presenceTimer = setTimeout(() => reloadChat(client), 1_000);
    };

    const connect = (afterBreak: boolean) => {
      if (stopped) return;
      source = new EventSource('/api/events');
      source.addEventListener('change', refresh);
      source.addEventListener('chat', onChat);
      source.addEventListener('chat-update', () => reloadChat(client));
      source.addEventListener('notification', onNotification);
      source.addEventListener('presence', onPresence);
      // changes made while the connection was down are picked up once it is back
      if (afterBreak)
        source.addEventListener(
          'open',
          () => {
            refresh();
            reloadChat(client);
            void client.invalidateQueries({ predicate: startsWith('/notifications') });
          },
          { once: true },
        );
      source.onerror = () => {
        source?.close();
        // the login may have expired: any API call renews it, then connect again
        retryTimer = setTimeout(() => void api('/auth/me').catch(() => undefined).finally(() => connect(true)), 5_000);
      };
    };

    connect(false);
    return () => {
      stopped = true;
      source?.close();
      clearTimeout(refreshTimer);
      clearTimeout(presenceTimer);
      clearTimeout(retryTimer);
    };
  }, [client, router, userId]);
}
