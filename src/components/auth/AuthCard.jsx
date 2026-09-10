import React, { useEffect } from 'react';
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { SHAKE, surface } from '../motion';

/**
 * The glass "window" that holds an auth form.
 * Bump `shakeKey` (any changing number) to play a horizontal shake – used when
 * the server rejects a submission so the failure is felt, not just read.
 */
export default function AuthCard({ eyebrow, title, subtitle, shakeKey = 0, footer, children }) {
    const reduce = useReducedMotion();
    const controls = useAnimationControls();

    useEffect(() => {
        if (!shakeKey || reduce) return;
        controls.start(SHAKE);
    }, [shakeKey, reduce, controls]);

    return (
        <motion.section
            initial={reduce ? false : 'hidden'}
            animate="show"
            variants={surface}
            className="w-full max-w-[440px]"
        >
            <motion.div animate={controls} className="glass rounded-3xl p-6 sm:p-8">
                <header className="mb-7">
                    <div className="mb-5 flex items-center justify-between">
                        <span className="eyebrow">{eyebrow}</span>
                        <span aria-hidden="true" className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-white/10" />
                            <span className="h-2 w-2 rounded-full bg-white/10" />
                            <span className="h-2 w-2 rounded-full bg-signal-400/80" />
                        </span>
                    </div>
                    <h1 className="text-title text-fog-50">{title}</h1>
                    {subtitle && <p className="mt-2 text-[14.5px] leading-relaxed text-fog-400">{subtitle}</p>}
                </header>

                {children}
            </motion.div>

            {footer && (
                <motion.div variants={surface} className="mt-5 text-center text-[14px] text-fog-400">
                    {footer}
                </motion.div>
            )}
        </motion.section>
    );
}
