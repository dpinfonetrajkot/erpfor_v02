import { CallHandler, Controller, ExecutionContext, Header, Injectable, NestInterceptor, Sse, type MessageEvent } from '@nestjs/common';
import type { Request } from 'express';
import { filter, interval, map, merge, Observable, Subject, tap, throttleTime } from 'rxjs';
import type { LiveEvent } from '@bht/shared';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';

/**
 * Saves that are not ERP data (login, token refresh, Ask ERP, chat, notifications) - they send their own events -
 * and the Excel import check, which only reads a file.
 */
const NOT_A_CHANGE = /^\/api\/((auth|assistant|chat|notifications)(\/|\?|$)|imports\/[\w-]+\/check(\?|$))/;
/** A page reload drops the connection for a moment; only after this long is someone shown offline. */
const OFFLINE_AFTER_MS = 8_000;

interface Outgoing {
  /** null = everyone */
  to: Set<number> | null;
  type: string;
  data: unknown;
}

/**
 * The live connection of every open screen (server-sent events):
 * - "change": someone saved ERP data - screens reload what they show (never carries data);
 * - chat messages, notifications and online / offline, each sent only to the users concerned.
 * Kept in memory: fine for one API process.
 */
@Injectable()
export class LiveUpdates {
  private readonly events = new Subject<Outgoing>();
  /** Open connections per user (a user can have several tabs). */
  private readonly connections = new Map<number, number>();
  private readonly offlineTimers = new Map<number, ReturnType<typeof setTimeout>>();

  /** ERP data changed (called after every successful save). */
  notify(byUserId: number | null) {
    this.events.next({ to: null, type: 'change', data: { by: byUserId } });
  }

  /** An event for some users only. */
  send(userIds: Iterable<number>, event: LiveEvent) {
    const to = new Set(userIds);
    if (to.size) this.events.next({ to, type: event.type, data: event });
  }

  isOnline(userId: number) {
    return (this.connections.get(userId) ?? 0) > 0;
  }

  private connected(userId: number) {
    clearTimeout(this.offlineTimers.get(userId));
    this.offlineTimers.delete(userId);
    const n = (this.connections.get(userId) ?? 0) + 1;
    this.connections.set(userId, n);
    if (n === 1) this.events.next({ to: null, type: 'presence', data: { type: 'presence', userId, online: true } satisfies LiveEvent });
  }

  private disconnected(userId: number) {
    const n = Math.max(0, (this.connections.get(userId) ?? 1) - 1);
    this.connections.set(userId, n);
    if (n > 0) return;
    clearTimeout(this.offlineTimers.get(userId));
    this.offlineTimers.set(
      userId,
      setTimeout(() => {
        this.offlineTimers.delete(userId);
        if (!this.isOnline(userId)) this.events.next({ to: null, type: 'presence', data: { type: 'presence', userId, online: false } satisfies LiveEvent });
      }, OFFLINE_AFTER_MS),
    );
  }

  /** One user's connection. "change" at most twice a second (the biometric machine can send many saves). */
  stream(userId: number): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      this.connected(userId);
      const sub = merge(
        this.events.pipe(
          filter((e) => e.type === 'change'),
          throttleTime(500, undefined, { leading: true, trailing: true }),
        ),
        this.events.pipe(filter((e) => e.type !== 'change' && (!e.to || e.to.has(userId)))),
      )
        .pipe(map((e): MessageEvent => ({ type: e.type, data: e.data as object })))
        .subscribe(subscriber);
      // proxies close quiet connections; a ping every 25 s keeps it open
      const ping = interval(25_000).subscribe(() => subscriber.next({ type: 'ping', data: '' }));
      return () => {
        sub.unsubscribe();
        ping.unsubscribe();
        this.disconnected(userId);
      };
    });
  }
}

/** After every successful save of ERP data (POST / PUT / PATCH / DELETE), announce a change. */
@Injectable()
export class LiveUpdatesInterceptor implements NestInterceptor {
  constructor(private readonly live: LiveUpdates) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.method === 'GET' || NOT_A_CHANGE.test(req.originalUrl ?? req.url)) return next.handle();
    return next.handle().pipe(tap(() => this.live.notify(req.user?.id ?? null)));
  }
}

@Controller('events')
export class LiveUpdatesController {
  constructor(private readonly live: LiveUpdates) {}

  /** Server-sent events for any logged-in user ("no-transform" stops gzip from holding messages back). */
  @Sse()
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('X-Accel-Buffering', 'no')
  events(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    return this.live.stream(user.id);
  }
}
