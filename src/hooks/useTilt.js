import { useEffect, useState } from 'react';
import { useMotionTemplate, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';

/**
 * Pointer-driven 3D tilt + sheen for cards. Off on touch devices and under
 * prefers-reduced-motion. Max tilt is small on purpose – it should register
 * as weight, not as a gimmick.
 */
export default function useTilt({ max = 3.5, perspective = 900 } = {}) {
    const reduce = useReducedMotion();
    const [enabled, setEnabled] = useState(false);

    useEffect(() => {
        if (reduce || typeof window === 'undefined' || !window.matchMedia) return;
        const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
        const update = () => setEnabled(mq.matches);
        update();
        mq.addEventListener?.('change', update);
        return () => mq.removeEventListener?.('change', update);
    }, [reduce]);

    const px = useMotionValue(0.5);
    const py = useMotionValue(0.5);
    const spring = { stiffness: 320, damping: 28, mass: 0.6 };
    const sx = useSpring(px, spring);
    const sy = useSpring(py, spring);

    const rotateY = useTransform(sx, [0, 1], [-max, max]);
    const rotateX = useTransform(sy, [0, 1], [max, -max]);
    const sheenX = useTransform(sx, (v) => `${v * 100}%`);
    const sheenY = useTransform(sy, (v) => `${v * 100}%`);
    const sheen = useMotionTemplate`radial-gradient(360px circle at ${sheenX} ${sheenY}, rgba(255,255,255,0.07), transparent 60%)`;

    const onPointerMove = (e) => {
        if (!enabled) return;
        const rect = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - rect.left) / rect.width);
        py.set((e.clientY - rect.top) / rect.height);
    };
    const onPointerLeave = () => {
        px.set(0.5);
        py.set(0.5);
    };

    return {
        enabled,
        style: enabled ? { rotateX, rotateY, transformPerspective: perspective } : undefined,
        sheenStyle: enabled ? { backgroundImage: sheen } : undefined,
        handlers: { onPointerMove, onPointerLeave },
    };
}
