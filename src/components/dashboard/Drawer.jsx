import React, { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { SPRING_SOFT } from '../motion';

/**
 * Bottom sheet for phones. Spring in from below, drag down to dismiss,
 * Escape closes, background scroll is locked while open.
 */
export default function Drawer({ open, onClose, title, children }) {
    const reduce = useReducedMotion();

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => e.key === 'Escape' && onClose?.();
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [open, onClose]);

    return (
        <AnimatePresence>
            {open && (
                <React.Fragment key="drawer">
                    <motion.div
                        key="scrim"
                        onClick={onClose}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="fixed inset-0 z-40 bg-ink-950/60 backdrop-blur-sm lg:hidden"
                    />
                    <motion.div
                        key="sheet"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="drawer-title"
                        initial={reduce ? { opacity: 0 } : { y: '100%' }}
                        animate={reduce ? { opacity: 1 } : { y: 0 }}
                        exit={reduce ? { opacity: 0 } : { y: '100%', transition: { duration: 0.22, ease: [0.4, 0, 0.6, 1] } }}
                        transition={SPRING_SOFT}
                        drag={reduce ? false : 'y'}
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={{ top: 0, bottom: 0.55 }}
                        onDragEnd={(_, info) => {
                            if (info.offset.y > 90 || info.velocity.y > 600) onClose?.();
                        }}
                        className="glass fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-4xl pb-[env(safe-area-inset-bottom)] lg:hidden"
                    >
                        <div aria-hidden="true" className="mx-auto mt-3 h-1 w-10 rounded-full bg-white/15" />
                        <header className="flex items-center justify-between px-6 pb-2 pt-4">
                            <h2 id="drawer-title" className="text-title text-fog-50">
                                {title}
                            </h2>
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Close"
                                className="grid h-9 w-9 place-items-center rounded-xl text-fog-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-fog-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60"
                            >
                                <X aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                            </button>
                        </header>
                        <div className="overflow-y-auto px-4 pb-6">{children}</div>
                    </motion.div>
                </React.Fragment>
            )}
        </AnimatePresence>
    );
}
