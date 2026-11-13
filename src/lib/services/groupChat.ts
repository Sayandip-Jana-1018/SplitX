import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * A group's chat, for every caller: the website's /api/groups/:groupId/messages
 * and the phone's /api/v1/groups/:groupId/messages (docs/mobile/ROADMAP.md,
 * Phase 2 step 3).
 */

/** A refusal: a sentence for the person, a status, and a code the app can act on. */
export class ChatRefused extends Error {
    constructor(message: string, readonly status: number, readonly code: string) {
        super(message);
    }
}

const messageInclude = {
    sender: { select: { id: true, name: true, image: true } },
    settlement: {
        select: {
            id: true,
            amount: true,
            status: true,
            from: { select: { id: true, name: true } },
            to: { select: { id: true, name: true } },
        },
    },
    transaction: {
        select: {
            id: true,
            title: true,
            amount: true,
            category: true,
        },
    },
} as const;

export type ChatMessageRow = Prisma.GroupMessageGetPayload<{ include: typeof messageInclude }>;

/** The group if `userId` is a current member of it (a deleted group's chat is gone too). */
function memberGroup(userId: string, groupId: string) {
    return prisma.group.findFirst({
        where: {
            id: groupId,
            deletedAt: null,
            OR: [
                { ownerId: userId },
                { members: { some: { userId } } },
            ],
        },
        select: {
            id: true,
            name: true,
            ownerId: true,
            members: { select: { userId: true } },
        },
    });
}

/**
 * A page of messages, oldest first, ending at the newest (or just before
 * `cursor`, the id the previous page gave). Null if you aren't in the group.
 */
export async function listGroupMessages(userId: string, groupId: string, page: { cursor?: string | null; limit: number }) {
    if (!(await memberGroup(userId, groupId))) return null;
    const messages = await prisma.groupMessage.findMany({
        where: { groupId },
        orderBy: { createdAt: 'desc' },
        take: page.limit + 1, // fetch one extra to know if there's more
        ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
        include: messageInclude,
    });
    const hasMore = messages.length > page.limit;
    const newestFirst = hasMore ? messages.slice(0, page.limit) : messages;
    // The next page starts before the oldest message on this one.
    const nextCursor = hasMore ? newestFirst[newestFirst.length - 1]?.id ?? null : null;
    return { messages: [...newestFirst].reverse(), nextCursor, hasMore };
}

export interface ChatSend {
    content: string;
    type: 'text' | 'payment_reminder';
    targetUserId?: string;
}

/**
 * Sends a message as `actor`. People send text and payment reminders; system
 * messages, and messages carrying a settlement or an expense, are written by
 * the server alone, so no client can post a fake "✅ confirmed" or attach
 * another group's money. At most 5 messages per 10 seconds per person per group.
 */
export async function sendGroupMessage(actor: { id: string; name: string | null }, groupId: string, input: ChatSend): Promise<ChatMessageRow> {
    const group = await memberGroup(actor.id, groupId);
    if (!group) throw new ChatRefused('Not a member of this group', 403, 'not_member');

    if (input.type === 'payment_reminder') {
        if (!input.targetUserId) throw new ChatRefused('A target user is required for payment reminders', 400, 'no_target');
        const allowedTargetIds = new Set<string>([group.ownerId, ...group.members.map((member) => member.userId)]);
        if (!allowedTargetIds.has(input.targetUserId)) throw new ChatRefused('Target user is not a member of this group', 400, 'bad_target');
    }

    // Rate limit: max 5 messages per 10 seconds per user per group
    const tenSecondsAgo = new Date(Date.now() - 10_000);
    const recentCount = await prisma.groupMessage.count({
        where: { groupId, senderId: actor.id, createdAt: { gte: tenSecondsAgo } },
    });
    if (recentCount >= 5) throw new ChatRefused('Slow down! You\'re sending messages too quickly.', 429, 'too_fast');

    const message = await prisma.groupMessage.create({
        data: { groupId, senderId: actor.id, content: input.content, type: input.type },
        include: messageInclude,
    });

    // For payment_reminder type → also create a notification for the target user
    if (input.type === 'payment_reminder' && input.targetUserId) {
        await prisma.notification.create({
            data: {
                user: { connect: { id: input.targetUserId } },
                type: 'payment_reminder',
                title: 'Payment Reminder',
                body: `${actor.name || 'Someone'} sent you a payment reminder in ${group.name}.`,
                link: `/groups/${groupId}`,
            },
        });
    }
    return message;
}
