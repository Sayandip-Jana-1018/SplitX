import type { AccountBalance } from '@/lib/settlementPlanner';
import { createRandom, type SeededRandom } from '@/lib/seededRandom';
import { equalShares } from '@/lib/splits';

/**
 * A simulated trip — members, expenses and the balances they leave — generated
 * deterministically from a seed, so the same request always yields the same
 * trip and the same plan.
 *
 * It lets the settlement preview run at any group size without anyone sending
 * thousands of expenses: the classroom demo, k6 and the benchmark all use it.
 * Equal splits use the same `equalShares` as real expenses, and the balances
 * go through the same planner as a real group's.
 */

export const MIN_SCENARIO_MEMBERS = 2;
export const MAX_SCENARIO_MEMBERS = 2000;

const EXPENSES_PER_MEMBER = 3;
const MAX_PEOPLE_PER_EXPENSE = 8;
const LOG_MIN_EXPENSE = Math.log(4_000); // ₹40
const LOG_MAX_EXPENSE = Math.log(1_200_000); // ₹12,000

const FIRST_NAMES = [
    'Aarav', 'Diya', 'Kabir', 'Ananya', 'Vihaan', 'Isha', 'Arjun', 'Meera', 'Rohan', 'Saanvi',
    'Aditya', 'Priya', 'Karan', 'Nisha', 'Rahul', 'Tara', 'Dev', 'Kavya', 'Neel', 'Riya',
    'Sameer', 'Zoya', 'Ishaan', 'Pooja', 'Vikram', 'Anika', 'Siddharth', 'Myra', 'Aryan', 'Sneha',
];

export interface SimulatedTrip {
    members: { id: string; name: string }[];
    balances: AccountBalance[];
    expenseCount: number;
    totalSpent: number;
    /** Payments needed if every share were repaid straight to whoever paid, netted per pair of people. */
    directTransferCount: number;
}

export function simulateTrip(memberCount: number, seed: number): SimulatedTrip {
    if (!Number.isInteger(memberCount) || memberCount < MIN_SCENARIO_MEMBERS || memberCount > MAX_SCENARIO_MEMBERS) {
        throw new RangeError(`A simulated trip has ${MIN_SCENARIO_MEMBERS}–${MAX_SCENARIO_MEMBERS} members`);
    }

    const random = createRandom(seed);
    const members = Array.from({ length: memberCount }, (_, i) => ({ id: `m${i + 1}`, name: memberName(i, memberCount) }));
    const balances = new Float64Array(memberCount);
    // Net amount owed between each pair of people: key = lower index × count + higher
    // index; positive when the lower-indexed person owes the higher one.
    const owedBetween = new Map<number, number>();
    // A few people pay for most things, as on real trips.
    const organisers = Math.max(1, Math.round(memberCount / 5));
    const expenseCount = memberCount * EXPENSES_PER_MEMBER;
    let totalSpent = 0;

    for (let expense = 0; expense < expenseCount; expense++) {
        const payer = random.next() < 0.6 ? random.int(0, organisers - 1) : random.int(0, memberCount - 1);
        const people = new Set([payer]);
        const size = random.int(2, Math.min(MAX_PEOPLE_PER_EXPENSE, memberCount));
        while (people.size < size) people.add(random.int(0, memberCount - 1));
        const participants = [...people].sort((a, b) => a - b);

        // Most purchases are small: log-uniform between ₹40 and ₹12,000, in ₹10 steps.
        const amount = Math.max(1_000, Math.round(Math.exp(LOG_MIN_EXPENSE + random.next() * (LOG_MAX_EXPENSE - LOG_MIN_EXPENSE)) / 1_000) * 1_000);
        const shares = random.next() < 0.8 ? equalShares(amount, participants.length) : itemisedShares(amount, participants.length, random);

        totalSpent += amount;
        balances[payer] += amount;
        participants.forEach((person, i) => {
            balances[person] -= shares[i];
            if (person === payer) return;
            const key = Math.min(person, payer) * memberCount + Math.max(person, payer);
            owedBetween.set(key, (owedBetween.get(key) ?? 0) + (person < payer ? shares[i] : -shares[i]));
        });
    }

    let directTransferCount = 0;
    for (const net of owedBetween.values()) if (net !== 0) directTransferCount += 1;

    return {
        members,
        balances: members.map((member, i) => ({ id: member.id, amount: balances[i] })),
        expenseCount,
        totalSpent,
        directTransferCount,
    };
}

/** Uneven shares, like an itemised bill: weights of 1–3, remainder to the first person. */
function itemisedShares(amount: number, count: number, random: SeededRandom) {
    const weights = Array.from({ length: count }, () => random.int(1, 3));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const shares = weights.map((weight) => Math.floor((amount * weight) / totalWeight));
    shares[0] += amount - shares.reduce((sum, share) => sum + share, 0);
    return shares;
}

function memberName(index: number, memberCount: number) {
    const name = FIRST_NAMES[index % FIRST_NAMES.length];
    return memberCount <= FIRST_NAMES.length ? name : `${name} ${Math.floor(index / FIRST_NAMES.length) + 1}`;
}
