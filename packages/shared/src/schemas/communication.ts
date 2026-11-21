import { z } from 'zod';
import { id, optionalText, text } from './common';

// ---------------------------------------------------------------- chat

export const CHAT_MESSAGE_MAX = 2000;
export const chatMessageSchema = z.object({ body: z.string().trim().min(1, 'Type a message').max(CHAT_MESSAGE_MAX, `At most ${CHAT_MESSAGE_MAX} letters`) });
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

export const chatDirectSchema = z.object({ userId: id() });
export const chatGroupSchema = z.object({
  name: text(100),
  memberIds: z.array(z.coerce.number().int().positive()).min(1, 'Add at least one person').max(200),
});
export type ChatGroupInput = z.infer<typeof chatGroupSchema>;
export const chatRenameSchema = z.object({ name: text(100) });
export const chatMembersSchema = z.object({ userIds: z.array(z.coerce.number().int().positive()).min(1, 'Choose someone').max(200) });
export const chatReadSchema = z.object({ messageId: id() });

// ---------------------------------------------------------------- notifications

/** TASK = made by the ERP when work reaches someone; NOTICE = sent by a user. */
export const NOTIFICATION_KINDS = ['TASK', 'NOTICE'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTICE_TARGETS = ['ALL', 'ROLES', 'USERS'] as const;
export const NOTICE_TARGET_LABELS: Record<(typeof NOTICE_TARGETS)[number], string> = { ALL: 'Everyone', ROLES: 'Departments (roles)', USERS: 'Chosen people' };

/** A notice sent by a user to everyone, some roles or some people. */
export const noticeSchema = z
  .object({
    title: text(150),
    body: optionalText(500),
    /** A screen of the ERP to open, e.g. /sales/orders/12 */
    link: z.union([z.literal(''), z.string().trim().max(255).regex(/^\/[^\s]*$/, 'A screen address starting with /, e.g. /sales/orders')]).optional(),
    target: z.enum(NOTICE_TARGETS),
    roleIds: z.array(z.coerce.number().int().positive()).max(100).optional(),
    userIds: z.array(z.coerce.number().int().positive()).max(1000).optional(),
  })
  .refine((v) => v.target !== 'ROLES' || !!v.roleIds?.length, { path: ['roleIds'], message: 'Choose at least one role' })
  .refine((v) => v.target !== 'USERS' || !!v.userIds?.length, { path: ['userIds'], message: 'Choose at least one person' });
export type NoticeInput = z.infer<typeof noticeSchema>;

// ---------------------------------------------------------------- shapes the API returns

export interface ChatUser {
  id: number;
  name: string;
  role: string;
  online: boolean;
}

export interface ChatConversationRow {
  id: number;
  type: 'DIRECT' | 'GROUP';
  /** Group name, or the other person's name for a direct chat. */
  title: string;
  /** The other person (direct chats). */
  other: ChatUser | null;
  memberCount: number;
  isAdmin: boolean;
  lastMessage: { body: string; senderName: string | null; mine: boolean; at: string } | null;
  unread: number;
}

export interface ChatMessageRow {
  id: number;
  senderId: number | null;
  senderName: string | null;
  body: string;
  createdAt: string;
  deleted: boolean;
}

export interface ChatThread {
  conversation: ChatConversationRow & { members: (ChatUser & { isAdmin: boolean })[] };
  messages: ChatMessageRow[];
  /** More, older messages exist. */
  hasMore: boolean;
  /** Highest message id each other member has read (for the "seen" ticks). */
  readUpTo: Record<number, number>;
}

export interface NotificationRow {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  sender: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Messages pushed to open screens over the live connection. */
export type LiveEvent =
  | { type: 'chat'; conversationId: number; messageId: number; from: number | null; fromName: string | null; title: string; preview: string }
  /** Read / deleted / members changed: reload that chat. */
  | { type: 'chat-update'; conversationId: number }
  | { type: 'notification'; title: string; body: string | null; link: string | null }
  | { type: 'presence'; userId: number; online: boolean };
