import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  chatDirectSchema,
  chatGroupSchema,
  chatMembersSchema,
  chatMessageSchema,
  chatReadSchema,
  chatRenameSchema,
  noticeSchema,
  type ChatGroupInput,
  type NoticeInput,
  type NotificationRow,
} from '@bht/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction } from '../generated/prisma/client';
import { AuditService } from '../core/audit.service';
import { NotificationsService } from '../core/notifications.service';
import { CurrentActor, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { Actor, AuthUser } from '../common/auth-user';
import { ChatService } from './chat.service';

const beforeSchema = z.object({ before: z.coerce.number().int().positive().optional() });

@Controller('chat')
@RequirePermission('chat.view')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('users')
  users(@CurrentUser() user: AuthUser) {
    return this.chat.users(user.id);
  }

  @Get('unread')
  unread(@CurrentUser() user: AuthUser) {
    return this.chat.unreadTotal(user.id);
  }

  @Get('conversations')
  conversations(@CurrentUser() user: AuthUser) {
    return this.chat.conversations(user.id);
  }

  @Post('conversations/direct')
  direct(@Body(new ZodValidationPipe(chatDirectSchema)) body: { userId: number }, @CurrentUser() user: AuthUser) {
    return this.chat.direct(user.id, body.userId);
  }

  @Post('conversations/group')
  group(@Body(new ZodValidationPipe(chatGroupSchema)) body: ChatGroupInput, @CurrentUser() user: AuthUser) {
    return this.chat.group(user.id, user.name, body);
  }

  @Get('conversations/:id')
  thread(@Param('id', ParseIntPipe) id: number, @Query(new ZodValidationPipe(beforeSchema)) q: { before?: number }, @CurrentUser() user: AuthUser) {
    return this.chat.thread(user.id, id, q.before);
  }

  @Post('conversations/:id/messages')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  send(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(chatMessageSchema)) body: { body: string }, @CurrentUser() user: AuthUser) {
    return this.chat.send(user.id, id, body.body);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  read(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(chatReadSchema)) body: { messageId: number }, @CurrentUser() user: AuthUser) {
    return this.chat.read(user.id, id, body.messageId);
  }

  @Put('conversations/:id')
  rename(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(chatRenameSchema)) body: { name: string }, @CurrentUser() user: AuthUser) {
    return this.chat.rename(user.id, user.name, id, body.name);
  }

  @Post('conversations/:id/members')
  addMembers(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(chatMembersSchema)) body: { userIds: number[] }, @CurrentUser() user: AuthUser) {
    return this.chat.addMembers(user.id, user.name, id, body.userIds);
  }

  /** Remove someone (group admin), or leave the group (your own id). */
  @Delete('conversations/:id/members/:userId')
  @HttpCode(204)
  removeMember(@Param('id', ParseIntPipe) id: number, @Param('userId', ParseIntPipe) userId: number, @CurrentUser() user: AuthUser) {
    return this.chat.removeMember(user.id, user.name, id, userId);
  }

  @Delete('messages/:id')
  @HttpCode(204)
  deleteMessage(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    return this.chat.deleteMessage(user.id, id);
  }
}

const listSchema = z.object({ before: z.coerce.number().int().positive().optional(), unread: z.enum(['true', 'false']).optional() });

/** My bell notifications (any logged-in user) and sending notices (notifications.create). */
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query(new ZodValidationPipe(listSchema)) q: z.infer<typeof listSchema>, @CurrentUser() user: AuthUser) {
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId: user.id, ...(q.before ? { id: { lt: q.before } } : {}), ...(q.unread === 'true' ? { readAt: null } : {}) },
        orderBy: { id: 'desc' },
        take: 31,
        include: { sender: { select: { name: true } } },
      }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    const items: NotificationRow[] = rows.slice(0, 30).map((n) => ({
      id: n.id,
      kind: n.kind === 'NOTICE' ? 'NOTICE' : 'TASK',
      title: n.title,
      body: n.body,
      link: n.link,
      sender: n.sender?.name ?? null,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    }));
    return { items, unread, hasMore: rows.length > 30 };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser) {
    const r = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { read: r.count };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthUser) {
    await this.prisma.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }

  /** Roles and people a notice can go to. */
  @Get('targets')
  @RequirePermission('notifications.create')
  async targets() {
    const [roles, users] = await Promise.all([
      this.prisma.role.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, _count: { select: { users: { where: { isActive: true } } } } } }),
      this.prisma.user.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, role: { select: { name: true } } } }),
    ]);
    return { roles: roles.map((r) => ({ id: r.id, name: r.name, users: r._count.users })), users: users.map((u) => ({ id: u.id, name: u.name, role: u.role.name })) };
  }

  @Post('send')
  @RequirePermission('notifications.create')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async send(@Body(new ZodValidationPipe(noticeSchema)) body: NoticeInput, @CurrentUser() user: AuthUser, @CurrentActor() actor: Actor) {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        ...(body.target === 'ROLES' ? { roleId: { in: body.roleIds ?? [] } } : body.target === 'USERS' ? { id: { in: body.userIds ?? [] } } : {}),
      },
      select: { id: true },
    });
    const sent = await this.notifications.toUsers(
      users.map((u) => u.id).filter((id) => id !== user.id),
      { title: body.title, body: body.body, link: body.link },
      { kind: 'NOTICE', senderId: user.id },
    );
    await this.audit.log(actor, { action: AuditAction.CREATE, entity: 'notice', summary: `Notice "${body.title}" sent to ${sent} user(s)` });
    return { sent };
  }
}
