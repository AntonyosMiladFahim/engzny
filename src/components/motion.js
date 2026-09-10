/**
 * Shared motion vocabulary. Springs are tuned to settle in < 400ms so the UI
 * feels like a compositor moving layers, not a DOM fade.
 */
export const SPRING_SNAPPY = { type: 'spring', stiffness: 560, damping: 42, mass: 0.7 };
export const SPRING_SOFT = { type: 'spring', stiffness: 260, damping: 32, mass: 0.9 };
export const EASE_SNAP = [0.2, 0.8, 0.2, 1];

export const stagger = (delayChildren = 0.06, staggerChildren = 0.045) => ({
    hidden: {},
    show: { transition: { delayChildren, staggerChildren } },
});

export const rise = {
    hidden: { opacity: 0, y: 14 },
    show: { opacity: 1, y: 0, transition: SPRING_SNAPPY },
};

export const riseSoft = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: SPRING_SOFT },
};

export const surface = {
    hidden: { opacity: 0, y: 18, scale: 0.985, filter: 'blur(6px)' },
    show: {
        opacity: 1,
        y: 0,
        scale: 1,
        filter: 'blur(0px)',
        transition: { ...SPRING_SNAPPY, filter: { duration: 0.32, ease: EASE_SNAP } },
    },
};

export const collapse = {
    initial: { opacity: 0, height: 0, y: -4 },
    animate: { opacity: 1, height: 'auto', y: 0, transition: SPRING_SNAPPY },
    exit: { opacity: 0, height: 0, y: -4, transition: { duration: 0.16, ease: EASE_SNAP } },
};

export const SHAKE = {
    x: [0, -7, 7, -5, 5, -2, 2, 0],
    transition: { duration: 0.42, ease: 'easeInOut' },
};
