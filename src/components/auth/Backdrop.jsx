import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * Ambient background: hairline grid (edge-faded), two slow colour fields that
 * drift on transform only (GPU-composited), and a film-grain overlay.
 */
export default function Backdrop() {
    const reduce = useReducedMotion();

    const drift = (dx, dy, duration) =>
        reduce
            ? undefined
            : {
                  x: [0, dx, 0],
                  y: [0, dy, 0],
                  transition: { duration, repeat: Infinity, ease: 'easeInOut' },
              };

    return (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="mask-fade-edges absolute inset-0 bg-grid bg-[length:56px_56px] opacity-60" />

            <motion.div
                animate={drift(48, 32, 28)}
                className="absolute -left-[12%] -top-[18%] h-[58vmax] w-[58vmax] rounded-full bg-signal-400/[0.11] blur-[110px] will-change-transform"
            />
            <motion.div
                animate={drift(-36, -44, 34)}
                className="absolute -bottom-[28%] -right-[14%] h-[52vmax] w-[52vmax] rounded-full bg-verdigris-400/[0.10] blur-[120px] will-change-transform"
            />

            <div className="absolute inset-0 bg-noise opacity-[0.045] mix-blend-overlay" />
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        </div>
    );
}
