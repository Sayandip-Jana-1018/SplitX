'use client';

import { forwardRef, HTMLAttributes } from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import styles from './card.module.css';
import { cn } from '@/lib/utils';

type CardPadding = 'none' | 'compact' | 'normal' | 'spacious';

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onAnimationStart' | 'onDrag' | 'onDragEnd' | 'onDragStart'> {
    padding?: CardPadding;
    interactive?: boolean;
    glass?: boolean;
    elevated?: boolean;
    glow?: boolean;
}

const Card = forwardRef<HTMLDivElement, CardProps>(
    ({ children, padding = 'normal', interactive, glass, elevated, glow, className, ...props }, ref) => {
        const classes = cn(
            styles.card,
            padding !== 'none' && styles[padding],
            interactive && styles.interactive,
            glass && styles.glass,
            elevated && styles.elevated,
            glow && styles.glow,
            className
        );

        if (interactive) {
            return (
                <motion.div
                    ref={ref}
                    className={classes}
                    whileTap={{ scale: 0.985 }}
                    transition={{ type: 'spring' as const, stiffness: 420, damping: 30 }}
                    {...(props as HTMLMotionProps<'div'>)}
                >
                    {children}
                </motion.div>
            );
        }

        return (
            <div ref={ref} className={classes} {...props}>
                {children}
            </div>
        );
    }
);

Card.displayName = 'Card';

function CardHeader({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn(styles.header, className)} {...props}>{children}</div>;
}

function CardBody({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn(styles.body, className)} {...props}>{children}</div>;
}

function CardFooter({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
    return <div className={cn(styles.footer, className)} {...props}>{children}</div>;
}

export { Card, CardHeader, CardBody, CardFooter };
export default Card;
