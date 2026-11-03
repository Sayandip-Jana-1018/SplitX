'use client';

import Link from 'next/link';
import { useId, type CSSProperties, type MouseEventHandler, type ReactNode } from 'react';
import { motion, type Variants } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import { useThemeContext } from '@/components/providers/ThemeProvider';
import { GLASS_STYLE_IDS, type GlassKind, type GlassStyleId } from '@/lib/glass/styles';
import styles from './kit.module.css';

const ICON_BUTTON_GLASS: Partial<Record<IconButtonVariant, GlassKind>> = {
    surface: 'thin',
    solid: 'accent',
    glass: 'clear',
};

/* ═══════════════════════════════════════════════════════════════
   IconButton
   ═══════════════════════════════════════════════════════════════ */

type IconButtonVariant = 'surface' | 'ghost' | 'soft' | 'solid' | 'glass';

interface IconButtonProps {
    icon: ReactNode;
    label: string;
    onClick?: MouseEventHandler<HTMLButtonElement>;
    href?: string;
    variant?: IconButtonVariant;
    size?: 'sm' | 'md' | 'lg';
    badge?: number | boolean;
    active?: boolean;
    disabled?: boolean;
    className?: string;
    style?: CSSProperties;
    tour?: string;
}

export function IconButton({
    icon,
    label,
    onClick,
    href,
    variant = 'surface',
    size = 'md',
    badge,
    active,
    disabled,
    className,
    style,
    tour,
}: IconButtonProps) {
    const classes = cn(
        styles.iconButton,
        styles[`ib_${variant}`],
        styles[`ib_${size}`],
        active && styles.ibActive,
        className,
    );
    const glass = ICON_BUTTON_GLASS[variant];
    const badgeNode = badge ? (
        <span className={cn(styles.ibBadge, typeof badge === 'boolean' && styles.ibDot)} aria-hidden="true">
            {typeof badge === 'number' ? (badge > 9 ? '9+' : badge) : null}
        </span>
    ) : null;

    if (href) {
        return (
            <Link href={href} className={classes} aria-label={label} style={style} data-tour={tour} data-glass={glass}>
                {icon}
                {badgeNode}
            </Link>
        );
    }

    return (
        <motion.button
            type="button"
            className={classes}
            aria-label={label}
            title={label}
            onClick={onClick}
            disabled={disabled}
            whileTap={{ scale: 0.9 }}
            style={style}
            data-tour={tour}
            data-glass={glass}
        >
            {icon}
            {badgeNode}
        </motion.button>
    );
}

/* ═══════════════════════════════════════════════════════════════
   PageIntro — compact, centered page heading
   ═══════════════════════════════════════════════════════════════ */

export function PageIntro({
    eyebrow,
    title,
    subtitle,
    children,
    className,
}: {
    eyebrow?: ReactNode;
    title: ReactNode;
    subtitle?: ReactNode;
    children?: ReactNode;
    className?: string;
}) {
    return (
        <header className={cn(styles.intro, className)}>
            {eyebrow && <span className={styles.introEyebrow}>{eyebrow}</span>}
            <h1 className={styles.introTitle}>{title}</h1>
            {subtitle && <p className={styles.introSubtitle}>{subtitle}</p>}
            {children && <div className={styles.introActions}>{children}</div>}
        </header>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Section
   ═══════════════════════════════════════════════════════════════ */

interface SectionAction {
    label: string;
    href?: string;
    onClick?: () => void;
}

export function Section({
    title,
    subtitle,
    action,
    centered,
    children,
    className,
    tour,
}: Readonly<{
    title?: ReactNode;
    subtitle?: ReactNode;
    action?: SectionAction;
    /** Centre the heading over the content, like PageIntro (a single-column page). */
    centered?: boolean;
    children: ReactNode;
    className?: string;
    tour?: string;
}>) {
    return (
        <section className={cn(styles.section, className)} data-tour={tour}>
            {(title || action) && (
                <div className={cn(styles.sectionHead, centered && styles.sectionHeadCentered)}>
                    <div className={styles.sectionTitles}>
                        {title && <h2 className={styles.sectionTitle}>{title}</h2>}
                        {subtitle && <p className={styles.sectionSubtitle}>{subtitle}</p>}
                    </div>
                    {action && (action.href ? (
                        <Link href={action.href} className={styles.sectionAction}>
                            {action.label}
                            <ChevronRight size={14} />
                        </Link>
                    ) : (
                        <button type="button" onClick={action.onClick} className={styles.sectionAction}>
                            {action.label}
                            <ChevronRight size={14} />
                        </button>
                    ))}
                </div>
            )}
            {children}
        </section>
    );
}

/* ═══════════════════════════════════════════════════════════════
   ListGroup + ListRow — iOS-grade grouped lists
   ═══════════════════════════════════════════════════════════════ */

export function ListGroup({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn(styles.listGroup, className)} data-glass="reg">{children}</div>;
}

interface ListRowProps {
    leading?: ReactNode;
    title: ReactNode;
    subtitle?: ReactNode;
    meta?: ReactNode;
    trailing?: ReactNode;
    trailingSub?: ReactNode;
    href?: string;
    onClick?: () => void;
    chevron?: boolean;
    tone?: 'default' | 'danger';
    card?: boolean;
    disabled?: boolean;
    /** Let the title and subtitle wrap onto more lines instead of being cut short. */
    wrap?: boolean;
    className?: string;
}

export function ListRow({
    leading,
    title,
    subtitle,
    meta,
    trailing,
    trailingSub,
    href,
    onClick,
    chevron,
    tone = 'default',
    card,
    disabled,
    wrap,
    className,
}: Readonly<ListRowProps>) {
    const content = (
        <>
            {leading && <span className={styles.rowLeading}>{leading}</span>}
            <span className={styles.rowBody}>
                <span className={cn(styles.rowTitle, tone === 'danger' && styles.rowTitleDanger)}>{title}</span>
                {subtitle && <span className={styles.rowSubtitle}>{subtitle}</span>}
                {meta && <span className={styles.rowMeta}>{meta}</span>}
            </span>
            {(trailing || trailingSub || chevron) && (
                <span className={styles.rowEnd}>
                    {(trailing || trailingSub) && (
                        <span className={styles.rowTrailing}>
                            {trailing}
                            {trailingSub && <span className={styles.rowTrailingSub}>{trailingSub}</span>}
                        </span>
                    )}
                    {chevron && <ChevronRight size={17} className={styles.rowChevron} aria-hidden="true" />}
                </span>
            )}
        </>
    );

    const classes = cn(
        styles.row,
        (href || onClick) && styles.rowInteractive,
        card && styles.rowCard,
        disabled && styles.rowDisabled,
        wrap && styles.rowWrap,
        className,
    );

    const glass = card ? 'reg' : undefined;
    if (href) {
        return <Link href={href} className={classes} data-glass={glass}>{content}</Link>;
    }
    if (onClick) {
        return <button type="button" className={classes} onClick={onClick} disabled={disabled} data-glass={glass}>{content}</button>;
    }
    return <div className={classes} data-glass={glass}>{content}</div>;
}

/* ═══════════════════════════════════════════════════════════════
   Tag
   ═══════════════════════════════════════════════════════════════ */

export type Tone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning';

export function Tag({ tone = 'neutral', icon, children, className }: {
    tone?: Tone;
    icon?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <span className={cn(styles.tag, tone !== 'neutral' && styles[`tag_${tone}`], className)}>
            {icon}
            {children}
        </span>
    );
}

/* ═══════════════════════════════════════════════════════════════
   StatTile
   ═══════════════════════════════════════════════════════════════ */

export function StatTile({
    label,
    value,
    icon,
    tone = 'neutral',
    hint,
    className,
}: {
    label: ReactNode;
    value: ReactNode;
    icon?: ReactNode;
    tone?: 'neutral' | 'success' | 'danger';
    hint?: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn(styles.stat, tone !== 'neutral' && styles[`stat_${tone}`], className)} data-glass="thin">
            <span className={styles.statHead}>
                {icon && <span className={styles.statIcon}>{icon}</span>}
                <span className={styles.statLabel}>{label}</span>
            </span>
            <span className={styles.statValue}>{value}</span>
            {hint && <span className={styles.statHint}>{hint}</span>}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Segmented control — spring-animated selection pill
   ═══════════════════════════════════════════════════════════════ */

export interface SegmentedOption<T extends string> {
    value: T;
    label: ReactNode;
    count?: number;
}

export function Segmented<T extends string>({
    options,
    value,
    onChange,
    size = 'md',
    className,
    ariaLabel,
}: {
    options: SegmentedOption<T>[];
    value: T;
    onChange: (value: T) => void;
    size?: 'sm' | 'md';
    className?: string;
    ariaLabel?: string;
}) {
    const id = useId();
    return (
        <div className={cn(styles.segmented, size === 'sm' && styles.seg_sm, className)} role="tablist" aria-label={ariaLabel} data-glass="thin">
            {options.map((option) => {
                const active = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className={cn(styles.segItem, active && styles.segItemActive)}
                        onClick={() => onChange(option.value)}
                    >
                        {active && (
                            <motion.span
                                layoutId={`seg-${id}`}
                                className={styles.segPill}
                                data-glass="clear"
                                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                            />
                        )}
                        <span className={styles.segLabel}>
                            {option.label}
                            {typeof option.count === 'number' && <span className={styles.segCount}>{option.count}</span>}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Chips
   ═══════════════════════════════════════════════════════════════ */

export function Chip({
    active,
    onClick,
    icon,
    children,
    className,
}: {
    active?: boolean;
    onClick?: () => void;
    icon?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={onClick}
            aria-pressed={active}
            className={cn(styles.chip, active && styles.chipActive, className)}
            data-glass={active ? 'accent' : 'thin'}
        >
            {icon && <span className={styles.chipIcon}>{icon}</span>}
            {children}
        </motion.button>
    );
}

export function ChipRow({ children, center, className }: { children: ReactNode; center?: boolean; className?: string }) {
    return (
        <div className={cn(styles.chipRow, center && styles.chipRowCenter, className)}>
            <div className={styles.chipRowInner}>{children}</div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Amount — tabular money with semantic colour
   ═══════════════════════════════════════════════════════════════ */

export function Amount({
    value,
    signed,
    tone = 'neutral',
    className,
    style,
}: {
    /** amount in paise */
    value: number;
    signed?: boolean;
    tone?: 'auto' | 'neutral' | 'success' | 'danger' | 'accent' | 'muted' | 'inherit';
    className?: string;
    style?: CSSProperties;
}) {
    const resolved = tone === 'auto' ? (value > 0 ? 'success' : value < 0 ? 'danger' : 'muted') : tone;
    const prefix = signed ? (value > 0 ? '+' : value < 0 ? '−' : '') : '';
    return (
        <span className={cn(styles.amount, styles[`amount_${resolved}`], className)} style={style}>
            {prefix}{formatCurrency(Math.abs(value))}
        </span>
    );
}

/* ═══════════════════════════════════════════════════════════════
   IconTile
   ═══════════════════════════════════════════════════════════════ */

export function IconTile({
    children,
    size = 40,
    tone = 'accent',
    radius,
    className,
    style,
}: {
    children: ReactNode;
    size?: number;
    tone?: 'accent' | 'neutral' | 'success' | 'danger' | 'warning' | 'solid';
    radius?: number;
    className?: string;
    style?: CSSProperties;
}) {
    const tileStyle: CSSProperties = {
        width: size,
        height: size,
        borderRadius: radius ?? Math.round(size * 0.34),
        ...style,
    };
    return (
        <span className={cn(styles.iconTile, styles[`tile_${tone}`], className)} style={tileStyle}>
            {children}
        </span>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Notice
   ═══════════════════════════════════════════════════════════════ */

export function Notice({
    tone = 'info',
    icon,
    title,
    children,
    action,
    className,
}: {
    tone?: 'info' | 'warning' | 'success' | 'danger';
    icon?: ReactNode;
    title?: ReactNode;
    children?: ReactNode;
    action?: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn(styles.notice, styles[`notice_${tone}`], className)} role={tone === 'danger' ? 'alert' : 'status'} data-glass="thin">
            {icon && <span className={styles.noticeIcon}>{icon}</span>}
            <div className={styles.noticeBody}>
                {title && <div className={styles.noticeTitle}>{title}</div>}
                {children && <div className={styles.noticeText}>{children}</div>}
            </div>
            {action}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Progress
   ═══════════════════════════════════════════════════════════════ */

export function Progress({ value, tone = 'accent', className }: { value: number; tone?: 'accent' | 'success' | 'danger'; className?: string }) {
    const pct = Math.max(0, Math.min(100, value));
    return (
        <div className={cn(styles.progress, tone !== 'accent' && styles[`progress_${tone}`], className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <motion.div
                className={styles.progressFill}
                initial={false}
                animate={{ width: `${pct}%` }}
                transition={{ type: 'spring', stiffness: 220, damping: 30 }}
            />
        </div>
    );
}

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
    return <span className={cn(styles.spinner, className)} style={{ width: size, height: size }} aria-hidden="true" />;
}

/* ═══════════════════════════════════════════════════════════════
   Stagger — orchestrated entrance for page sections
   ═══════════════════════════════════════════════════════════════ */

const staggerParent: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.055, delayChildren: 0.02 } },
};

const staggerChild: Variants = {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 360, damping: 32, mass: 0.9 } },
};

export function Stagger({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
    return (
        <motion.div className={className} style={style} variants={staggerParent} initial="hidden" animate="show" data-fade>
            {children}
        </motion.div>
    );
}

export function StaggerItem({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
    return (
        <motion.div className={className} style={style} variants={staggerChild} data-fade>
            {children}
        </motion.div>
    );
}

/* ══════════════════════════════════════════
   Glass picker: each choice is made of the material it names
   ══════════════════════════════════════════ */

const GLASS_NAMES: Record<GlassStyleId, { name: string; hint: string }> = {
    liquid: { name: 'Liquid', hint: 'Bends the light' },
    frosted: { name: 'Frosted', hint: 'Soft and misty' },
    crystal: { name: 'Crystal', hint: 'Almost clear' },
    tinted: { name: 'Tinted', hint: 'Full of colour' },
    pearl: { name: 'Pearl', hint: 'Calm and solid' },
};

export function GlassPicker({ className }: { className?: string }) {
    const { glass, setGlass } = useThemeContext();
    return (
        <div className={cn(styles.glassPicker, className)} role="radiogroup" aria-label="Kind of glass">
            {GLASS_STYLE_IDS.map((id) => (
                <motion.button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={glass === id}
                    className={styles.glassPick}
                    data-glass="reg"
                    data-glass-sample={id}
                    whileTap={{ scale: 0.93 }}
                    onClick={() => setGlass(id)}
                >
                    {GLASS_NAMES[id].name}
                    <span className={styles.glassPickHint}>{GLASS_NAMES[id].hint}</span>
                </motion.button>
            ))}
        </div>
    );
}

