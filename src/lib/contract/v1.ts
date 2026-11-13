import { z } from 'zod';

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
