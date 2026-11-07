/**
 * Made-up people and money, for designing the screens before the app talks to the server.
 * Phase 2 replaces this with the API; nothing here is ever sent anywhere. Amounts are paise.
 */

export const ME = { name: 'Asha Sharma', first: 'Asha' };

export const BALANCE = { netPaise: 4_204_912, owedToYouPaise: 4_231_412, youOwePaise: 26_500 };

export interface DemoGroup {
    id: string;
    name: string;
    emoji: string;
    members: string[];
    totalPaise: number;
    /** Positive: the group owes you. */
    yourPaise: number;
    active: string;
}

export const GROUPS: DemoGroup[] = [
    { id: 'goa', name: 'Goa Trip', emoji: '🏖️', members: ['Asha Sharma', 'Ravi Menon', 'Meera Iyer', 'Kabir Khan'], totalPaise: 3_440_550, yourPaise: 1_039_862, active: '2h ago' },
    { id: 'flat', name: 'Flat 402', emoji: '🏠', members: ['Asha Sharma', 'Nisha Rao', 'Ravi Menon'], totalPaise: 5_173_575, yourPaise: 3_117_550, active: 'Yesterday' },
    { id: 'ladakh', name: 'Ladakh 2026', emoji: '🏔️', members: ['Asha Sharma', 'Ravi Menon', 'Meera Iyer', 'Kabir Khan', 'Nisha Rao'], totalPaise: 4_280_000, yourPaise: 74_000, active: '3d ago' },
    { id: 'lunch', name: 'Office Lunch', emoji: '🍱', members: ['Asha Sharma', 'Kabir Khan', 'Nisha Rao', 'Meera Iyer'], totalPaise: 362_000, yourPaise: -26_500, active: 'Today' },
];

export interface DemoActivity {
    id: string;
    title: string;
    group: string;
    note: string;
    emoji: string;
    /** What it means for you: positive, you get it back. */
    yourPaise: number;
    when: string;
}

export const ACTIVITY: DemoActivity[] = [
    { id: 'a1', title: 'Beach shack dinner', group: 'Goa Trip', note: 'You paid ₹4,800', emoji: '🍤', yourPaise: 360_000, when: 'Today · 9:40 pm' },
    { id: 'a2', title: 'Thali for four', group: 'Office Lunch', note: 'Kabir paid ₹1,060', emoji: '🍛', yourPaise: -26_500, when: 'Today · 1:15 pm' },
    { id: 'a3', title: 'Scooter rental', group: 'Goa Trip', note: 'You paid ₹2,400', emoji: '🛵', yourPaise: 180_000, when: 'Yesterday' },
    { id: 'a4', title: 'Electricity bill', group: 'Flat 402', note: 'You paid ₹3,210', emoji: '💡', yourPaise: 214_000, when: 'Mon' },
    { id: 'a5', title: 'Kabir paid you back', group: 'Goa Trip', note: 'Settled by UPI', emoji: '✅', yourPaise: 0, when: 'Sun' },
];

export interface DemoTransfer {
    id: string;
    from: string;
    to: string;
    group: string;
    paise: number;
}

/** The fewest payments that clear every group you're in. */
export const TRANSFERS: DemoTransfer[] = [
    { id: 't1', from: 'Kabir Khan', to: 'You', group: 'Goa Trip', paise: 260_137 },
    { id: 't2', from: 'Ravi Menon', to: 'You', group: 'Flat 402', paise: 1_558_775 },
    { id: 't3', from: 'Meera Iyer', to: 'You', group: 'Goa Trip', paise: 247_138 },
    { id: 't4', from: 'You', to: 'Nisha Rao', group: 'Office Lunch', paise: 26_500 },
];
