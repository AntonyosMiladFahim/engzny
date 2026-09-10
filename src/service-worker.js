/* eslint-env serviceworker */
/* global self, caches, clients, indexedDB */

/**
 * engzny service worker
 * =====================
 * Goals, in priority order:
 *   1. App shell + hashed bundles + Cantarell/JetBrains Mono fonts load
 *      instantly and work fully offline.
 *   2. /api/* is NEVER cached. Network only, with a structured JSON 503 when
 *      offline so the Axios layer shows a real message instead of hanging.
 *   3. Web Share Target: intercept POST /share, park the shared audio in
 *      IndexedDB, redirect into the app, and tell open clients about it.
 *
 * Caching strategy by route:
 *   navigations           → network-first (3s budget, navigation preload),
 *                           fall back to cached index.html (SPA shell)
 *   /assets/*             → cache-first (Vite content-hashed, immutable)
 *   fonts.googleapis.com  → stale-while-revalidate (CSS may change per UA)
 *   fonts.gstatic.com     → cache-first (immutable font binaries)
 *   other same-origin GET → stale-while-revalidate (manifest, icons, favicon)
 *   /api/*                → network only, never stored
 *
 * Emit this file at the site root as /service-worker.js (see vite.config.js).
 * A worker served from /src/ or /assets/ cannot control "/".
 */

const VERSION = 'v1';
const PREFIX = 'engzny';
const SHELL_CACHE = `${PREFIX}-${VERSION}-shell`;
const ASSET_CACHE = `${PREFIX}-${VERSION}-assets`;
const FONT_CACHE = `${PREFIX}-${VERSION}-fonts`;
const ALL_CACHES = [SHELL_CACHE, ASSET_CACHE, FONT_CACHE];

const SHELL_URL = '/index.html';
const SHARE_PATH = '/share';
const SHARE_LANDING = '/dashboard';
const NAV_TIMEOUT_MS = 3000;

/** Precached at install. index.html is mandatory; the rest are best-effort. */
const PRECACHE_REQUIRED = ['/', SHELL_URL];
const PRECACHE_OPTIONAL = [
    '/manifest.json',
    '/icons/icon.svg',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/maskable-192.png',
    '/icons/maskable-512.png',
    '/icons/monochrome-512.png',
    '/icons/apple-touch-icon.png',
    '/icons/shortcut-notes.png',
    '/icons/shortcut-connect.png',
];

const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

/* --------------------------------------------------------------------- */
/* Install: precache shell, discover hashed bundles, pull the fonts down.  */
/* --------------------------------------------------------------------- */

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            const shell = await caches.open(SHELL_CACHE);
            await shell.addAll(PRECACHE_REQUIRED);
            await addAllSettled(shell, PRECACHE_OPTIONAL);

            const html = await readText(shell, SHELL_URL);
            const assetUrls = discoverAssetUrls(html);
            const assets = await caches.open(ASSET_CACHE);
            await addAllSettled(assets, assetUrls);

            await precacheFonts(assets, assetUrls);
            // Do not skipWaiting here: the page decides when to swap (see SKIP_WAITING).
        })()
    );
});

/* --------------------------------------------------------------------- */
/* Activate: drop old versions, prune orphaned bundles, take control.      */
/* --------------------------------------------------------------------- */

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const names = await caches.keys();
            await Promise.all(
                names
                    .filter((n) => n.startsWith(`${PREFIX}-`) && !ALL_CACHES.includes(n))
                    .map((n) => caches.delete(n))
            );
            await pruneOrphanedAssets();
            if (self.registration.navigationPreload) {
                try {
                    await self.registration.navigationPreload.enable();
                } catch {
                    /* unsupported: fine */
                }
            }
            await clients.claim();
        })()
    );
});

/* --------------------------------------------------------------------- */
/* Fetch router                                                            */
/* --------------------------------------------------------------------- */

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    const sameOrigin = url.origin === self.location.origin;

    // 1. Web Share Target lands here as a POST navigation.
    if (request.method === 'POST' && sameOrigin && url.pathname === SHARE_PATH) {
        event.respondWith(handleShareTarget(event));
        return;
    }

    if (request.method !== 'GET') return; // let the network handle mutations

    // 2. API: network only. Never read from or write to a cache.
    if (sameOrigin && url.pathname.startsWith('/api/')) {
        event.respondWith(networkOnly(request));
        return;
    }

    // 3. Fonts
    if (url.hostname === 'fonts.googleapis.com') {
        event.respondWith(staleWhileRevalidate(request, FONT_CACHE, { cors: true }));
        return;
    }
    if (url.hostname === 'fonts.gstatic.com') {
        event.respondWith(cacheFirst(request, FONT_CACHE, { cors: true }));
        return;
    }

    if (!sameOrigin) return; // other third parties: not our business

    // 4. Navigations → app shell
    if (request.mode === 'navigate') {
        event.respondWith(handleNavigation(event));
        return;
    }

    // 5. Content-hashed bundles: immutable, cache-first.
    if (url.pathname.startsWith('/assets/')) {
        event.respondWith(cacheFirst(request, ASSET_CACHE));
        return;
    }

    // 6. Manifest, icons, favicon, anything else static.
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

/* --------------------------------------------------------------------- */
/* Strategies                                                              */
/* --------------------------------------------------------------------- */

async function networkOnly(request) {
    try {
        return await fetch(request, { cache: 'no-store' });
    } catch (err) {
        return jsonResponse(
            {
                error: 'offline',
                message: 'You appear to be offline. Changes will go through once you reconnect.',
                path: new URL(request.url).pathname,
            },
            503
        );
    }
}

async function cacheFirst(request, cacheName, { cors = false } = {}) {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(request, { ignoreVary: true });
    if (hit) return hit;
    const response = await fetch(cors ? corsRequest(request) : request);
    if (isCacheable(response)) cache.put(request, response.clone()).catch(() => {});
    return response;
}

async function staleWhileRevalidate(request, cacheName, { cors = false } = {}) {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(request, { ignoreVary: true });
    const refresh = fetch(cors ? corsRequest(request) : request)
        .then((response) => {
            if (isCacheable(response)) cache.put(request, response.clone()).catch(() => {});
            return response;
        })
        .catch(() => null);
    if (hit) {
        refresh.catch(() => {});
        return hit;
    }
    const fresh = await refresh;
    return fresh ?? offlineResponse();
}

async function handleNavigation(event) {
    const { request } = event;
    const shell = await caches.open(SHELL_CACHE);

    const network = (async () => {
        const preloaded = event.preloadResponse ? await event.preloadResponse : null;
        return preloaded ?? fetch(request);
    })();

    try {
        const response = await withTimeout(network, NAV_TIMEOUT_MS);
        if (response && response.ok) {
            const copy = response.clone();
            event.waitUntil(refreshShell(shell, copy));
            return response;
        }
        throw new Error(`navigation ${response?.status}`);
    } catch {
        network.catch(() => {}); // don't leave the loser unhandled
        const cached = (await shell.match(SHELL_URL)) || (await shell.match('/'));
        return cached ?? offlineResponse(true);
    }
}

/** After a successful navigation, keep index.html and any new bundles warm. */
async function refreshShell(shell, response) {
    try {
        const html = await response.clone().text();
        if (!/<html[\s>]/i.test(html)) return;
        await shell.put(SHELL_URL, response.clone());
        await shell.put('/', response);
        const assets = await caches.open(ASSET_CACHE);
        const urls = discoverAssetUrls(html);
        const missing = [];
        for (const u of urls) if (!(await assets.match(u))) missing.push(u);
        await addAllSettled(assets, missing);
    } catch {
        /* best effort */
    }
}

/* --------------------------------------------------------------------- */
/* Web Share Target                                                        */
/* --------------------------------------------------------------------- */

const INBOX_DB = 'engzny-share-inbox';
const INBOX_STORE = 'files';
const INBOX_MAX = 12;

async function handleShareTarget(event) {
    let landing = `${SHARE_LANDING}?share=error`;
    try {
        const form = await event.request.formData();
        const files = form
            .getAll('audio')
            .filter((f) => f && typeof f === 'object' && typeof f.size === 'number' && f.size > 0);
        const meta = {
            title: String(form.get('title') ?? ''),
            text: String(form.get('text') ?? ''),
            url: String(form.get('url') ?? ''),
        };

        if (!files.length) {
            landing = `${SHARE_LANDING}?share=empty`;
        } else {
            const ids = [];
            for (const file of files) ids.push(await inboxPut(file, meta));
            await inboxPrune(INBOX_MAX);
            landing = `${SHARE_LANDING}?share=${ids.join(',')}`;

            event.waitUntil(
                broadcast({
                    type: 'SHARE_RECEIVED',
                    ids,
                    files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
                    meta,
                })
            );
        }
    } catch {
        /* fall through with share=error */
    }
    return Response.redirect(new URL(landing, self.location.origin).href, 303);
}

function inboxOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(INBOX_DB, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(INBOX_STORE)) {
                const store = db.createObjectStore(INBOX_STORE, { keyPath: 'id' });
                store.createIndex('receivedAt', 'receivedAt');
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('inbox blocked'));
    });
}

function tx(db, mode, run) {
    return new Promise((resolve, reject) => {
        const t = db.transaction(INBOX_STORE, mode);
        const store = t.objectStore(INBOX_STORE);
        let out;
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('aborted'));
        Promise.resolve(run(store))
            .then((v) => {
                out = v;
            })
            .catch(reject);
    });
}

const reqToPromise = (req) =>
    new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

async function inboxPut(file, meta = {}) {
    const db = await inboxOpen();
    const id = makeId();
    const record = {
        id,
        name: file.name || `voice-note-${id}.ogg`,
        type: file.type || 'application/octet-stream',
        size: file.size,
        receivedAt: Date.now(),
        status: 'pending',
        title: meta.title || '',
        text: meta.text || '',
        url: meta.url || '',
        blob: file,
    };
    await tx(db, 'readwrite', (store) => reqToPromise(store.put(record)));
    db.close();
    return id;
}

async function inboxList() {
    const db = await inboxOpen();
    const all = await tx(db, 'readonly', (store) => reqToPromise(store.getAll()));
    db.close();
    return all
        .sort((a, b) => b.receivedAt - a.receivedAt)
        .map(({ blob, ...rest }) => rest); // metadata only over postMessage
}

async function inboxTake(id) {
    const db = await inboxOpen();
    const record = await tx(db, 'readonly', (store) => reqToPromise(store.get(id)));
    db.close();
    return record ?? null;
}

async function inboxDelete(id) {
    const db = await inboxOpen();
    await tx(db, 'readwrite', (store) => reqToPromise(store.delete(id)));
    db.close();
}

async function inboxPrune(max) {
    const db = await inboxOpen();
    const all = await tx(db, 'readonly', (store) => reqToPromise(store.getAll()));
    const stale = all.sort((a, b) => b.receivedAt - a.receivedAt).slice(max);
    if (stale.length) {
        await tx(db, 'readwrite', (store) => Promise.all(stale.map((r) => reqToPromise(store.delete(r.id)))));
    }
    db.close();
}

/* --------------------------------------------------------------------- */
/* Messages from the page                                                  */
/* --------------------------------------------------------------------- */

self.addEventListener('message', (event) => {
    const data = event.data || {};
    const reply = (payload) => {
        if (event.ports && event.ports[0]) event.ports[0].postMessage(payload);
        else if (event.source) event.source.postMessage(payload);
    };

    switch (data.type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
        case 'GET_VERSION':
            reply({ type: 'VERSION', version: VERSION });
            break;
        case 'SHARE_LIST':
            event.waitUntil(inboxList().then((items) => reply({ type: 'SHARE_LIST', items })).catch((e) => reply(errorMsg(e))));
            break;
        case 'SHARE_TAKE':
            event.waitUntil(inboxTake(data.id).then((item) => reply({ type: 'SHARE_ITEM', item })).catch((e) => reply(errorMsg(e))));
            break;
        case 'SHARE_DELETE':
            event.waitUntil(inboxDelete(data.id).then(() => reply({ type: 'SHARE_DELETED', id: data.id })).catch((e) => reply(errorMsg(e))));
            break;
        case 'SHARE_PUT': {
            // Files handed over by the page (file_handlers / launchQueue) join the same inbox.
            const files = Array.isArray(data.files) ? data.files : [];
            event.waitUntil(
                (async () => {
                    const ids = [];
                    for (const f of files) ids.push(await inboxPut(f, data.meta));
                    await inboxPrune(INBOX_MAX);
                    reply({ type: 'SHARE_STORED', ids });
                })().catch((e) => reply(errorMsg(e)))
            );
            break;
        }
        default:
            break;
    }
});

/* --------------------------------------------------------------------- */
/* Helpers                                                                 */
/* --------------------------------------------------------------------- */

/** Everything index.html references under /assets/ (scripts, styles, modulepreload). */
function discoverAssetUrls(html = '') {
    const urls = new Set();
    const re = /(?:src|href)=["']([^"']*\/assets\/[^"']+)["']/g;
    let m;
    while ((m = re.exec(html))) {
        try {
            urls.add(new URL(m[1], self.location.origin).pathname);
        } catch {
            /* ignore malformed */
        }
    }
    return [...urls];
}

/**
 * Cantarell + JetBrains Mono are pulled via @import inside the built CSS.
 * Find that stylesheet URL, fetch its CSS (the response is UA-specific, so
 * it must be fetched by this browser), then precache every font binary.
 */
async function precacheFonts(assets, assetUrls) {
    const fonts = await caches.open(FONT_CACHE);
    const cssUrls = assetUrls.filter((u) => u.endsWith('.css'));
    const stylesheetUrls = new Set();

    for (const u of cssUrls) {
        const text = await readText(assets, u);
        // Vite emits `@import"https://…"` with no whitespace, and the Google
        // Fonts URL itself contains ";" (weight lists), so terminate on the
        // closing quote / paren only.
        const re = /@import\s*(?:url\(\s*)?["']?(https:\/\/fonts\.googleapis\.com\/[^"')\s]+)/g;
        let m;
        while ((m = re.exec(text))) stylesheetUrls.add(m[1]);
    }

    for (const sheet of stylesheetUrls) {
        try {
            const res = await fetch(sheet, { mode: 'cors', credentials: 'omit' });
            if (!res.ok) continue;
            await fonts.put(sheet, res.clone());
            const css = await res.text();
            const fileUrls = new Set();
            const re = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g;
            let m;
            while ((m = re.exec(css))) fileUrls.add(m[1].replace(/["']/g, ''));
            await Promise.allSettled(
                [...fileUrls].map(async (f) => {
                    const r = await fetch(f, { mode: 'cors', credentials: 'omit' });
                    if (r.ok) await fonts.put(f, r);
                })
            );
        } catch {
            /* offline at install: runtime caching will pick fonts up later */
        }
    }
}

/** Remove cached bundles that the current index.html no longer references. */
async function pruneOrphanedAssets() {
    try {
        const shell = await caches.open(SHELL_CACHE);
        const html = await readText(shell, SHELL_URL);
        const live = new Set(discoverAssetUrls(html));
        if (!live.size) return;
        const assets = await caches.open(ASSET_CACHE);
        const keys = await assets.keys();
        await Promise.all(
            keys
                .filter((req) => {
                    const p = new URL(req.url).pathname;
                    return p.startsWith('/assets/') && !live.has(p);
                })
                .map((req) => assets.delete(req))
        );
    } catch {
        /* best effort */
    }
}

async function addAllSettled(cache, urls) {
    await Promise.allSettled(
        urls.map(async (u) => {
            const res = await fetch(u, { cache: 'no-cache' });
            if (isCacheable(res)) await cache.put(u, res);
        })
    );
}

async function readText(cache, url) {
    const res = await cache.match(url);
    return res ? res.text() : '';
}

function isCacheable(response) {
    return Boolean(response) && (response.ok || response.type === 'opaque') && response.status !== 206;
}

function corsRequest(request) {
    return new Request(request.url, { mode: 'cors', credentials: 'omit', headers: request.headers });
}

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), ms);
        promise.then(
            (v) => {
                clearTimeout(t);
                resolve(v);
            },
            (e) => {
                clearTimeout(t);
                reject(e);
            }
        );
    });
}

async function broadcast(message) {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) c.postMessage(message);
}

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}

function offlineResponse(html = false) {
    if (!html) return new Response('', { status: 504, statusText: 'Offline' });
    return new Response(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>engzny · offline</title><style>html{background:#070809;color:#E9ECF1;font:15px/1.5 Cantarell,system-ui,sans-serif}body{display:grid;place-items:center;min-height:100vh;margin:0}main{text-align:center;padding:2rem}h1{font-size:1.5rem;letter-spacing:-.02em;margin:0 0 .5rem}p{color:#7E8998;margin:0}code{font:12px "JetBrains Mono",monospace;color:#C9F04A}</style></head><body><main><h1>You’re offline</h1><p>The app shell isn’t cached yet. Reconnect once and it will be.</p><p><code>engzny · sw ${VERSION}</code></p></main></body></html>`,
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
}

function errorMsg(e) {
    return { type: 'ERROR', message: e?.message || String(e) };
}

function makeId() {
    if (self.crypto?.randomUUID) return self.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
