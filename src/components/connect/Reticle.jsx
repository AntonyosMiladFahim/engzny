import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import cx from '../ui/cx';

const CORNERS = [
    { pos: 'left-0 top-0', rot: 0 },
    { pos: 'right-0 top-0', rot: 90 },
    { pos: 'right-0 bottom-0', rot: 180 },
    { pos: 'left-0 bottom-0', rot: 270 },
];

/** Four L-shaped viewfinder corners. Breathe while hunting, snap in when locked. */
export default function Reticle({ active = false, locked = false }) {
    const reduce = useReducedMotion();
    const inset = locked ? 12 : 0;

    return (
        <motion.div
            aria-hidden="true"
            className="pointer-events-none absolute inset-3 sm:inset-4"
            animate={
                reduce
                    ? { scale: 1 }
                    : locked
                    ? { scale: 0.94 }
                    : active
                    ? { scale: [1, 1.015, 1] }
                    : { scale: 1 }
            }
            transition={locked ? { type: 'spring', stiffness: 520, damping: 34 } : { duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
        >
            {CORNERS.map(({ pos, rot }) => (
                <motion.span
                    key={pos}
                    className={cx('absolute h-7 w-7 sm:h-8 sm:w-8', pos)}
                    style={{ rotate: rot }}
                    animate={{ x: inset * (rot === 0 || rot === 270 ? 1 : -1), y: inset * (rot < 180 ? 1 : -1) }}
                    transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                >
                    <span
                        className={cx(
                            'absolute left-0 top-0 h-full w-[2px] rounded-full transition-colors duration-300',
                            locked ? 'bg-signal-400' : active ? 'bg-signal-400/70' : 'bg-white/20'
                        )}
                    />
                    <span
                        className={cx(
                            'absolute left-0 top-0 h-[2px] w-full rounded-full transition-colors duration-300',
                            locked ? 'bg-signal-400' : active ? 'bg-signal-400/70' : 'bg-white/20'
                        )}
                    />
                </motion.span>
            ))}
        </motion.div>
    );
}
