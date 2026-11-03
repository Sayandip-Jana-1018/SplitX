'use client';

import { forwardRef, ButtonHTMLAttributes } from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import styles from './button.module.css';
import { cn } from '@/lib/utils';
import type { GlassKind } from '@/lib/glass/styles';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'soft' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onAnimationStart' | 'onDrag' | 'onDragEnd' | 'onDragStart'> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    fullWidth?: boolean;
    loading?: boolean;
    iconOnly?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
}

const GLASS: Partial<Record<ButtonVariant, GlassKind>> = {
    primary: 'accent',
    success: 'accent',
    secondary: 'thin',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            children,
            variant = 'primary',
            size = 'md',
            fullWidth = false,
            loading = false,
            iconOnly = false,
            leftIcon,
            rightIcon,
            className,
            disabled,
            type = 'button',
            ...props
        },
        ref
    ) => {
        const inactive = disabled || loading;
        return (
            <motion.button
                ref={ref}
                type={type}
                aria-busy={loading || undefined}
                whileTap={inactive ? undefined : { scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 460, damping: 26 }}
                className={cn(
                    styles.button,
                    styles[variant],
                    styles[size],
                    fullWidth && styles.fullWidth,
                    iconOnly && styles.iconOnly,
                    loading && styles.loading,
                    className
                )}
                disabled={inactive}
                data-glass={GLASS[variant]}
                {...(props as HTMLMotionProps<'button'>)}
            >
                {loading ? <span className={styles.spinner} aria-hidden="true" /> : leftIcon}
                {!iconOnly && children !== undefined && children !== null && <span className={styles.label}>{children}</span>}
                {!loading && rightIcon}
            </motion.button>
        );
    }
);

Button.displayName = 'Button';
export default Button;
