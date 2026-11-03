'use client';

import type { ReactNode } from 'react';
import type { IconType } from 'react-icons';
import { SiGooglepay, SiPhonepe, SiPaytm } from 'react-icons/si';
import { BsCashCoin, BsCreditCard2Back, BsPhone } from 'react-icons/bs';
import {
    MdFastfood,
    MdDirectionsCar,
    MdHotel,
    MdShoppingBag,
    MdLocalGasStation,
    MdLocalHospital,
    MdSportsEsports,
    MdConfirmationNumber,
    MdCategory,
    MdMoreHoriz,
    MdLocalGroceryStore,
    MdReceiptLong,
} from 'react-icons/md';

interface IconConfig {
    /** Pre-rendered icon element (legacy consumers) */
    icon: ReactNode;
    /** Icon component for custom sizing */
    Icon: IconType;
    label: string;
    color: string;
}

function iconConfig(Icon: IconType, label: string, color: string, size = 20): IconConfig {
    return { Icon, icon: <Icon size={size} />, label, color };
}

// ── Payment methods (brand colours) ──
const PAYMENT_ICONS: Record<string, IconConfig> = {
    cash: iconConfig(BsCashCoin, 'Cash', 'var(--accent-strong)', 18),
    gpay: iconConfig(SiGooglepay, 'Google Pay', 'var(--accent-strong)'),
    phonepe: iconConfig(SiPhonepe, 'PhonePe', 'var(--accent-strong)', 18),
    paytm: iconConfig(SiPaytm, 'Paytm', 'var(--accent-strong)', 18),
    upi_other: iconConfig(BsPhone, 'Other UPI', 'var(--accent-strong)', 18),
    upi: iconConfig(BsPhone, 'UPI', 'var(--accent-strong)', 18),
    card: iconConfig(BsCreditCard2Back, 'Card', 'var(--accent-strong)', 18),
};

// ── Categories ──
const CATEGORY_ICONS: Record<string, IconConfig> = {
    general: iconConfig(MdCategory, 'General', 'var(--accent-strong)'),
    food: iconConfig(MdFastfood, 'Food & Drinks', 'var(--accent-strong)'),
    groceries: iconConfig(MdLocalGroceryStore, 'Groceries', 'var(--accent-strong)'),
    transport: iconConfig(MdDirectionsCar, 'Transport', 'var(--accent-strong)'),
    fuel: iconConfig(MdLocalGasStation, 'Fuel', 'var(--accent-strong)'),
    stay: iconConfig(MdHotel, 'Stay', 'var(--accent-strong)'),
    shopping: iconConfig(MdShoppingBag, 'Shopping', 'var(--accent-strong)'),
    tickets: iconConfig(MdConfirmationNumber, 'Tickets & Entry', 'var(--accent-strong)'),
    entertainment: iconConfig(MdSportsEsports, 'Entertainment', 'var(--accent-strong)'),
    bills: iconConfig(MdReceiptLong, 'Bills', 'var(--accent-strong)'),
    medical: iconConfig(MdLocalHospital, 'Medical', 'var(--accent-strong)'),
    other: iconConfig(MdMoreHoriz, 'Other', 'var(--accent-strong)'),
};

const CATEGORY_ALIASES: Record<string, string> = {
    accommodation: 'stay',
    hotel: 'stay',
    health: 'medical',
    grocery: 'groceries',
    travel: 'transport',
    dining: 'food',
    restaurant: 'food',
    utilities: 'bills',
};

/** Resolve a category (including aliases and custom labels) to its visual config. */
export function getCategoryConfig(category?: string | null): IconConfig & { key: string } {
    const raw = (category || 'general').trim();
    const lower = raw.toLowerCase();
    const key = CATEGORY_ICONS[lower] ? lower : CATEGORY_ALIASES[lower];
    if (key && CATEGORY_ICONS[key]) return { ...CATEGORY_ICONS[key], key };
    return { ...CATEGORY_ICONS.general, label: raw || 'General', key: 'general' };
}

export function PaymentIcon({ method, size = 18 }: { method: string; size?: number }) {
    const config = PAYMENT_ICONS[method] || PAYMENT_ICONS.cash;
    const Icon = config.Icon;
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: config.color,
                width: size + 4,
                height: size + 4,
            }}
        >
            <Icon size={size} />
        </span>
    );
}

/** Rounded category tile used as the leading visual in list rows. */
export function CategoryTile({ category, size = 42 }: { category?: string | null; size?: number }) {
    const config = getCategoryConfig(category);
    const Icon = config.Icon;
    return (
        <span
            aria-hidden="true"
            style={{
                width: size,
                height: size,
                borderRadius: Math.round(size * 0.34),
                display: 'inline-grid',
                placeItems: 'center',
                flexShrink: 0,
                color: config.color,
                background: `color-mix(in srgb, ${config.color} 14%, transparent)`,
                boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${config.color} 16%, transparent)`,
            }}
        >
            <Icon size={Math.round(size * 0.48)} />
        </span>
    );
}

/** Compact payment-method tag (icon + label). */
export function PaymentTag({ method }: { method?: string | null }) {
    const config = PAYMENT_ICONS[method || 'cash'] || PAYMENT_ICONS.cash;
    const Icon = config.Icon;
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                height: 22,
                padding: '0 8px',
                borderRadius: 999,
                background: 'var(--bg-tertiary)',
                color: 'var(--fg-secondary)',
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: 'nowrap',
            }}
        >
            <Icon size={12} style={{ color: config.color }} />
            {config.label}
        </span>
    );
}
