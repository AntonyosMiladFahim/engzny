import React, { useMemo } from 'react';
import { highlightParts } from '../format';

/**
 * Wraps every occurrence of the active search terms in a <mark>.
 *
 * Tailwind's preflight leaves <mark> with the browser's yellow; the classes
 * here replace it with a signal-tinted plate that sits *inside* the line box
 * (no leading shift) so a highlighted paragraph keeps the same rhythm as an
 * unhighlighted one.
 */
export default function Highlight({ text, query, className }) {
    const parts = useMemo(() => highlightParts(text, query), [text, query]);

    if (parts.length === 1 && !parts[0].hit) {
        return <span className={className}>{parts[0].text}</span>;
    }

    return (
        <span className={className}>
            {parts.map((part, i) =>
                part.hit ? (
                    <mark
                        key={i}
                        className="rounded-[3px] bg-signal-400/[0.18] px-[0.15em] py-[0.05em] text-signal-200 shadow-[inset_0_0_0_1px_rgba(201,240,74,0.22)]"
                    >
                        {part.text}
                    </mark>
                ) : (
                    <React.Fragment key={i}>{part.text}</React.Fragment>
                )
            )}
        </span>
    );
}
