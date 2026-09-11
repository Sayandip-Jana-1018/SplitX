'use client';

import { forwardRef, InputHTMLAttributes, TextareaHTMLAttributes, useState, useId } from 'react';
import styles from './input.module.css';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    hint?: string;
    error?: string;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
    /** Interactive element rendered inside the field on the right (e.g. show-password toggle). */
    rightSlot?: React.ReactNode;
    large?: boolean;
    wrapperClassName?: string;
    floating?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ label, hint, error, leftIcon, rightIcon, rightSlot, large, className, wrapperClassName, floating = false, ...props }, ref) => {
        const [focused, setFocused] = useState(false);
        const generatedId = useId();
        const inputId = props.id || generatedId;
        const hasValue = !!props.value || !!props.defaultValue;
        const isFloating = floating && label;
        const describedBy = [props['aria-describedby'], error ? `${inputId}-error` : '', hint && !error ? `${inputId}-hint` : '']
            .filter(Boolean)
            .join(' ') || undefined;

        return (
            <div className={cn(styles.wrapper, error && styles.error, wrapperClassName)}>
                {label && !isFloating && <label htmlFor={inputId} className={styles.label}>{label}</label>}
                <div className={cn(styles.inputContainer, isFloating && styles.floatingContainer)}>
                    {leftIcon && <span className={styles.leftIcon}>{leftIcon}</span>}
                    <input
                        ref={ref}
                        className={cn(
                            styles.input,
                            large && styles.inputLarge,
                            leftIcon ? styles.hasLeftIcon : undefined,
                            rightIcon || rightSlot ? styles.hasRightIcon : undefined,
                            isFloating ? styles.floatingInput : undefined,
                            isFloating && (focused || hasValue) ? styles.floatingInputActive : undefined,
                            className
                        )}
                        onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
                        onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
                        placeholder={isFloating ? ' ' : props.placeholder}
                        {...props}
                        id={inputId}
                        aria-invalid={error ? true : props['aria-invalid']}
                        aria-describedby={describedBy}
                    />
                    {isFloating && (
                        <label
                            htmlFor={inputId}
                            className={cn(
                                styles.floatingLabel,
                                (focused || hasValue) ? styles.floatingLabelActive : undefined,
                                leftIcon ? styles.floatingLabelWithIcon : undefined
                            )}
                        >
                            {label}
                        </label>
                    )}
                    {rightIcon && !rightSlot && <span className={styles.rightIcon}>{rightIcon}</span>}
                    {rightSlot && <span className={styles.rightSlot}>{rightSlot}</span>}
                </div>
                {error ? (
                    <span id={`${inputId}-error`} role="alert" className={styles.errorText}>{error}</span>
                ) : hint ? (
                    <span id={`${inputId}-hint`} className={styles.hintText}>{hint}</span>
                ) : null}
            </div>
        );
    }
);

Input.displayName = 'Input';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: string;
    error?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ label, error, className, ...props }, ref) => {
        const generatedId = useId();
        const inputId = props.id || generatedId;
        return (
            <div className={cn(styles.wrapper, error && styles.error)}>
                {label && <label htmlFor={inputId} className={styles.label}>{label}</label>}
                <textarea
                    ref={ref}
                    className={cn(styles.input, styles.textarea, className)}
                    {...props}
                    id={inputId}
                    aria-invalid={error ? true : props['aria-invalid']}
                    aria-describedby={error ? `${inputId}-error` : props['aria-describedby']}
                />
                {error && <span id={`${inputId}-error`} role="alert" className={styles.errorText}>{error}</span>}
            </div>
        );
    }
);

Textarea.displayName = 'Textarea';

export { Input, Textarea };
export default Input;
