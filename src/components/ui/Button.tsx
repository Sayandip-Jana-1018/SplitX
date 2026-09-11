'use client';

import { forwardRef, ButtonHTMLAttributes } from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import styles from './button.module.css';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
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
            ...props
        },
        ref
    ) => {
        return (
            <motion.button
                ref={ref}
                aria-busy={loading || undefined}
                whileTap={{ scale: 0.97 }}
                whileHover={{ scale: 1.01 }}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                className={cn(
                    styles.button,
                    styles[variant],
                    styles[size],
                    fullWidth && styles.fullWidth,
                    iconOnly && styles.iconOnly,
                    className
                )}
                disabled={disabled || loading}
                {...(props as HTMLMotionProps<"button">)}
            >
                {loading && <span className={styles.spinner} />}
                {!loading && leftIcon}
                {!iconOnly && children}
                {!loading && rightIcon}
            </motion.button>
        );
    }
);

Button.displayName = 'Button';
export default Button;
