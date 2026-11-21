import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ChatConversationRow, ChatGroupInput, ChatMessageRow, ChatThread, ChatUser } from '@bht/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LiveUpdates } from '../core/live-updates';
import { NotificationsService } from '../core/notifications.service';

const PAGE = 50;
const memberInclude = { user: { select: { id: true, name: true, isActive: true, role: { select: { name: true } } } } } as const;
type Conversation = Prisma.ChatConversationGetPayload<{
  include: { members: { include: typeof memberInclude }; messages: { include: { sender: { select: { name: true } } } } };
}>;

/** Chat between colleagues: one-to-one and groups. New messages reach the others at once over the live connection. */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveUpdates,
    private readonly notifications: NotificationsService,
  ) {}

  private chatUser(u: { id: number; name: string; role: { name: string } }): ChatUser {
    return { id: u.id, name: u.name, role: u.role.name, online: this.live.isOnline(u.id) };
  }

  /** People one can chat with: active users who may use the chat. */
  async users(me: number): Promise<ChatUser[]> {
    const ids = new Set(await this.notifications.usersWith(['chat.view'], true));
    const users = await this.prisma.user.findMany({ where: { isActive: true, id: { in: [...ids], not: me } }, orderBy: { name: 'asc' }, select: { id: true, name: true, role: { select: { name: true } } } });
    return users.map((u) => this.chatUser(u));
  }

  /** My membership; throws when I am not (or no longer) in the chat. */
  private async member(me: number, conversationId: number) {
    const m = await this.prisma.chatMember.findUnique({ where: { conversationId_userId: { conversationId, userId: me } } });
    if (!m || m.leftAt) throw new NotFoundException('Chat not found');
    return m;
  }

  private row(c: Conversation, me: number, unread: number): ChatConversationRow {
    const active = c.members.filter((m) => !m.leftAt);
    const other = c.type === 'DIRECT' ? c.members.find((m) => m.userId !== me)?.user : undefined;
    const last = c.messages[0];
    return {
      id: c.id,
      type: c.type,
      title: c.type === 'DIRECT' ? (other?.name ?? 'Former user') : (c.name ?? 'Group'),
      other: other ? this.chatUser(other) : null,
      memberCount: active.length,
      isAdmin: !!c.members.find((m) => m.userId === me)?.isAdmin,
      lastMessage: last ? { body: last.deletedAt ? 'Message deleted' : last.body, senderName: last.sender?.name ?? null, mine: last.senderId === me, at: last.createdAt.toISOString() } : null,
      unread,
    };
  }

  private async unreadByConversation(me: number): Promise<Map<number, number>> {
    const rows = await this.prisma.$queryRaw<{ id: number; n: bigint }[]>`
      SELECT m.conversation_id AS id, COUNT(*) AS n
      FROM chat_messages m
      JOIN chat_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ${me} AND cm.left_at IS NULL
      WHERE m.id > COALESCE(cm.last_read_message_id, 0) AND m.deleted_at IS NULL AND (m.sender_id IS NULL OR m.sender_id <> ${me})
      GROUP BY m.conversation_id`;
    return new Map(rows.map((r) => [Number(r.id), Number(r.n)]));
  }

  async unreadTotal(me: number) {
    return { total: [...(await this.unreadByConversation(me)).values()].reduce((s, n) => s + n, 0) };
  }

  private include = {
    members: { include: memberInclude },
    messages: { orderBy: { id: 'desc' as const }, take: 1, include: { sender: { select: { name: true } } } },
  };

  /** My chats, latest activity first. */
  async conversations(me: number): Promise<ChatConversationRow[]> {
    const [list, unread] = await Promise.all([
      this.prisma.chatConversation.findMany({ where: { members: { some: { userId: me, leftAt: null } } }, include: this.include }),
      this.unreadByConversation(me),
    ]);
    return list
      .map((c) => this.row(c, me, unread.get(c.id) ?? 0))
      .sort((a, b) => (b.lastMessage?.at ?? '').localeCompare(a.lastMessage?.at ?? '') || b.id - a.id);
  }

  /** The one-to-one chat with someone, made the first time. */
  async direct(me: number, userId: number): Promise<{ id: number }> {
    if (userId === me) throw new BadRequestException('Choose someone else');
    const other = await this.prisma.user.findFirst({ where: { id: userId, isActive: true } });
    if (!other) throw new BadRequestException('That user is not active');
    const directKey = `${Math.min(me, userId)}:${Math.max(me, userId)}`;
    const found = await this.prisma.chatConversation.findUnique({ where: { directKey }, select: { id: true } });
    if (found) return found;
    try {
      return await this.prisma.chatConversation.create({
        data: { type: 'DIRECT', directKey, createdById: me, members: { create: [{ userId: me }, { userId }] } },
        select: { id: true },
      });
    } catch (err) {
      // both people started it at the same moment
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return this.prisma.chatConversation.findUniqueOrThrow({ where: { directKey }, select: { id: true } });
      throw err;
    }
  }

  private async activeUsers(ids: number[]) {
    return this.prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, name: true } });
  }

  /** A written-by-the-ERP line in the chat ("Kiran added Vijay"). */
  private async systemLine(conversationId: number, body: string) {
    const msg = await this.prisma.chatMessage.create({ data: { conversationId, body } });
    await this.prisma.chatConversation.update({ where: { id: conversationId }, data: { lastMessageAt: msg.createdAt } });
  }

  private async membersOf(conversationId: number) {
    return (await this.prisma.chatMember.findMany({ where: { conversationId, leftAt: null }, select: { userId: true } })).map((m) => m.userId);
  }

  private async changed(conversationId: number, extra: number[] = []) {
    this.live.send([...(await this.membersOf(conversationId)), ...extra], { type: 'chat-update', conversationId });
  }

  async group(me: number, myName: string, input: ChatGroupInput): Promise<{ id: number }> {
    const people = await this.activeUsers(input.memberIds.filter((id) => id !== me));
    if (!people.length) throw new BadRequestException({ message: 'Add at least one active user', errors: { memberIds: 'Add at least one person' } });
    const c = await this.prisma.chatConversation.create({
      data: { type: 'GROUP', name: input.name.trim(), createdById: me, members: { create: [{ userId: me, isAdmin: true }, ...people.map((p) => ({ userId: p.id }))] } },
      select: { id: true },
    });
    await this.systemLine(c.id, `${myName} made the group "${input.name.trim()}" with ${people.map((p) => p.name).join(', ')}`);
    await this.changed(c.id);
    return c;
  }

  /** Messages, newest page first (older pages with `before`), plus who has read up to where. */
  async thread(me: number, conversationId: number, before?: number): Promise<ChatThread> {
    await this.member(me, conversationId);
    const [c, unread, page] = await Promise.all([
      this.prisma.chatConversation.findUniqueOrThrow({ where: { id: conversationId }, include: this.include }),
      this.unreadByConversation(me),
      this.prisma.chatMessage.findMany({
        where: { conversationId, ...(before ? { id: { lt: before } } : {}) },
        orderBy: { id: 'desc' },
        take: PAGE + 1,
        include: { sender: { select: { name: true } } },
      }),
    ]);
    const messages: ChatMessageRow[] = page
      .slice(0, PAGE)
      .reverse()
      .map((m) => ({ id: m.id, senderId: m.senderId, senderName: m.sender?.name ?? null, body: m.deletedAt ? '' : m.body, createdAt: m.createdAt.toISOString(), deleted: !!m.deletedAt }));
    const readUpTo: Record<number, number> = {};
    for (const m of c.members) if (m.userId !== me && !m.leftAt && m.lastReadMessageId) readUpTo[m.userId] = m.lastReadMessageId;
    return {
      conversation: { ...this.row(c, me, unread.get(c.id) ?? 0), members: c.members.filter((m) => !m.leftAt).map((m) => ({ ...this.chatUser(m.user), isAdmin: m.isAdmin })) },
      messages,
      hasMore: page.length > PAGE,
      readUpTo,
    };
  }

  async send(me: number, conversationId: number, body: string): Promise<ChatMessageRow> {
    const mine = await this.member(me, conversationId);
    const c = await this.prisma.chatConversation.findUniqueOrThrow({ where: { id: conversationId }, include: { members: { where: { leftAt: null }, include: memberInclude } } });
    if (c.type === 'DIRECT' && c.members.some((m) => !m.user.isActive)) throw new BadRequestException('This user is no longer active');
    const msg = await this.prisma.chatMessage.create({ data: { conversationId, senderId: me, body }, include: { sender: { select: { name: true } } } });
    await Promise.all([
      this.prisma.chatConversation.update({ where: { id: conversationId }, data: { lastMessageAt: msg.createdAt } }),
      this.prisma.chatMember.update({ where: { id: mine.id }, data: { lastReadMessageId: msg.id } }),
    ]);
    const fromName = msg.sender?.name ?? null;
    this.live.send(
      c.members.map((m) => m.userId),
      { type: 'chat', conversationId, messageId: msg.id, from: me, fromName, title: c.type === 'DIRECT' ? (fromName ?? 'Chat') : (c.name ?? 'Group'), preview: body.slice(0, 120) },
    );
    return { id: msg.id, senderId: me, senderName: fromName, body: msg.body, createdAt: msg.createdAt.toISOString(), deleted: false };
  }

  /** I have seen the chat up to this message (others see the double tick). */
  async read(me: number, conversationId: number, messageId: number) {
    const mine = await this.member(me, conversationId);
    if (mine.lastReadMessageId && mine.lastReadMessageId >= messageId) return { ok: true };
    const exists = await this.prisma.chatMessage.findFirst({ where: { id: messageId, conversationId }, select: { id: true } });
    if (!exists) throw new BadRequestException('Unknown message');
    await this.prisma.chatMember.update({ where: { id: mine.id }, data: { lastReadMessageId: messageId } });
    await this.changed(conversationId);
    return { ok: true };
  }

  /** Delete my own message for everyone (it shows as "message deleted"). */
  async deleteMessage(me: number, messageId: number) {
    const msg = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!msg || msg.deletedAt) throw new NotFoundException('Message not found');
    if (msg.senderId !== me) throw new ForbiddenException('Only your own messages can be deleted');
    await this.member(me, msg.conversationId);
    await this.prisma.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date(), body: '' } });
    await this.changed(msg.conversationId);
  }

  private async groupAdmin(me: number, conversationId: number) {
    const m = await this.member(me, conversationId);
    const c = await this.prisma.chatConversation.findUniqueOrThrow({ where: { id: conversationId } });
    if (c.type !== 'GROUP') throw new BadRequestException('Only groups have members to change');
    if (!m.isAdmin) throw new ForbiddenException('Only the group admin can do this');
    return c;
  }

  async rename(me: number, myName: string, conversationId: number, name: string) {
    await this.groupAdmin(me, conversationId);
    await this.prisma.chatConversation.update({ where: { id: conversationId }, data: { name: name.trim() } });
    await this.systemLine(conversationId, `${myName} renamed the group to "${name.trim()}"`);
    await this.changed(conversationId);
  }

  async addMembers(me: number, myName: string, conversationId: number, userIds: number[]) {
    await this.groupAdmin(me, conversationId);
    const people = await this.activeUsers(userIds);
    for (const p of people) {
      await this.prisma.chatMember.upsert({
        where: { conversationId_userId: { conversationId, userId: p.id } },
        create: { conversationId, userId: p.id },
        update: { leftAt: null, joinedAt: new Date() },
      });
    }
    if (people.length) await this.systemLine(conversationId, `${myName} added ${people.map((p) => p.name).join(', ')}`);
    await this.changed(conversationId);
  }

  /** The admin removes someone, or anyone leaves (userId = me). The last admin leaving hands it to the oldest member. */
  async removeMember(me: number, myName: string, conversationId: number, userId: number) {
    if (userId === me) {
      const c = await this.prisma.chatConversation.findUniqueOrThrow({ where: { id: conversationId } });
      if (c.type !== 'GROUP') throw new BadRequestException('A one-to-one chat cannot be left');
      const mine = await this.member(me, conversationId);
      await this.prisma.chatMember.update({ where: { id: mine.id }, data: { leftAt: new Date(), isAdmin: false } });
      if (mine.isAdmin && !(await this.prisma.chatMember.count({ where: { conversationId, leftAt: null, isAdmin: true } }))) {
        const next = await this.prisma.chatMember.findFirst({ where: { conversationId, leftAt: null }, orderBy: { joinedAt: 'asc' } });
        if (next) await this.prisma.chatMember.update({ where: { id: next.id }, data: { isAdmin: true } });
      }
      await this.systemLine(conversationId, `${myName} left the group`);
      await this.changed(conversationId, [me]);
      return;
    }
    await this.groupAdmin(me, conversationId);
    const m = await this.prisma.chatMember.findUnique({ where: { conversationId_userId: { conversationId, userId } }, include: { user: { select: { name: true } } } });
    if (!m || m.leftAt) throw new NotFoundException('Not in this group');
    await this.prisma.chatMember.update({ where: { id: m.id }, data: { leftAt: new Date(), isAdmin: false } });
    await this.systemLine(conversationId, `${myName} removed ${m.user.name}`);
    await this.changed(conversationId, [userId]);
  }
}
