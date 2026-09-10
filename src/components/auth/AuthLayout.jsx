import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { FolderOpen, Mic, ShieldCheck } from 'lucide-react';
import '../theme/tailwind.css';
import Backdrop from './Backdrop';
import Brand from './Brand';
import { rise, riseSoft, stagger } from '../motion';

const FEATURES = [
    {
        icon: Mic,
        title: 'Forward it, forget it',
        body: 'Send any voice note to your number. The gist lands in your inbox in seconds.',
    },
    {
        icon: FolderOpen,
        title: 'Filed, not piled',
        body: 'Summaries sort themselves into folders you define. Search across all of them.',
    },
    {
        icon: ShieldCheck,
        title: 'Your number, your box',
        body: 'Runs against your own WAHA instance. Audio is never stored after transcription.',
    },
];

/**
 * Two-pane auth shell. On large screens: a marketing pane (left, 46%) and the
 * form (right). Below `lg` the marketing pane collapses to a compact header so
 * the form is above the fold on every phone.
 */
export default function AuthLayout({ children }) {
    const reduce = useReducedMotion();
    const variants = reduce ? undefined : stagger(0.05, 0.05);

    return (
        <div className="relative min-h-dvh overflow-x-hidden bg-ink-950 text-fog-100">
            <Backdrop />

            <div className="relative mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col lg:flex-row">
                {/* Marketing pane */}
                <motion.aside
                    initial={reduce ? false : 'hidden'}
                    animate="show"
                    variants={variants}
                    className="hairline-y flex flex-col gap-8 px-5 pb-2 pt-6 sm:px-8 lg:min-h-dvh lg:w-[46%] lg:justify-between lg:px-14 lg:py-12 xl:w-[48%]"
                >
                    <motion.div variants={rise}>
                        <Brand />
                    </motion.div>

                    <div className="lg:max-w-[34rem]">
                        <motion.p variants={rise} className="eyebrow mb-4 hidden lg:block">
                            WhatsApp voice notes · summarised
                        </motion.p>
                        <motion.h2
                            variants={rise}
                            className="text-balance text-display-sm text-fog-50 lg:text-display"
                        >
                            Every voice note,
                            <br />
                            <span className="text-signal-400">already read.</span>
                        </motion.h2>
                        <motion.p
                            variants={riseSoft}
                            className="mt-4 max-w-[30rem] text-[15px] leading-relaxed text-fog-300 lg:mt-6 lg:text-[17px]"
                        >
                            Twelve-minute rambles become four clean lines. Forward, wait a
                            breath, read.
                        </motion.p>

                        <motion.ul variants={variants} className="mt-10 hidden flex-col gap-5 lg:flex">
                            {FEATURES.map(({ icon: Icon, title, body }) => (
                                <motion.li key={title} variants={riseSoft} className="flex gap-4">
                                    <span className="glass-sm mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl text-signal-400">
                                        <Icon aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
                                    </span>
                                    <div>
                                        <p className="text-[15px] font-bold tracking-[-0.01em] text-fog-50">{title}</p>
                                        <p className="mt-1 text-[14px] leading-relaxed text-fog-400">{body}</p>
                                    </div>
                                </motion.li>
                            ))}
                        </motion.ul>
                    </div>

                    <motion.div
                        variants={riseSoft}
                        className="hidden items-center gap-3 font-mono text-[11px] text-fog-500 lg:flex"
                    >
                        <span className="inline-flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-signal-400" />
                            all systems nominal
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>tls 1.3</span>
                        <span aria-hidden="true">·</span>
                        <span>v1.0</span>
                    </motion.div>
                </motion.aside>

                {/* Form pane */}
                <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-6 sm:px-8 lg:items-center lg:px-14 lg:py-12">
                    {children}
                </main>
            </div>
        </div>
    );
}
