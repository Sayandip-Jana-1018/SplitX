import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { isFeatureEnabled } from '@/lib/featureFlags';

/**
 * POST /api/ai/chat — AI expense assistant powered by Gemini.
 * Gathers FULL financial context (balances, splits, settlements, analytics)
 * and returns intelligent responses based on real data.
 */

const CATEGORY_LABELS: Record<string, string> = {
    general: 'General', food: 'Food & Drinks', transport: 'Transport',
    shopping: 'Shopping', tickets: 'Tickets & Entry', fuel: 'Fuel',
    medical: 'Medical', entertainment: 'Entertainment', stay: 'Accommodation',
    other: 'Other',
};

export async function POST(req: Request) {
    try {
        if (!isFeatureEnabled('aiChat')) {
            return NextResponse.json({ error: 'AI Chat is disabled' }, { status: 403 });
        }

        const session = await auth();
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({ where: { email: session.user.email } });
        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const { message } = (await req.json()) as { message: string };
        if (!message?.trim()) {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }

        // ── Gather ALL financial context ──

        // 1. Get all groups the user belongs to
        const groups = await prisma.group.findMany({
            where: {
                OR: [
                    { ownerId: user.id },
                    { members: { some: { userId: user.id } } },
                ],
            },
            include: {
                members: { include: { user: { select: { id: true, name: true } } } },
                trips: {
                    select: {
                        id: true,
                        title: true,
                        isActive: true,
                        startDate: true,
                        endDate: true,
                    },
                },
            },
        });

        // 2. Get ALL trip IDs for this user
        const allTripIds = groups.flatMap(g => g.trips.map(t => t.id));

        // 3. Get all transactions across all groups
        const allTransactions = allTripIds.length > 0
            ? await prisma.transaction.findMany({
                where: { tripId: { in: allTripIds } },
                include: {
                    payer: { select: { id: true, name: true } },
                    splits: { include: { user: { select: { id: true, name: true } } } },
                },
                orderBy: { date: 'desc' },
            })
            : [];

        // 4. Get completed settlements
        const completedSettlements = allTripIds.length > 0
            ? await prisma.settlement.findMany({
                where: { tripId: { in: allTripIds }, status: 'completed' },
                include: {
                    from: { select: { id: true, name: true } },
                    to: { select: { id: true, name: true } },
                },
            })
            : [];

        // ── Compute REAL balances (same formula as dashboard) ──
        // balance > 0 → person is owed money (creditor)
        // balance < 0 → person owes money (debtor)

        // Per-group balances
        const groupSummaries: string[] = [];
        const overallBalances: Record<string, number> = {};
        const memberNames: Record<string, string> = {};

        for (const group of groups) {
            const groupTripIds = group.trips.map(t => t.id);
            const groupTxns = allTransactions.filter(t => groupTripIds.includes(t.tripId));
            const groupSettlements = completedSettlements.filter(s => groupTripIds.includes(s.tripId));

            // Calculate balances for this group
            const balances: Record<string, number> = {};
            for (const member of group.members) {
                balances[member.user.id] = 0;
                memberNames[member.user.id] = member.user.name || 'Unknown';
            }

            for (const txn of groupTxns) {
                balances[txn.payerId] = (balances[txn.payerId] || 0) + txn.amount;
                for (const split of txn.splits) {
                    balances[split.userId] = (balances[split.userId] || 0) - split.amount;
                }
            }

            // Account for completed settlements
            for (const s of groupSettlements) {
                balances[s.fromId] = (balances[s.fromId] || 0) + s.amount;
                balances[s.toId] = (balances[s.toId] || 0) - s.amount;
            }

            // Accumulate overall balances
            for (const [uid, bal] of Object.entries(balances)) {
                overallBalances[uid] = (overallBalances[uid] || 0) + bal;
            }

            // Compute who owes whom in this group (greedy netting)
            const debtors: { name: string; amount: number }[] = [];
            const creditors: { name: string; id: string; amount: number }[] = [];
            for (const [uid, bal] of Object.entries(balances)) {
                const name = memberNames[uid] || 'Unknown';
                if (bal < -1) debtors.push({ name, amount: -bal });
                else if (bal > 1) creditors.push({ name, id: uid, amount: bal });
            }

            const userBalance = balances[user.id] || 0;
            const memberList = group.members.map(m => m.user.name || 'Unknown').join(', ');

            // Build per-group detail
            const totalGroupSpent = groupTxns.reduce((s, t) => s + t.amount, 0);
            const userPaid = groupTxns.filter(t => t.payerId === user.id).reduce((s, t) => s + t.amount, 0);

            let balanceStr = '';
            if (userBalance > 1) {
                balanceStr = `User is OWED ₹${(userBalance / 100).toFixed(2)} overall in this group`;
            } else if (userBalance < -1) {
                balanceStr = `User OWES ₹${(Math.abs(userBalance) / 100).toFixed(2)} overall in this group`;
            } else {
                balanceStr = 'User is settled up in this group';
            }

            groupSummaries.push(
                `📌 Group: "${group.name}" (${group.members.length} members: ${memberList})\n` +
                `   Total spent: ₹${(totalGroupSpent / 100).toFixed(2)} | User paid: ₹${(userPaid / 100).toFixed(2)}\n` +
                `   ${balanceStr}`
            );
        }

        // ── Compute pairwise "who owes user" and "user owes whom" ──
        // Build pairwise ledger from all transactions
        const pairwise: Record<string, number> = {}; // pairwise[otherId] = net (+ means they owe user, - means user owes them)

        for (const txn of allTransactions) {
            if (txn.payerId === user.id) {
                // User paid → each split person owes user their split amount
                for (const split of txn.splits) {
                    if (split.userId !== user.id) {
                        pairwise[split.userId] = (pairwise[split.userId] || 0) + split.amount;
                    }
                }
            } else {
                // Someone else paid → user owes them if user has a split
                const userSplit = txn.splits.find(s => s.userId === user.id);
                if (userSplit) {
                    pairwise[txn.payerId] = (pairwise[txn.payerId] || 0) - userSplit.amount;
                }
            }
        }

        // Adjust for completed settlements
        for (const s of completedSettlements) {
            if (s.fromId === user.id) {
                // User paid a settlement TO someone → reduces what user owes them
                pairwise[s.toId] = (pairwise[s.toId] || 0) + s.amount;
            } else if (s.toId === user.id) {
                // Someone paid a settlement TO user → reduces what they owe user
                pairwise[s.fromId] = (pairwise[s.fromId] || 0) - s.amount;
            }
        }

        const peopleWhoOweUser: string[] = [];
        const userOwesPeople: string[] = [];
        let totalOwedToUser = 0;
        let totalUserOwes = 0;

        for (const [otherId, net] of Object.entries(pairwise)) {
            const name = memberNames[otherId] || 'Someone';
            if (net > 1) {
                peopleWhoOweUser.push(`${name} owes ₹${(net / 100).toFixed(2)}`);
                totalOwedToUser += net;
            } else if (net < -1) {
                userOwesPeople.push(`User owes ${name} ₹${(Math.abs(net) / 100).toFixed(2)}`);
                totalUserOwes += Math.abs(net);
            }
        }

        // ── Analytics ──
        const totalSpent = allTransactions
            .filter(t => t.payerId === user.id)
            .reduce((s, t) => s + t.amount, 0);

        const categorySpending = new Map<string, number>();
        for (const txn of allTransactions.filter(t => t.payerId === user.id)) {
            const cat = CATEGORY_LABELS[txn.category] || txn.category;
            categorySpending.set(cat, (categorySpending.get(cat) || 0) + txn.amount);
        }

        // Recent transactions
        const recentTxns = allTransactions.slice(0, 10).map(t => {
            const cat = CATEGORY_LABELS[t.category] || t.category;
            return `  • ${t.payer.name} paid ₹${(t.amount / 100).toFixed(2)} for "${t.title}" (${cat}) — split among ${t.splits.length} people`;
        }).join('\n');

        // Net balance
        const netBalance = overallBalances[user.id] || 0;
        let netBalanceStr: string;
        if (netBalance > 1) {
            netBalanceStr = `+₹${(netBalance / 100).toFixed(2)} (user is owed overall)`;
        } else if (netBalance < -1) {
            netBalanceStr = `-₹${(Math.abs(netBalance) / 100).toFixed(2)} (user owes overall)`;
        } else {
            netBalanceStr = '₹0 (all settled up)';
        }

        // ── Build comprehensive context ──
        const contextStr = `
═══ SplitX AI CONTEXT ═══
User: ${user.name || 'Unknown'}

── NET BALANCE ──
${netBalanceStr}

── WHO OWES THE USER (people who should pay the user) ──
${peopleWhoOweUser.length > 0
                ? peopleWhoOweUser.join('\n') + `\nTotal owed to user: ₹${(totalOwedToUser / 100).toFixed(2)}`
                : 'Nobody owes the user right now.'}

── USER OWES (people the user should pay) ──
${userOwesPeople.length > 0
                ? userOwesPeople.join('\n') + `\nTotal user owes: ₹${(totalUserOwes / 100).toFixed(2)}`
                : 'User doesn\'t owe anyone right now.'}

── GROUPS ──
${groupSummaries.length > 0 ? groupSummaries.join('\n\n') : 'User has no groups yet.'}

── SPENDING ANALYTICS ──
Total paid by user: ₹${(totalSpent / 100).toFixed(2)}
Category breakdown: ${Array.from(categorySpending.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([c, a]) => `${c}: ₹${(a / 100).toFixed(2)}`)
                .join(', ') || 'No spending yet'}

── RECENT TRANSACTIONS (last 10) ──
${recentTxns || 'No transactions yet.'}

Note: All amounts shown are in ₹ (INR). Internally stored in paise (100 paise = ₹1).
`.trim();

        // Check for Gemini API key
        const apiKey = process.env.GEMINI_API_KEY;
        let reply: string;

        if (apiKey) {
            reply = await callGemini(apiKey, contextStr, message);
        } else {
            reply = generateLocalResponse(message, {
                userName: user.name || 'there',
                netBalance,
                totalSpent,
                categorySpending,
                peopleWhoOweUser,
                userOwesPeople,
                totalOwedToUser,
                totalUserOwes,
                groups: groups.map(g => ({
                    name: g.name,
                    memberCount: g.members.length,
                    memberNames: g.members.map(m => m.user.name || 'Unknown'),
                })),
                recentTxns: allTransactions.slice(0, 5).map(t => ({
                    payer: t.payer.name || 'Unknown',
                    title: t.title,
                    amount: t.amount,
                    category: CATEGORY_LABELS[t.category] || t.category,
                    splitCount: t.splits.length,
                })),
            });
        }

        // Save chat messages
        try {
            await prisma.chatMessage.createMany({
                data: [
                    { userId: user.id, role: 'user', content: message },
                    { userId: user.id, role: 'assistant', content: reply },
                ],
            });
        } catch { /* graceful fallback */ }

        return NextResponse.json({ reply });
    } catch (error) {
        console.error('AI Chat error:', error);
        return NextResponse.json({ error: 'Something went wrong with AI chat' }, { status: 500 });
    }
}

/** Call Gemini API */
async function callGemini(apiKey: string, context: string, message: string): Promise<string> {
    const systemPrompt = `You are SplitX AI, the intelligent financial assistant inside SplitX — a premium expense-splitting app for groups and trips.

Your capabilities:
- Answer questions about who owes whom with exact amounts
- Provide spending analytics and category breakdowns
- Explain group balances and settlement suggestions
- Give financial tips and spending insights
- Be proactive: if someone asks "who owes me?", also mention how much they owe others for a complete picture

Response rules:
- Use ₹ for all amounts in INR
- Be concise but thorough (3-5 sentences max)
- Use emoji to make responses friendly and scannable
- When listing multiple people/amounts, use bullet points
- Always base answers on the REAL DATA provided below — never make up numbers
- If the data shows someone is owed money, say so clearly
- If asked about charts/analytics, summarize the category breakdown

Here is the user's REAL financial data:

${context}`;

    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `${systemPrompt}\n\nUser: ${message}` }] }],
                    generationConfig: { maxOutputTokens: 500, temperature: 0.7 },
                }),
            }
        );

        if (!res.ok) {
            console.error('Gemini API error:', res.status);
            return 'Sorry, I couldn\'t process that right now. Try again in a moment.';
        }

        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'I couldn\'t understand that. Try rephrasing?';
    } catch {
        return 'Sorry, I\'m having trouble connecting. Please try again.';
    }
}

/** Enhanced local fallback when no API key is set */
function generateLocalResponse(
    message: string,
    ctx: {
        userName: string;
        netBalance: number;
        totalSpent: number;
        categorySpending: Map<string, number>;
        peopleWhoOweUser: string[];
        userOwesPeople: string[];
        totalOwedToUser: number;
        totalUserOwes: number;
        groups: { name: string; memberCount: number; memberNames: string[] }[];
        recentTxns: { payer: string; title: string; amount: number; category: string; splitCount: number }[];
    }
): string {
    const msg = message.toLowerCase();

    // Who owes me?
    if (msg.includes('who owes') || msg.includes('owe me') || msg.includes('owed')) {
        if (ctx.peopleWhoOweUser.length === 0 && ctx.userOwesPeople.length === 0) {
            return `You're all settled up, ${ctx.userName}! 🎉 No one owes you and you don't owe anyone.`;
        }

        let response = '';
        if (ctx.peopleWhoOweUser.length > 0) {
            response += `💰 **People who owe you:**\n${ctx.peopleWhoOweUser.map(p => `• ${p}`).join('\n')}\n\nTotal owed to you: ₹${(ctx.totalOwedToUser / 100).toFixed(2)}`;
        } else {
            response += '✅ No one owes you right now.';
        }

        if (ctx.userOwesPeople.length > 0) {
            response += `\n\n💸 **You owe:**\n${ctx.userOwesPeople.map(p => `• ${p}`).join('\n')}\nTotal: ₹${(ctx.totalUserOwes / 100).toFixed(2)}`;
        }

        return response;
    }

    // What do I owe? / My debts
    if (msg.includes('i owe') || msg.includes('my debt') || msg.includes('do i owe')) {
        if (ctx.userOwesPeople.length === 0) {
            return `🎉 You're debt-free, ${ctx.userName}! No pending payments.`;
        }
        return `💸 **Your pending payments:**\n${ctx.userOwesPeople.map(p => `• ${p}`).join('\n')}\n\nTotal you owe: ₹${(ctx.totalUserOwes / 100).toFixed(2)}`;
    }

    // Balance / net
    if (msg.includes('balance') || msg.includes('net') || msg.includes('status') || msg.includes('summary') || msg.includes('overview')) {
        const netStr = ctx.netBalance > 1
            ? `+₹${(ctx.netBalance / 100).toFixed(2)} (you're owed overall) 📈`
            : ctx.netBalance < -1
                ? `-₹${(Math.abs(ctx.netBalance) / 100).toFixed(2)} (you owe overall) 📉`
                : '₹0 — all settled! ✅';

        let response = `📊 **Your Financial Summary**\n\nNet balance: ${netStr}\nTotal paid by you: ₹${(ctx.totalSpent / 100).toFixed(2)}`;

        if (ctx.peopleWhoOweUser.length > 0) {
            response += `\n\n💰 Owed to you: ₹${(ctx.totalOwedToUser / 100).toFixed(2)} from ${ctx.peopleWhoOweUser.length} person(s)`;
        }
        if (ctx.userOwesPeople.length > 0) {
            response += `\n💸 You owe: ₹${(ctx.totalUserOwes / 100).toFixed(2)} to ${ctx.userOwesPeople.length} person(s)`;
        }

        return response;
    }

    // Spending / analytics
    if (msg.includes('spend') || msg.includes('spent') || msg.includes('total') || msg.includes('analytics') || msg.includes('chart') || msg.includes('categor')) {
        if (ctx.totalSpent === 0) return 'No spending recorded yet. Start adding expenses! 📝';

        const catEntries = Array.from(ctx.categorySpending.entries())
            .sort((a, b) => b[1] - a[1]);

        const catStr = catEntries
            .map(([c, a]) => `• ${c}: ₹${(a / 100).toFixed(2)}`)
            .join('\n');

        const topCat = catEntries[0];
        return `📊 **Your Spending Breakdown**\n\nTotal paid: ₹${(ctx.totalSpent / 100).toFixed(2)}\n\n${catStr}\n\n🏆 Top category: ${topCat[0]} (₹${(topCat[1] / 100).toFixed(2)})`;
    }

    // Groups
    if (msg.includes('group')) {
        if (ctx.groups.length === 0) return 'You\'re not in any groups yet. Create one to start splitting! 🚀';
        const groupStr = ctx.groups.map(g =>
            `• **${g.name}** — ${g.memberCount} members (${g.memberNames.join(', ')})`
        ).join('\n');
        return `👥 **Your Groups (${ctx.groups.length})**\n\n${groupStr}`;
    }

    // Recent transactions
    if (msg.includes('recent') || msg.includes('transaction') || msg.includes('history') || msg.includes('activity')) {
        if (ctx.recentTxns.length === 0) return 'No transactions yet. Add your first expense! 📝';
        const txnStr = ctx.recentTxns.map(t =>
            `• ${t.payer} paid ₹${(t.amount / 100).toFixed(2)} for "${t.title}" (${t.category})`
        ).join('\n');
        return `🧾 **Recent Transactions**\n\n${txnStr}`;
    }

    // Settle / pay
    if (msg.includes('settle') || msg.includes('pay') || msg.includes('transfer')) {
        if (ctx.userOwesPeople.length === 0 && ctx.peopleWhoOweUser.length === 0) {
            return 'Everything is settled! No transfers needed. ✅';
        }
        let response = '💱 **Settlement Suggestions**\n\n';
        if (ctx.userOwesPeople.length > 0) {
            response += `You should pay:\n${ctx.userOwesPeople.map(p => `• ${p}`).join('\n')}\n\n`;
        }
        if (ctx.peopleWhoOweUser.length > 0) {
            response += `Remind these people to pay you:\n${ctx.peopleWhoOweUser.map(p => `• ${p}`).join('\n')}`;
        }
        return response;
    }

    // Greeting
    if (msg.includes('hi') || msg.includes('hello') || msg.includes('hey') || msg.includes('help')) {
        const netStr = ctx.netBalance > 1
            ? `You're owed ₹${(ctx.netBalance / 100).toFixed(2)} overall.`
            : ctx.netBalance < -1
                ? `You owe ₹${(Math.abs(ctx.netBalance) / 100).toFixed(2)} overall.`
                : 'All settled up!';
        return `Hey ${ctx.userName}! 👋 I'm your SplitX AI assistant.\n\n${netStr}\n\nTry asking:\n• "Who owes me?"\n• "My spending breakdown"\n• "Show my balance"\n• "Recent transactions"\n• "How to settle up?"`;
    }

    // Default
    return `I can help with:\n• 💰 "Who owes me?" — see who should pay you\n• 💸 "What do I owe?" — your pending payments\n• 📊 "My spending" — analytics & categories\n• 💱 "How to settle?" — settlement suggestions\n• 👥 "My groups" — group overview\n• 🧾 "Recent transactions" — latest activity`;
}
