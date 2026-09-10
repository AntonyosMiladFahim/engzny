import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { toast } from './components/ui/toast';

/* ------------------------------------------------------------------ */
/* PWA head tags                                                        */
/* ------------------------------------------------------------------ */
/**
 * These belong in index.html. Until that file is edited they are ensured
 * here, idempotently, before React mounts so Chrome's installability check
 * and iOS's home-screen metadata both see them.
 */
const HEAD_TAGS = [
    ['link', { rel: 'manifest', href: '/manifest.json' }],
    ['meta', { name: 'theme-color', content: '#0B0D10' }],
    ['meta', { name: 'color-scheme', content: 'dark' }],
    ['meta', { name: 'application-name', content: 'engzny' }],
    ['meta', { name: 'mobile-web-app-capable', content: 'yes' }],
    ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
    ['meta', { name: 'apple-mobile-web-app-title', content: 'engzny' }],
    ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }],
    ['link', { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/icons/icon.svg' }],
];

function ensureHeadTags() {
    for (const [tag, attrs] of HEAD_TAGS) {
        const key = attrs.rel ? `${tag}[rel="${attrs.rel}"]` : `${tag}[name="${attrs.name}"]`;
        const existing = document.head.querySelector(key);
        if (existing) {
            // Replace Vite's placeholder favicon; leave anything else the author set.
            if (attrs.rel === 'icon' && /vite\.svg$/.test(existing.getAttribute('href') || '')) {
                existing.setAttribute('href', attrs.href);
            }
            continue;
        }
        const el = document.createElement(tag);
        Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        document.head.appendChild(el);
    }
}

/* ------------------------------------------------------------------ */
/* Service worker                                                       */
/* ------------------------------------------------------------------ */

const SW_URL = '/service-worker.js';
const SW_ENABLED = import.meta.env.PROD || localStorage.getItem('engzny.sw') === '1';

/** Request/response over a MessageChannel with the active worker. */
function swRequest(message, { timeout = 8000 } = {}) {
    return new Promise((resolve, reject) => {
        const controller = navigator.serviceWorker?.controller;
        if (!controller) return reject(new Error('No active service worker'));
        const channel = new MessageChannel();
        const timer = setTimeout(() => reject(new Error('Service worker did not respond')), timeout);
        channel.port1.onmessage = (e) => {
            clearTimeout(timer);
            if (e.data?.type === 'ERROR') reject(new Error(e.data.message));
            else resolve(e.data);
        };
        controller.postMessage(message, [channel.port2]);
    });
}

/**
 * Tiny client for the share inbox the worker fills from POST /share and
 * from file_handlers. The React layer consumes it (window.engzny.shareInbox)
 * without duplicating any IndexedDB code.
 */
const shareInbox = {
    list: () => swRequest({ type: 'SHARE_LIST' }).then((r) => r.items),
    take: (id) => swRequest({ type: 'SHARE_TAKE', id }).then((r) => r.item),
    delete: (id) => swRequest({ type: 'SHARE_DELETE', id }),
    put: (files, meta) => swRequest({ type: 'SHARE_PUT', files, meta }).then((r) => r.ids),
};

function announceShare(ids, files) {
    window.dispatchEvent(new CustomEvent('share:received', { detail: { ids, files } }));
    const n = ids.length;
    const name = files?.[0]?.name;
    toast.success(
        n === 1 ? (name ? `“${name}” is ready to summarise.` : 'Your voice note is ready to summarise.') : `${n} voice notes are ready to summarise.`,
        { key: 'share', title: n === 1 ? 'Voice note received' : 'Voice notes received', duration: 10000 }
    );
}

function handleLandingParams() {
    const params = new URLSearchParams(window.location.search);
    const share = params.get('share');
    if (!share) return;
    if (share === 'error') {
        toast.error('The shared file could not be stored. Try sharing it again.', { key: 'share', title: 'Share failed' });
    } else if (share === 'empty') {
        toast.error('Nothing arrived. Share the voice note itself, not just a link.', { key: 'share', title: 'No audio in that share' });
    } else {
        const ids = share.split(',').filter(Boolean);
        shareInbox
            .list()
            .then((items) => announceShare(ids, items.filter((i) => ids.includes(i.id))))
            .catch(() => announceShare(ids, []));
    }
    // Clean the URL so a refresh does not re-announce.
    params.delete('share');
    const clean = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', clean);
}

function watchForUpdates(registration) {
    let reloading = false;

    const promptReload = (worker) => {
        toast.info('A new version of engzny is ready.', {
            key: 'sw-update',
            title: 'Update available',
            duration: 0,
            action: {
                label: 'Reload now',
                onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }),
            },
        });
    };

    if (registration.waiting && navigator.serviceWorker.controller) promptReload(registration.waiting);

    registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) promptReload(worker);
        });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
    });

    // Check for a new build whenever the user comes back to the tab.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !SW_ENABLED) return;

    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/', updateViaCache: 'none' });
            watchForUpdates(registration);
        } catch (err) {
            // Never let a worker failure affect the app itself.
            console.warn('[engzny] service worker registration failed:', err);
        }
    });

    navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data || {};
        if (data.type === 'SHARE_RECEIVED') announceShare(data.ids || [], data.files || []);
    });
}

/* ------------------------------------------------------------------ */
/* OS integration: file handlers + custom install prompt                */
/* ------------------------------------------------------------------ */

function wireLaunchQueue() {
    if (!('launchQueue' in window)) return;
    window.launchQueue.setConsumer(async (launchParams) => {
        const handles = launchParams.files || [];
        if (!handles.length) return;
        try {
            const files = await Promise.all(handles.map((h) => h.getFile()));
            await navigator.serviceWorker.ready;
            const ids = await shareInbox.put(files, { title: '', text: '', url: '' });
            announceShare(ids, files.map((f) => ({ name: f.name, type: f.type, size: f.size })));
        } catch (err) {
            toast.error(err.message || 'Could not open the audio file.', { key: 'share', title: 'Open failed' });
        }
    });
}

function captureInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (event) => {
        // Suppress the browser's mini-infobar; the UI layer can call
        // window.engzny.promptInstall() from a designed button instead.
        event.preventDefault();
        window.engzny.installPrompt = event;
        window.dispatchEvent(new CustomEvent('pwa:installable'));
    });
    window.addEventListener('appinstalled', () => {
        window.engzny.installPrompt = null;
        window.dispatchEvent(new CustomEvent('pwa:installed'));
        toast.success('engzny is on your home screen.', { key: 'install', title: 'Installed' });
    });
}

window.engzny = {
    shareInbox,
    installPrompt: null,
    async promptInstall() {
        const evt = window.engzny.installPrompt;
        if (!evt) return null;
        evt.prompt();
        const choice = await evt.userChoice;
        window.engzny.installPrompt = null;
        return choice?.outcome ?? null;
    },
    isStandalone: () =>
        window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true,
};

/* ------------------------------------------------------------------ */
/* Boot                                                                 */
/* ------------------------------------------------------------------ */

ensureHeadTags();
registerServiceWorker();
wireLaunchQueue();
captureInstallPrompt();
handleLandingParams();

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
