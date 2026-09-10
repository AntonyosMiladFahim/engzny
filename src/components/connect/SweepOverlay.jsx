import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * Cinematic exit: an accent iris opens from `origin` (viewport px), chased by
 * an ink iris so the frame ends fully dark – exactly what the Dashboard
 * reveal starts from. Timing constants are shared with the page so the
 * navigate() happens as the second iris finishes.
 */
export const SWEEP_MS = 900;

export default function SweepOverlay({ active, origin }) {
    const x = origin?.x ?? (typeof window !== 'undefined' ? window.innerWidth / 2 : 0);
    const y = origin?.y ?? (typeof window !== 'undefined' ? window.innerHeight / 2 : 0);
    const radius =
        typeof window !== 'undefined' ? Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) + 40 : 2000;

    const closed = `circle(0px at ${x}px ${y}px)`;
    const open = `circle(${Math.round(radius)}px at ${x}px ${y}px)`;

    return (
        <AnimatePresence>
            {active && (
                <div key="sweep" aria-hidden="true" data-testid="sweep-overlay" className="pointer-events-none fixed inset-0 z-[70]">
                    <motion.div
                        className="absolute inset-0 bg-signal-400"
                        initial={{ clipPath: closed }}
                        animate={{ clipPath: open }}
                        transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
                    />
                    <motion.div
                        className="absolute inset-0 bg-ink-950"
                        initial={{ clipPath: closed }}
                        animate={{ clipPath: open }}
                        transition={{ duration: 0.6, delay: 0.16, ease: [0.3, 0.7, 0.2, 1] }}
                    />
                </div>
            )}
        </AnimatePresence>
    );
}
