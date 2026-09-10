import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { dismiss, subscribe } from './toast';
import cx from './cx';
import { SPRING_SNAPPY } from '../motion';

const TONES = {
    error: { bar: 'bg-ember-400', icon: AlertCircle, iconCls: 'text-ember-300 bg-ember-400/15' },
    success: { bar: 'bg-signal-400', icon: CheckCircle2, iconCls: 'text-signal-300 bg-signal-400/15' },
    neutral: { bar: 'bg-verdigris-400', icon: Info, iconCls: 'text-verdigris-300 bg-verdigris-400/15' },
};

/** Frosted-glass notifications. Bottom-centre on phones, bottom-right otherwise. */
export default function Toaster() {
    const [items, setItems] = useState([]);
    const reduce = useReducedMotion();

    useEffect(() => subscribe(setItems), []);

    return (
        <div
            aria-live="polite"
            role="status"
            aria-label="Notifications"
            className="pointer-events-none fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end lg:bottom-6"
        >
            <AnimatePresence initial={false}>
                {items.map((t) => {
                    const tone = TONES[t.tone] ?? TONES.neutral;
                    const Icon = tone.icon;
                    return (
                        <motion.div
                            key={t.id}
                            layout={!reduce}
                            initial={reduce ? false : { opacity: 0, y: 12, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14 } }}
                            transition={SPRING_SNAPPY}
                            className="glass-sm pointer-events-auto relative flex w-full max-w-[380px] gap-3 overflow-hidden rounded-xl2 p-3.5 pr-10"
                        >
                            <span aria-hidden="true" className={cx('absolute inset-y-3 left-0 w-[3px] rounded-r-full', tone.bar)} />
                            <span className={cx('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg', tone.iconCls)}>
                                <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                            </span>
                            <div className="min-w-0 text-[13.5px] leading-snug">
                                {t.title && <strong className="block font-bold text-fog-50">{t.title}</strong>}
                                {t.message && <span className="text-fog-300">{t.message}</span>}
                                {t.action && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            t.action.onClick?.();
                                            dismiss(t.id);
                                        }}
                                        className="mt-1.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-signal-300 hover:text-signal-200"
                                    >
                                        {t.action.label}
                                    </button>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => dismiss(t.id)}
                                aria-label="Dismiss notification"
                                className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-fog-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-fog-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60"
                            >
                                <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.25} />
                            </button>
                        </motion.div>
                    );
                })}
            </AnimatePresence>
        </div>
    );
}
