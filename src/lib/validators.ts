import { z } from 'zod';
import { passwordProblem } from '@/lib/password';

// ── Auth ──
const passwordSchema = z.string().superRefine((password, context) => {
    const problem = passwordProblem(password);
    if (problem) context.addIssue({ code: 'custom', message: problem });
});

export const registerSchema = z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60, 'Name must be at most 60 characters'),
    email: z.string().trim().max(254).email('Please enter a valid email'),
    password: passwordSchema,
});
