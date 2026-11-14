import { z } from 'zod';
import { MAX_EXPENSE_PAISE, SPLIT_TYPES } from '@/lib/expenseSplits';
import { IDEMPOTENCY_KEY_PATTERN } from '@/lib/idempotency';

/**
 * The phone app's API, version 1: what each request sends and each answer
 * holds. The server checks requests against these, the contract tests check
 * answers against them, and the app reads the same file, so the two sides
 * can't drift apart unnoticed.
 *
 * Errors always answer `{ error, code }`: `error` is a sentence to show,
 * `code` is for the app to act on (for example "reused" means sign in again).
 */

export const ErrorBody = z.object({ error: z.string(), code: z.string() });
export type ErrorBody = z.infer<typeof ErrorBody>;

export const DeviceDetails = z.object({
    /** The id the server gave this phone before, to keep one device row. */
    deviceId: z.string().max(64).nullish(),
    platform: z.enum(['android', 'ios']),
    name: z.string().trim().max(80).nullish(),
    appVersion: z.string().trim().max(32).nullish(),
});
export type DeviceDetails = z.infer<typeof DeviceDetails>;

export const PasswordSignIn = z.object({
    email: z.string().trim().min(3).max(254),
    password: z.string().min(1).max(1000),
    device: DeviceDetails,
});
export type PasswordSignIn = z.infer<typeof PasswordSignIn>;

export const GoogleSignIn = z.object({
    /** The ID token Google's sign-in gave the phone, for the website's Google client. */
    idToken: z.string().min(20).max(8192),
    device: DeviceDetails,
});
export type GoogleSignIn = z.infer<typeof GoogleSignIn>;

export const RefreshRequest = z.object({ refreshToken: z.string().min(20).max(200) });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const TokenPair = z.object({
    accessToken: z.string(),
    accessExpiresAt: z.string(),
    refreshToken: z.string(),
    refreshExpiresAt: z.string(),
    deviceId: z.string(),
});
export type TokenPair = z.infer<typeof TokenPair>;

export const Me = z.object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    image: z.string().nullable(),
    upiId: z.string().nullable(),
});
export type Me = z.infer<typeof Me>;

/** What a successful sign-in answers. */
export const Session = z.object({ tokens: TokenPair, me: Me });
export type Session = z.infer<typeof Session>;

/** What a refresh answers. */
export const Refreshed = z.object({ tokens: TokenPair });
export type Refreshed = z.infer<typeof Refreshed>;

/** What GET /api/v1/me answers. */
export const MeAnswer = z.object({ me: Me });
export type MeAnswer = z.infer<typeof MeAnswer>;

// ── Reads ───────────────────────────────────────────────────

/** Amounts are whole paise, as the server stores them. Times are ISO 8601. */
const Paise = z.number().int();

const Person = z.object({ id: z.string(), name: z.string(), image: z.string().nullable() });

export const GroupSummary = z.object({
    id: z.string(),
    name: z.string(),
    emoji: z.string(),
    members: z.array(Person),
    /** Positive: the group owes you. Negative: you owe the group. */
    myBalance: Paise,
    totalSpent: Paise,
    lastActivityAt: z.string().nullable(),
});
export type GroupSummary = z.infer<typeof GroupSummary>;

export const GroupList = z.object({ groups: z.array(GroupSummary) });
export type GroupList = z.infer<typeof GroupList>;

const PersonBalance = Person.extend({
    upiId: z.string().nullable(),
    balance: Paise,
    /** False for someone who has left but still owes or is owed. */
    isMember: z.boolean(),
});

/** One payment of the fewest that settle the group. */
const Transfer = z.object({ fromId: z.string(), toId: z.string(), amount: Paise, toUpiId: z.string().nullable() });

export const GroupDetail = z.object({ group: GroupSummary, people: z.array(PersonBalance), transfers: z.array(Transfer) });
export type GroupDetail = z.infer<typeof GroupDetail>;

export const ActivityItem = z.object({
    id: z.string(),
    kind: z.enum(['expense', 'settlement']),
    groupId: z.string(),
    /** An expense's title; empty for a settlement, which the app words from the names. */
    title: z.string(),
    category: z.string(),
    amount: Paise,
    /** Who paid the expense, or who sent the settlement. */
    actorId: z.string(),
    actorName: z.string(),
    /** Who received a settlement; null for an expense. */
    otherId: z.string().nullable(),
    otherName: z.string().nullable(),
    /** What it did to your balance: an expense you paid for raises it, a payment you received lowers it. */
    yours: Paise,
    /** A settlement's status (pending ones don't move balances yet); null for an expense. */
    status: z.string().nullable(),
    at: z.string(),
});
export type ActivityItem = z.infer<typeof ActivityItem>;

export const ActivityQuery = z.object({
    groupId: z.string().max(64).optional(),
    /** Where the previous page ended: its `nextBefore`, as given. */
    before: z.string().max(160).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ActivityQuery = z.infer<typeof ActivityQuery>;

export const ActivityPage = z.object({ items: z.array(ActivityItem), nextBefore: z.string().nullable() });
export type ActivityPage = z.infer<typeof ActivityPage>;

// ── Writes ──────────────────────────────────────────────────

const Share = z.object({ userId: z.string().max(64), amount: z.number().int().nonnegative() });

export const NewExpense = z.object({
    /** Made on the phone (a UUID), and the save's key: a retried save never makes a second expense. */
    clientId: z.string().regex(IDEMPOTENCY_KEY_PATTERN),
    groupId: z.string().max(64),
    title: z.string().trim().min(1).max(100),
    amount: z.number().int().positive().max(MAX_EXPENSE_PAISE),
    category: z.string().min(1).max(40).default('general'),
    /** Who paid; you, when left out. */
    payerId: z.string().max(64).optional(),
    splitType: z.enum(SPLIT_TYPES).default('equal'),
    /** Equal splits: who shares it; everyone, when left out. */
    splitAmong: z.array(z.string().max(64)).max(200).optional(),
    /** Percentage and custom splits: each share, in paise. */
    splits: z.array(Share).max(200).optional(),
});
export type NewExpense = z.infer<typeof NewExpense>;

export const Expense = z.object({
    id: z.string(),
    groupId: z.string(),
    title: z.string(),
    amount: Paise,
    category: z.string(),
    payerId: z.string(),
    splitType: z.string(),
    splits: z.array(Share),
    createdAt: z.string(),
});
export type Expense = z.infer<typeof Expense>;

/** What saving an expense answers; `replayed` when it was saved before under the same clientId. */
export const ExpenseSaved = z.object({ expense: Expense, replayed: z.boolean() });
export type ExpenseSaved = z.infer<typeof ExpenseSaved>;

export const NewSettlement = z.object({
    groupId: z.string().max(64),
    toUserId: z.string().max(64),
    /** Set when you are the receiver, recording a payment made to you (cash, say). */
    fromUserId: z.string().max(64).optional(),
    amount: z.number().int().positive().max(2_147_483_647),
    method: z.string().trim().min(1).max(40).default('upi'),
    note: z.string().max(500).optional(),
});
export type NewSettlement = z.infer<typeof NewSettlement>;

/**
 * One step of a settlement. The payer: open_upi (answers the UPI link), mark_paid.
 * The receiver: approve, send_back, mark_received, accept_cash, decline.
 */
export const SettlementMove = z.object({
    action: z.enum(['open_upi', 'mark_paid', 'approve', 'send_back', 'mark_received', 'accept_cash', 'decline']),
    /** mark_paid: it was cash, not UPI. */
    cash: z.boolean().optional(),
    /** mark_paid: the UPI reference the payer's app showed. */
    utrNumber: z.string().trim().max(40).optional(),
});
export type SettlementMove = z.infer<typeof SettlementMove>;

export const Settlement = z.object({
    id: z.string(),
    groupId: z.string(),
    fromId: z.string(),
    toId: z.string(),
    amount: Paise,
    /** pending, initiated, paid_pending (waiting for the receiver), completed or cancelled. */
    status: z.string(),
    method: z.string().nullable(),
    note: z.string().nullable(),
    createdAt: z.string(),
});
export type Settlement = z.infer<typeof Settlement>;

/** `reused` when an identical request was already open: a retry never makes two. */
export const SettlementSaved = z.object({ settlement: Settlement, reused: z.boolean() });
export type SettlementSaved = z.infer<typeof SettlementSaved>;

/** After a step; `upiUrl` only after open_upi. */
export const SettlementMoved = z.object({ settlement: Settlement, upiUrl: z.string().nullable() });
export type SettlementMoved = z.infer<typeof SettlementMoved>;

export const ChatMessage = z.object({
    id: z.string(),
    senderId: z.string(),
    senderName: z.string().nullable(),
    /** text and payment_reminder from people; system and expense_added from the server. */
    type: z.string(),
    content: z.string(),
    settlementId: z.string().nullable(),
    transactionId: z.string().nullable(),
    createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** Oldest first; `nextCursor` asks for the page before it. */
export const MessagePage = z.object({ messages: z.array(ChatMessage), nextCursor: z.string().nullable() });
export type MessagePage = z.infer<typeof MessagePage>;

export const NewMessage = z.object({
    content: z.string().trim().min(1).max(1000),
    type: z.enum(['text', 'payment_reminder']).default('text'),
    /** payment_reminder: who is reminded. */
    targetUserId: z.string().max(64).optional(),
});
export type NewMessage = z.infer<typeof NewMessage>;

export const MessageSent = z.object({ message: ChatMessage });
export type MessageSent = z.infer<typeof MessageSent>;

// ── Sync (Phase 2 step 5) ───────────────────────────────────

/**
 * The phone keeps each of your groups whole and says which version it holds;
 * the server answers with every group you're in now and, in full, only those
 * that changed (or that the phone hasn't got). A group missing from `groupIds`
 * is one you are no longer in.
 */
export const SyncRequest = z.object({
    known: z.record(z.string().max(64), z.string().max(64)).default({}).refine((known) => Object.keys(known).length <= 500, 'Too many groups'),
});
export type SyncRequest = z.infer<typeof SyncRequest>;

const SyncPerson = Person.extend({
    upiId: z.string().nullable(),
    /** False for someone who has left but appears in the group's history. */
    isMember: z.boolean(),
});

const SyncExpense = z.object({
    id: z.string(),
    title: z.string(),
    category: z.string(),
    amount: Paise,
    payerId: z.string(),
    splitType: z.string(),
    splits: z.array(Share),
    receiptUrl: z.string().nullable(),
    createdAt: z.string(),
});

const SyncSettlement = z.object({
    id: z.string(),
    fromId: z.string(),
    toId: z.string(),
    amount: Paise,
    /** Only completed ones move balances; the rest are on their way. */
    status: z.string(),
    method: z.string().nullable(),
    note: z.string().nullable(),
    createdAt: z.string(),
});

export const SyncGroup = z.object({
    id: z.string(),
    /** Changes whenever anything below does. */
    version: z.string(),
    name: z.string(),
    emoji: z.string(),
    ownerId: z.string(),
    people: z.array(SyncPerson),
    /** Oldest first. */
    expenses: z.array(SyncExpense),
    /** Newest first, in any status. */
    settlements: z.array(SyncSettlement),
});
export type SyncGroup = z.infer<typeof SyncGroup>;

export const SyncAnswer = z.object({ groupIds: z.array(z.string()), changed: z.array(SyncGroup) });
export type SyncAnswer = z.infer<typeof SyncAnswer>;

// ── Sign-in, like real apps (Phase 2 step 4) ────────────────

const Email = z.string().trim().max(254).email('Enter a valid email address');
const SixDigits = z.string().regex(/^\d{6}$/, 'The code is 6 digits');

/** Emails a 6-digit code: to sign in without a password, to confirm a new account again, or to reset a password. */
export const EmailCodeRequest = z.object({ email: Email, purpose: z.enum(['sign_in', 'confirm_sign_up', 'password_reset']).default('sign_in') });
export type EmailCodeRequest = z.infer<typeof EmailCodeRequest>;

export const EmailCodeSignIn = z.object({
    email: Email,
    code: SixDigits,
    /** confirm_sign_up after creating an account; sign_in otherwise. */
    purpose: z.enum(['sign_in', 'confirm_sign_up']).default('sign_in'),
    device: DeviceDetails,
});
export type EmailCodeSignIn = z.infer<typeof EmailCodeSignIn>;

/** A sign-in that may be the account's first: `isNew` means the app asks for a name. */
export const CodeSession = Session.extend({ isNew: z.boolean() });
export type CodeSession = z.infer<typeof CodeSession>;

export const SignUp = z.object({
    name: z.string().trim().min(2, 'Use at least 2 characters for your name').max(60, 'Use at most 60 characters for your name'),
    email: Email,
    password: z.string().min(1).max(1000),
    device: DeviceDetails,
});
export type SignUp = z.infer<typeof SignUp>;

/** `codeSent`: a confirmation code is on its way, then EmailCodeSignIn with confirm_sign_up. Else signed in already. */
export const SignUpAnswer = z.object({ codeSent: z.boolean(), session: Session.nullable() });
export type SignUpAnswer = z.infer<typeof SignUpAnswer>;

export const PasswordResetWithCode = z.object({ email: Email, code: SixDigits, password: z.string().min(1).max(1000), device: DeviceDetails });
export type PasswordResetWithCode = z.infer<typeof PasswordResetWithCode>;

/** The code the website handed back after Google or GitHub, with the PKCE verifier only this phone holds. */
export const HandoffExchange = z.object({
    code: z.string().min(20).max(200),
    verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
    device: DeviceDetails,
});
export type HandoffExchange = z.infer<typeof HandoffExchange>;

/** The website's own profile rules (PATCH /api/me). */
export const ProfileUpdate = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    upiId: z.string().trim().max(100).regex(/^[\w.-]+@[\w]+$/, 'Invalid UPI ID format (e.g. name@bank)').optional().or(z.literal('')),
});
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;
