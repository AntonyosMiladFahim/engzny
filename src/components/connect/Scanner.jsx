import React, { forwardRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, RefreshCw, WifiOff } from 'lucide-react';
import Reticle from './Reticle';
import Button from '../ui/Button';
import cx from '../ui/cx';
import { SPRING_SNAPPY, SPRING_SOFT } from '../motion';

const fade = {
    initial: { opacity: 0, scale: 0.98 },
    animate: { opacity: 1, scale: 1, transition: SPRING_SOFT },
    exit: { opacity: 0, scale: 0.985, transition: { duration: 0.16 } },
};

const MODE_LABEL = {
    loading: 'Contacting session',
    starting: 'Starting session',
    scan: 'Awaiting scan',
    qr: 'Generating code',
    offline: 'Reconnecting',
    failed: 'Session failed',
    linked: 'Linked',
};

/**
 * The optical scanner. `mode` drives the stage; the frame, reticle and glow
 * react to it. `ref` lands on the frame so callers can measure its centre.
 */
const Scanner = forwardRef(function Scanner(
    { mode = 'loading', qr, retryInSec, isPolling, onRetry, onRefreshQr, detail },
    ref
) {
    const reduce = useReducedMotion();
    const locked = mode === 'linked';
    const hunting = mode === 'scan';

    return (
        <div className="relative mx-auto w-full max-w-[380px]">
            {/* Ambient glow */}
            <motion.div
                aria-hidden="true"
                className="absolute -inset-8 rounded-[3rem] bg-signal-400/[0.12] blur-3xl"
                animate={
                    reduce
                        ? { opacity: locked ? 0.9 : 0.35 }
                        : locked
                        ? { opacity: [0.5, 1, 0.75], scale: [1, 1.12, 1.05] }
                        : hunting
                        ? { opacity: [0.3, 0.6, 0.3], scale: 1 }
                        : { opacity: 0.18, scale: 1 }
                }
                transition={locked ? { duration: 0.9, ease: 'easeOut' } : { duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
            />

            {/* Frame */}
            <motion.div
                ref={ref}
                data-mode={mode}
                animate={reduce ? undefined : { scale: locked ? 0.965 : 1 }}
                transition={SPRING_SNAPPY}
                className="glass relative aspect-square w-full rounded-4xl p-6 sm:p-7"
            >
                <Reticle active={hunting} locked={locked} />

                {/* Stage – every child is absolutely positioned, so AnimatePresence crossfades states instead of waiting */}
                <div className="relative h-full w-full overflow-hidden rounded-2xl bg-ink-900 shadow-hairline">
                    <div aria-hidden="true" className="absolute inset-0 bg-grid bg-[length:16px_16px] opacity-40" />

                    <AnimatePresence initial={false}>
                        {mode === 'scan' && qr && (
                            <motion.div key="qr" {...fade} className="absolute inset-3 sm:inset-4">
                                <div className="relative h-full w-full overflow-hidden rounded-xl bg-fog-50 p-2.5 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]">
                                    <img
                                        src={qr}
                                        alt="WhatsApp pairing QR code"
                                        draggable={false}
                                        className="h-full w-full select-none object-contain [image-rendering:pixelated]"
                                    />
                                    {!reduce && (
                                        <motion.div
                                            aria-hidden="true"
                                            className="pointer-events-none absolute inset-x-0 top-0 h-[22%] mix-blend-multiply"
                                            animate={{ y: ['-110%', '560%'] }}
                                            transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 0.5, ease: [0.45, 0, 0.55, 1] }}
                                        >
                                            <div className="h-full w-full bg-gradient-to-b from-transparent via-signal-500/55 to-transparent" />
                                            <div className="absolute inset-x-0 top-1/2 h-px bg-signal-600/80" />
                                        </motion.div>
                                    )}
                                </div>
                            </motion.div>
                        )}

                        {mode === 'scan' && !qr && (
                            <motion.div key="qr-loading" {...fade} className="absolute inset-3 sm:inset-4">
                                <div className="relative h-full w-full overflow-hidden rounded-xl bg-white/[0.04] shadow-hairline">
                                    <div className="absolute inset-0 grid grid-cols-6 gap-1 p-3 opacity-40">
                                        {Array.from({ length: 36 }).map((_, i) => (
                                            <span key={i} className={cx('rounded-[3px]', (i * 7) % 3 === 0 ? 'bg-white/20' : 'bg-white/5')} />
                                        ))}
                                    </div>
                                    <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                                    <Caption>Generating pairing code…</Caption>
                                </div>
                            </motion.div>
                        )}

                        {(mode === 'loading' || mode === 'starting') && (
                            <motion.div key={mode} {...fade} className="absolute inset-0 grid place-items-center">
                                <Ring label={mode === 'loading' ? 'Contacting session…' : 'Starting WhatsApp session…'} />
                            </motion.div>
                        )}

                        {mode === 'offline' && (
                            <motion.div key="offline" {...fade} className="absolute inset-0 grid place-items-center p-6 text-center">
                                <div>
                                    <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-ember-400/15 text-ember-300 shadow-hairline">
                                        <WifiOff aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
                                    </span>
                                    <p className="mt-4 text-[15px] font-bold text-fog-50">Can’t reach the server</p>
                                    <p className="mx-auto mt-1 max-w-[22ch] text-[13px] leading-relaxed text-fog-400">
                                        {detail || 'We’ll keep trying in the background.'}
                                    </p>
                                    <p className="mt-3 font-mono text-[11px] text-fog-500" aria-live="polite">
                                        {retryInSec != null ? `retrying in ${retryInSec}s` : 'retrying…'}
                                    </p>
                                    <Button variant="ghost" icon={RefreshCw} onClick={onRetry} className="mx-auto mt-4 h-10 w-auto px-4 text-[14px]">
                                        Retry now
                                    </Button>
                                </div>
                            </motion.div>
                        )}

                        {mode === 'failed' && (
                            <motion.div key="failed" {...fade} className="absolute inset-0 grid place-items-center p-6 text-center">
                                <div>
                                    <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-ember-400/15 text-ember-300 shadow-hairline">
                                        <AlertCircle aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
                                    </span>
                                    <p className="mt-4 text-[15px] font-bold text-fog-50">The session failed</p>
                                    <p className="mx-auto mt-1 max-w-[24ch] text-[13px] leading-relaxed text-fog-400">
                                        {detail || 'WhatsApp rejected the session. Requesting a fresh code usually fixes it.'}
                                    </p>
                                    <Button variant="ghost" icon={RefreshCw} onClick={onRefreshQr ?? onRetry} className="mx-auto mt-4 h-10 w-auto px-4 text-[14px]">
                                        New code
                                    </Button>
                                </div>
                            </motion.div>
                        )}

                        {mode === 'linked' && (
                            <motion.div key="linked" {...fade} className="absolute inset-0 grid place-items-center">
                                <Locked />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>

            {/* Status ribbon */}
            <div className="mt-4 flex items-center justify-between px-1 font-mono text-[11px] uppercase tracking-[0.14em]">
                <span className="inline-flex items-center gap-2 text-fog-400">
                    <span
                        className={cx(
                            'h-1.5 w-1.5 rounded-full transition-all duration-300',
                            locked
                                ? 'bg-signal-400 shadow-[0_0_10px_rgba(201,240,74,0.9)]'
                                : mode === 'offline' || mode === 'failed'
                                ? 'bg-ember-400'
                                : isPolling
                                ? 'bg-signal-300 shadow-[0_0_8px_rgba(201,240,74,0.8)]'
                                : 'bg-signal-400/60'
                        )}
                    />
                    {MODE_LABEL[mode] ?? mode}
                </span>
                <span className="text-fog-500">
                    {locked ? 'session ok' : mode === 'scan' ? 'code rotates ~20s' : mode === 'offline' ? 'backoff' : 'poll 3s'}
                </span>
            </div>
        </div>
    );
});

export default Scanner;

function Caption({ children }) {
    return (
        <p className="absolute inset-x-0 bottom-3 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-fog-400">
            {children}
        </p>
    );
}

function Ring({ label }) {
    return (
        <div className="text-center">
            <div className="relative mx-auto h-16 w-16">
                <span className="absolute inset-0 rounded-full border border-white/10" />
                <span className="absolute inset-0 animate-spin-slow rounded-full border-2 border-transparent border-t-signal-400" style={{ animationDuration: '1.4s' }} />
                <span className="absolute inset-3 animate-spin-slow rounded-full border border-transparent border-b-signal-400/50" style={{ animationDuration: '2.1s', animationDirection: 'reverse' }} />
                <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 animate-pulse-dot rounded-full bg-signal-400" />
            </div>
            <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-fog-400">{label}</p>
        </div>
    );
}

function Locked() {
    const reduce = useReducedMotion();
    return (
        <div className="relative grid place-items-center">
            {!reduce && (
                <motion.span
                    aria-hidden="true"
                    className="absolute h-24 w-24 rounded-full border border-signal-400/60"
                    initial={{ scale: 0.6, opacity: 0.9 }}
                    animate={{ scale: 2.6, opacity: 0 }}
                    transition={{ duration: 0.9, ease: 'easeOut' }}
                />
            )}
            <motion.span
                className="grid h-24 w-24 place-items-center rounded-full bg-signal-400 text-ink-950 shadow-signal"
                initial={reduce ? false : { scale: 0.7 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 480, damping: 26 }}
            >
                <svg viewBox="0 0 24 24" className="h-11 w-11" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <motion.path
                        d="M5 12.5l4.5 4.5L19 7.5"
                        initial={reduce ? false : { pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.38, delay: 0.12, ease: [0.2, 0.8, 0.2, 1] }}
                    />
                </svg>
            </motion.span>
        </div>
    );
}
