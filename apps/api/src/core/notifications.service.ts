import { Injectable, Logger } from '@nestjs/common';
import { WILDCARD_PERMISSION, type NotificationKind } from '@bht/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LiveUpdates } from './live-updates';

export interface NotificationContent {
  title: string;
  body?: string | null;
  /** Screen to open, e.g. /sales/orders/12 */
  link?: string | null;
}

/** The same unread task is not sent twice within this time (a card recorded stage after stage, etc.). */
const REPEAT_AFTER_MS = 60 * 60_000;

/**
 * Bell notifications. Business modules call `toPermission` when work reaches a department
 * ("SO/26-27/0007 waits for design approval"); users with the right permission send notices.
 * Delivered at once over the live connection. Never makes the calling save fail.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveUpdates,
  ) {}

  /** Active users whose role has any of the permissions. Admins (who have everything) only with `withAdmins`. */
  async usersWith(permissions: string[], withAdmins = false): Promise<number[]> {
    const perms = withAdmins ? [...permissions, WILDCARD_PERMISSION] : permissions;
    const users = await this.prisma.user.findMany({
      where: { isActive: true, role: { permissions: { some: { permission: { in: perms } } } } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  /** Tell the people who can act on something (not the person who did it). */
  async toPermission(permissions: string | string[], content: NotificationContent, exceptUserId?: number | null) {
    try {
      const ids = await this.usersWith(Array.isArray(permissions) ? permissions : [permissions]);
      await this.toUsers(ids.filter((id) => id !== exceptUserId), content, { kind: 'TASK' });
    } catch (err) {
      this.logger.error(`"${content.title}": ${(err as Error).message}`);
    }
  }

  /** Store and deliver; returns how many people got it. */
  async toUsers(userIds: number[], content: NotificationContent, opts: { kind: NotificationKind; senderId?: number }): Promise<number> {
    let ids = [...new Set(userIds)];
    if (!ids.length) return 0;
    const title = content.title.slice(0, 150);
    const body = content.body?.slice(0, 500) || null;
    const link = content.link || null;
    if (opts.kind === 'TASK') {
      // someone who has not opened the same task yet is not told again
      const already = await this.prisma.notification.findMany({
        where: { userId: { in: ids }, title, link, readAt: null, createdAt: { gte: new Date(Date.now() - REPEAT_AFTER_MS) } },
        select: { userId: true },
      });
      const skip = new Set(already.map((a) => a.userId));
      ids = ids.filter((id) => !skip.has(id));
      if (!ids.length) return 0;
    }
    await this.prisma.notification.createMany({ data: ids.map((userId) => ({ userId, kind: opts.kind, title, body, link, senderId: opts.senderId ?? null })) });
    this.live.send(ids, { type: 'notification', title, body, link });
    return ids.length;
  }
}
