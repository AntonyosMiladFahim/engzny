import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Loader2 } from 'lucide-react';
import cx from './cx';
import { SPRING_SNAPPY } from '../motion';

/**
 * Primary action. Press feedback is a 1.5% scale on the whole surface (like a
 * physical key), and the label/spinner swap cross-fades instead of reflowing.
 */
export default function Button({
    children,
    loading = false,
    loadingLabel = 'Working…',
    icon: Icon = ArrowRight,
    variant = 'primary',
    className,
    disabled,
    ...props
}) {
    const reduce = useReducedMotion();
    const isDisabled = disabled || loading;

    return (
        <motion.button
            whileHover={!isDisabled && !reduce ? { y: -1 } : undefined}
            whileTap={!isDisabled && !reduce ? { scale: 0.985, y: 0 } : undefined}
            transition={SPRING_SNAPPY}
            aria-busy={loading || undefined}
            disabled={isDisabled}
            className={cx(
                'group relative inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl2 px-5',
                'text-[15px] font-bold tracking-[-0.01em] outline-none transition-[box-shadow,filter] duration-150 ease-snap',
                'focus-visible:ring-2 focus-visible:ring-signal-300 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950',
                variant === 'primary' &&
                    'bg-signal-400 text-ink-950 shadow-signal-sm hover:shadow-signal disabled:hover:shadow-signal-sm',
                variant === 'ghost' &&
                    'bg-white/[0.05] text-fog-100 shadow-hairline hover:bg-white/[0.08]',
                isDisabled && 'cursor-wait saturate-[0.85]',
                className
            )}
            {...props}
        >
            {variant === 'primary' && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-signal-sheen" />
            )}

            <AnimatePresence mode="wait" initial={false}>
                {loading ? (
                    <motion.span
                        key="loading"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.14 }}
                        className="relative inline-flex items-center gap-2"
                    >
                        <Loader2 aria-hidden="true" className="h-[18px] w-[18px] animate-spin-slow" strokeWidth={2.25} />
                        {loadingLabel}
                    </motion.span>
                ) : (
                    <motion.span
                        key="idle"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.14 }}
                        className="relative inline-flex items-center gap-2"
                    >
                        {children}
                        {Icon && (
                            <Icon
                                aria-hidden="true"
                                className="h-[18px] w-[18px] transition-transform duration-150 ease-snap group-hover:translate-x-0.5"
                                strokeWidth={2.25}
                            />
                        )}
                    </motion.span>
                )}
            </AnimatePresence>
        </motion.button>
    );
}
