import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import cx from './cx';
import { collapse } from '../motion';

/**
 * Labelled input with optional leading icon, trailing slot, hint and inline
 * error. Errors are announced via aria-describedby / aria-invalid rather than
 * role="alert" so the form-level alert stays the single live region.
 */
export default function Field({
    id,
    label,
    icon: Icon,
    hint,
    error,
    trailing,
    className,
    inputClassName,
    ...inputProps
}) {
    const errorId = `${id}-error`;
    const hintId = `${id}-hint`;
    const describedBy = error ? errorId : hint ? hintId : undefined;

    return (
        <div className={cx('group', className)}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
                <label htmlFor={id} className="eyebrow transition-colors duration-150 group-focus-within:text-fog-200">
                    {label}
                </label>
                {hint && !error && (
                    <span id={hintId} className="font-mono text-[11px] text-fog-500">
                        {hint}
                    </span>
                )}
            </div>

            <div
                className={cx(
                    'relative flex items-center rounded-xl2 bg-ink-900/70 shadow-hairline',
                    'ring-1 transition-[box-shadow,background-color,ring-color] duration-150 ease-snap',
                    error
                        ? 'ring-ember-400/60'
                        : 'ring-white/[0.08] group-focus-within:bg-ink-900 group-focus-within:shadow-focus group-focus-within:ring-signal-400/70'
                )}
            >
                {Icon && (
                    <Icon
                        aria-hidden="true"
                        strokeWidth={1.75}
                        className={cx(
                            'pointer-events-none absolute left-3.5 h-[18px] w-[18px] transition-colors duration-150',
                            error ? 'text-ember-300' : 'text-fog-400 group-focus-within:text-signal-400'
                        )}
                    />
                )}
                <input
                    id={id}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    className={cx(
                        'w-full bg-transparent py-3 text-[15px] text-fog-50 caret-signal-400 outline-none',
                        'placeholder:text-fog-500/80 autofill:text-fog-50',
                        Icon ? 'pl-11' : 'pl-4',
                        trailing ? 'pr-12' : 'pr-4',
                        inputClassName
                    )}
                    {...inputProps}
                />
                {trailing && <div className="absolute right-1.5 flex items-center">{trailing}</div>}
            </div>

            <AnimatePresence initial={false}>
                {error && (
                    <motion.div key="error" {...collapse} className="overflow-hidden">
                        <p id={errorId} className="flex items-start gap-1.5 pt-2 text-[12.5px] leading-snug text-ember-300">
                            <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                            <span>{error}</span>
                        </p>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
