import { z } from 'zod';
import { passwordProblem } from '@/lib/password';

// ── Auth ──
export const passwordSchema = z.string().superRefine((password, context) => {
    const problem = passwordProblem(password);
    if (problem) context.addIssue({ code: 'custom', message: problem });
});

export const registerSchema = z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60, 'Name must be at most 60 characters'),
    email: z.string().trim().max(254).email('Please enter a valid email'),
    password: passwordSchema,
});

export const loginSchema = z.object({
    email: z.string().email('Please enter a valid email'),
    password: z.string().min(1, 'Password is required'),
});

// ── Group ──
export const createGroupSchema = z.object({
    name: z.string().min(1, 'Group name is required').max(50),
    emoji: z.string().default('✈️'),
});

// ── Trip ──
export const createTripSchema = z.object({
    groupId: z.string().cuid(),
    title: z.string().min(1, 'Trip title is required').max(100),
    description: z.string().max(500).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    currency: z.string().default('INR'),
});

// ── Settlement ──
export const markSettlementSchema = z.object({
    settlementId: z.string().cuid(),
    method: z.string().optional(),
    note: z.string().max(200).optional(),
});

// Types
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type CreateTripInput = z.infer<typeof createTripSchema>;
