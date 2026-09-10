import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, X } from 'lucide-react';
import { collapse } from '../motion';

/**
 * Form-level error surface. Renders nothing when `message` is falsy so the
 * form does not reserve space. The container is the page's only role="alert".
 */
export default function FormAlert({ title = 'Something went wrong', message, onDismiss }) {
    return (
        <AnimatePresence initial={false}>
            {message && (
                <motion.div key="alert" {...collapse} className="overflow-hidden">
                    <div
                        role="alert"
                        className="relative flex gap-3 rounded-xl2 border border-ember-400/25 bg-ember-500/[0.09] p-3.5 pr-10 shadow-hairline"
                    >
                        <span
                            aria-hidden="true"
                            className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-ember-400"
                        />
                        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ember-400/15 text-ember-300">
                            <AlertCircle aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                        </span>
                        <div className="min-w-0 text-[13.5px] leading-snug">
                            <strong className="block font-bold text-ember-200">{title}</strong>
                            <span className="text-fog-200/90">{message}</span>
                        </div>
                        {onDismiss && (
                            <button
                                type="button"
                                onClick={onDismiss}
                                aria-label="Dismiss"
                                className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-fog-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-fog-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-300/60"
                            >
                                <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.25} />
                            </button>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
