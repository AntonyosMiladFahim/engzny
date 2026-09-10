import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Lock } from 'lucide-react';
import Field from './Field';
import cx from './cx';
import { SPRING_SNAPPY } from '../motion';

/** 0–4 heuristic. Deliberately simple; the server is the source of truth. */
export function scorePassword(pw = '') {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8) score += 1;
    if (pw.length >= 12) score += 1;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
    if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score += 1;
    return Math.min(score, 4);
}

const STRENGTH_LABEL = ['', 'Weak', 'Fair', 'Good', 'Strong'];

export default function PasswordField({ id, value = '', showMeter = false, ...props }) {
    const [visible, setVisible] = useState(false);
    const score = useMemo(() => (showMeter ? scorePassword(value) : 0), [showMeter, value]);

    return (
        <div>
            <Field
                id={id}
                icon={Lock}
                type={visible ? 'text' : 'password'}
                value={value}
                trailing={
                    <button
                        type="button"
                        onClick={() => setVisible((v) => !v)}
                        // Intentionally does not contain the word "password" so it never
                        // collides with the input's label for assistive tech / queries.
                        aria-label={visible ? 'Hide characters' : 'Show characters'}
                        aria-pressed={visible}
                        className="grid h-9 w-9 place-items-center rounded-lg text-fog-400 transition-colors duration-150 hover:bg-white/[0.06] hover:text-fog-100 focus-visible:bg-white/[0.06] focus-visible:text-fog-100 focus-visible:outline-none"
                    >
                        {visible ? (
                            <EyeOff aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
                        ) : (
                            <Eye aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
                        )}
                    </button>
                }
                {...props}
            />

            {showMeter && (
                <div className="mt-2.5 flex items-center gap-3" aria-hidden="true">
                    <div className="flex flex-1 gap-1">
                        {[1, 2, 3, 4].map((step) => (
                            <div key={step} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                                <motion.div
                                    initial={false}
                                    animate={{ scaleX: score >= step ? 1 : 0 }}
                                    transition={{ ...SPRING_SNAPPY, delay: step * 0.03 }}
                                    style={{ originX: 0 }}
                                    className={cx(
                                        'h-full w-full rounded-full',
                                        score <= 1 ? 'bg-ember-400' : score === 2 ? 'bg-signal-600' : 'bg-signal-400'
                                    )}
                                />
                            </div>
                        ))}
                    </div>
                    <span className="w-12 text-right font-mono text-[11px] text-fog-400">{STRENGTH_LABEL[score]}</span>
                </div>
            )}
        </div>
    );
}
