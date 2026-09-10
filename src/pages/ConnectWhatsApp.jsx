import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, RefreshCw, Smartphone } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import useWahaPolling from '../hooks/useWahaPolling';
import useWahaQr from '../hooks/useWahaQr';
import AppShell from '../components/shell/AppShell';
import UserChip from '../components/shell/UserChip';
import Brand from '../components/auth/Brand';
import Scanner from '../components/connect/Scanner';
import SweepOverlay, { SWEEP_MS } from '../components/connect/SweepOverlay';
import { toast } from '../components/ui/toast';
import { rise, riseSoft, stagger } from '../components/motion';

/** ms the scanner holds the "locked" state before the iris sweep begins. */
export const LOCK_MS = 650;
const REDUCED_MOTION_EXIT_MS = 180;

const STEPS = [
    { n: '01', text: 'Open WhatsApp on your phone.' },
    { n: '02', text: 'Tap Settings, then Linked devices, then Link a device.' },
    { n: '03', text: 'Point the camera at the code. We take it from there.' },
];

export default function ConnectWhatsApp() {
    const navigate = useNavigate();
    const reduce = useReducedMotion();
    const { user } = useAuth();

    const [phase, setPhase] = useState('idle'); // idle → locked → sweep
    const [origin, setOrigin] = useState(null);
    const [now, setNow] = useState(() => Date.now());
    const frameRef = useRef(null);
    const timersRef = useRef([]);

    const beginSequence = useCallback(() => {
        const rect = frameRef.current?.getBoundingClientRect?.();
        if (rect) setOrigin({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        setPhase('locked');

        const go = () => navigate('/dashboard', { replace: true, state: { from: 'connect' } });
        if (reduce) {
            timersRef.current.push(setTimeout(go, REDUCED_MOTION_EXIT_MS));
            return;
        }
        timersRef.current.push(setTimeout(() => setPhase('sweep'), LOCK_MS));
        timersRef.current.push(setTimeout(go, LOCK_MS + SWEEP_MS));
    }, [navigate, reduce]);

    useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

    const polling = useWahaPolling({
        onConnected: beginSequence,
        onError: (err, failures) => {
            if (failures === 3) {
                toast.error(err?.message || 'The server is not responding.', {
                    key: 'waha-status',
                    title: 'Still trying to reach the server',
                    action: { label: 'Retry now', onClick: () => polling.refresh() },
                });
            }
        },
    });

    const qrSource = polling.data?.qr ?? polling.data?.qrCode ?? polling.data?.image ?? null;
    const qr = useWahaQr({ enabled: polling.isScanning && phase === 'idle', source: qrSource });

    useEffect(() => {
        if (qr.error) {
            toast.error(qr.error.message || 'Could not fetch a pairing code.', {
                key: 'waha-qr',
                title: 'Pairing code unavailable',
                action: { label: 'Try again', onClick: qr.refresh },
            });
        }
    }, [qr.error, qr.refresh]);

    // 1s tick to render "retrying in Ns"
    useEffect(() => {
        if (!polling.nextAt || !polling.error) return undefined;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [polling.nextAt, polling.error]);

    const retryInSec = polling.nextAt && polling.error ? Math.max(0, Math.ceil((polling.nextAt - now) / 1000)) : null;

    const mode = useMemo(() => {
        if (phase !== 'idle' || polling.isConnected) return 'linked';
        if (polling.error && (!polling.status || polling.failures >= 2)) return 'offline';
        if (!polling.status) return 'loading';
        if (polling.isScanning) return 'scan';
        if (polling.isFailed) return 'failed';
        return 'starting';
    }, [phase, polling.isConnected, polling.error, polling.status, polling.failures, polling.isScanning, polling.isFailed]);

    const variants = reduce ? undefined : stagger(0.08, 0.06);

    return (
        <AppShell>
            <header className="flex items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
                <Brand compact />
                <UserChip user={user} subtle className="sm:[&>div]:block" />
            </header>

            <main className="mx-auto grid w-full max-w-[1180px] flex-1 items-center gap-10 px-5 pb-16 pt-2 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] lg:gap-20 lg:px-12">
                <motion.section
                    initial={reduce ? false : 'hidden'}
                    animate="show"
                    variants={variants}
                    className="order-2 lg:order-1"
                >
                    <motion.p variants={rise} className="eyebrow mb-4">
                        Pairing · 02
                    </motion.p>
                    <motion.h1 variants={rise} className="text-balance text-display-sm text-fog-50">
                        Connect WhatsApp
                    </motion.h1>
                    <motion.p variants={riseSoft} className="mt-4 max-w-[34rem] text-[15px] leading-relaxed text-fog-300 sm:text-[16px]">
                        Link this account to the phone that receives your voice notes. The moment the
                        handshake completes we’ll carry you straight into your library.
                    </motion.p>

                    <motion.ol variants={variants} className="mt-8 flex flex-col gap-4">
                        {STEPS.map((s) => (
                            <motion.li key={s.n} variants={riseSoft} className="flex items-start gap-4">
                                <span className="mt-0.5 font-mono text-[11px] tracking-[0.14em] text-signal-400">{s.n}</span>
                                <span className="text-[15px] leading-relaxed text-fog-200">{s.text}</span>
                            </motion.li>
                        ))}
                    </motion.ol>

                    <motion.div variants={riseSoft} className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-[13.5px]">
                        <button
                            type="button"
                            onClick={qr.refresh}
                            disabled={mode !== 'scan'}
                            className="inline-flex items-center gap-2 rounded-lg text-fog-300 transition-colors duration-150 hover:text-fog-50 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60"
                        >
                            <RefreshCw aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
                            Refresh code
                        </button>
                        <Link
                            to="/dashboard"
                            className="inline-flex items-center gap-1.5 rounded-lg text-fog-400 underline decoration-white/15 underline-offset-[5px] transition-colors duration-150 hover:text-fog-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-400/60"
                        >
                            Continue without linking
                            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                        </Link>
                    </motion.div>

                    <motion.div variants={riseSoft} className="mt-8 hidden items-center gap-2 font-mono text-[11px] text-fog-500 lg:flex">
                        <Smartphone aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
                        one phone per account · audio is never stored
                    </motion.div>
                </motion.section>

                <motion.section
                    initial={reduce ? false : { opacity: 0, y: 18, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 38, mass: 0.8, delay: 0.05 }}
                    className="order-1 lg:order-2"
                >
                    <Scanner
                        ref={frameRef}
                        mode={mode}
                        qr={qr.qr}
                        isPolling={polling.isPolling}
                        retryInSec={retryInSec}
                        detail={mode === 'offline' ? polling.error?.message : polling.data?.message}
                        onRetry={polling.refresh}
                        onRefreshQr={() => {
                            qr.refresh();
                            polling.refresh();
                        }}
                    />
                </motion.section>
            </main>

            <SweepOverlay active={phase === 'sweep'} origin={origin} />
        </AppShell>
    );
}
