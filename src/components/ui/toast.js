/**
 * Framework-free toast store. Any module can call `toast.error(...)`; the
 * <Toaster /> component subscribes and renders. Toasts with the same `key`
 * replace each other, so a flapping poller never stacks ten identical errors.
 */
const listeners = new Set();
const timers = new Map();
let toasts = [];
let seq = 0;

const emit = () => listeners.forEach((l) => l(toasts));

function setToasts(next) {
    toasts = next;
    emit();
}

export function dismiss(id) {
    if (timers.has(id)) {
        clearTimeout(timers.get(id));
        timers.delete(id);
    }
    if (toasts.some((t) => t.id === id)) setToasts(toasts.filter((t) => t.id !== id));
}

export function show({ title, message, tone = 'neutral', duration = 5000, key, action } = {}) {
    if (key) {
        const existing = toasts.find((t) => t.key === key);
        if (existing) dismiss(existing.id);
    }
    const id = ++seq;
    const item = { id, key, title, message, tone, action, createdAt: Date.now() };
    setToasts([...toasts, item].slice(-4)); // never more than four on screen

    if (duration > 0 && Number.isFinite(duration)) {
        timers.set(
            id,
            setTimeout(() => dismiss(id), duration)
        );
    }
    return id;
}

export const toast = {
    show,
    dismiss,
    clear() {
        timers.forEach((t) => clearTimeout(t));
        timers.clear();
        setToasts([]);
    },
    error: (message, opts = {}) => show({ tone: 'error', title: 'Something went wrong', message, duration: 7000, ...opts }),
    success: (message, opts = {}) => show({ tone: 'success', title: 'Done', message, duration: 4000, ...opts }),
    info: (message, opts = {}) => show({ tone: 'neutral', message, ...opts }),
};

export function subscribe(listener) {
    listeners.add(listener);
    listener(toasts);
    return () => listeners.delete(listener);
}

export function getToasts() {
    return toasts;
}
