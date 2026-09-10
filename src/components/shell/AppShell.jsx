import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import '../theme/tailwind.css';
import Backdrop from '../auth/Backdrop';
import Toaster from '../ui/Toaster';
import cx from '../ui/cx';

/**
 * Authenticated-area chrome: ambient backdrop, notification layer and a
 * short fade-up so route changes read as one continuous surface.
 * `reveal` = we arrived from the Connect sweep; start fully ink and lift.
 */
export default function AppShell({ children, reveal = false, className }) {
    const reduce = useReducedMotion();

    return (
        <div className={cx('relative min-h-dvh overflow-x-clip bg-ink-950 text-fog-100', className)}>
            <Backdrop />
            <motion.div
                initial={reduce ? false : { opacity: 0, y: reveal ? 10 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reveal ? 0.55 : 0.32, ease: [0.2, 0.8, 0.2, 1], delay: reveal ? 0.12 : 0 }}
                className="relative flex min-h-dvh flex-col"
            >
                {children}
            </motion.div>

            {reveal && !reduce && (
                <motion.div
                    aria-hidden="true"
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
                    className="pointer-events-none fixed inset-0 z-[60] bg-ink-950"
                />
            )}
            <Toaster />
        </div>
    );
}
