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
export const PAYMENT_ICONS: Record<string, IconConfig> = {
    cash: iconConfig(BsCashCoin, 'Cash', '#16a34a', 18),
    gpay: iconConfig(SiGooglepay, 'Google Pay', '#4285F4'),
    phonepe: iconConfig(SiPhonepe, 'PhonePe', '#5F259F', 18),
    paytm: iconConfig(SiPaytm, 'Paytm', '#00BAF2', 18),
    upi_other: iconConfig(BsPhone, 'Other UPI', '#f97316', 18),
    upi: iconConfig(BsPhone, 'UPI', '#f97316', 18),
    card: iconConfig(BsCreditCard2Back, 'Card', '#8b5cf6', 18),
};

// ── Categories ──
export const CATEGORY_ICONS: Record<string, IconConfig> = {
    general: iconConfig(MdCategory, 'General', '#6366f1'),
    food: iconConfig(MdFastfood, 'Food & Drinks', '#ef4444'),
    groceries: iconConfig(MdLocalGroceryStore, 'Groceries', '#16a34a'),
    transport: iconConfig(MdDirectionsCar, 'Transport', '#3b82f6'),
    fuel: iconConfig(MdLocalGasStation, 'Fuel', '#f97316'),
    stay: iconConfig(MdHotel, 'Stay', '#8b5cf6'),
    shopping: iconConfig(MdShoppingBag, 'Shopping', '#ec4899'),
    tickets: iconConfig(MdConfirmationNumber, 'Tickets & Entry', '#f59e0b'),
    entertainment: iconConfig(MdSportsEsports, 'Entertainment', '#06b6d4'),
    bills: iconConfig(MdReceiptLong, 'Bills', '#0ea5e9'),
    medical: iconConfig(MdLocalHospital, 'Medical', '#10b981'),
    other: iconConfig(MdMoreHoriz, 'Other', '#78716c'),
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

/** Small inline category glyph with a tinted backdrop. */
export function CategoryIcon({ category, size = 20 }: { category: string; size?: number }) {
    const config = getCategoryConfig(category);
    const Icon = config.Icon;
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: config.color,
                width: size + 6,
                height: size + 6,
                background: `color-mix(in srgb, ${config.color} 14%, transparent)`,
                borderRadius: 'var(--radius-sm)',
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
