import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api, { authApi } from '../services/api';
import { AuthProvider } from '../context/AuthContext';
import Dashboard from '../pages/Dashboard';
import { seedSession } from './utils';

vi.mock('../services/api', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        default: { get: vi.fn(), post: vi.fn() },
        authApi: { login: vi.fn(), register: vi.fn(), me: vi.fn() },
    };
});

const FOLDERS = [
    { _id: 'f1', name: 'Work', count: 2 },
    { _id: 'f2', name: 'Family', count: 1 },
];
const NOTES = [
    { _id: 'n1', sender: 'Omar Hassan', senderId: '201001234567@c.us', summary: 'Client wants the deck moved to Thursday and the pricing slide simplified.', duration: 272, createdAt: '2026-09-09T10:00:00Z', folder: { _id: 'f1', name: 'Work' }, tags: ['deadline'] },
    { _id: 'n2', sender: 'Mariam', senderId: '201119876543@c.us', summary: 'Reminder to book the venue before the deposit deadline on Friday.', duration: 61, createdAt: '2026-09-08T09:00:00Z', folder: { _id: 'f1', name: 'Work' } },
    { _id: 'n3', sender: 'Mama', senderId: '201005555555@c.us', summary: 'Dinner is at eight, bring the good plates.', transcript: 'Habibi, dinner is at eight tonight. Bring the good plates from the top shelf.', duration: 34, createdAt: '2026-09-07T18:00:00Z', folder: { _id: 'f2', name: 'Family' } },
];
// The third has no display name on purpose: it must fall back to the phone.
const CONTACTS = [
    { senderId: '201001234567@c.us', senderName: 'Omar Hassan', count: 1, lastNoteAt: '2026-09-09T10:00:00Z' },
    { senderId: '201119876543@c.us', senderName: 'Mariam', count: 1, lastNoteAt: '2026-09-08T09:00:00Z' },
    { senderId: '201005555555@c.us', senderName: '', count: 1, lastNoteAt: '2026-09-07T18:00:00Z' },
];

function mockBackend({
    folders = FOLDERS,
    notes = NOTES,
    contacts = CONTACTS,
    status = 'WORKING',
    failNotes = false,
    failFolders = false,
    failContacts = false,
} = {}) {
    api.get.mockImplementation((url, config) => {
        if (url === '/folders') return failFolders ? Promise.reject(new Error('folders 500')) : Promise.resolve({ data: folders });
        if (url === '/notes/contacts') {
            return failContacts ? Promise.reject(new Error('contacts 500')) : Promise.resolve({ data: { contacts } });
        }
        if (url === '/notes') {
            if (failNotes) return Promise.reject(new Error('notes 503'));
            const { folder, sender, search } = config?.params ?? {};
            let list = notes;
            if (folder) list = list.filter((n) => n.folder?._id === folder);
            if (sender) list = list.filter((n) => n.senderId === sender);
            // Stand-in for the $text index: OR across terms, sender + summary.
            if (search) {
                const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
                list = list.filter((n) =>
                    terms.some((t) => `${n.sender} ${n.summary}`.toLowerCase().includes(t))
                );
            }
            return Promise.resolve({ data: { notes: list } });
        }
        if (url === '/waha/status') return Promise.resolve({ data: { status } });
        return Promise.reject(new Error(`unexpected GET ${url}`));
    });
}

/** The sender name now appears in both a card and the contacts rail. */
const contactsRail = () => within(screen.getByRole('navigation', { name: /contacts/i }));
const cards = () => screen.queryAllByRole('article');
const cardFor = (sender) => cards().find((c) => within(c).queryByText(sender)) ?? null;
const findCardFor = (sender) => waitFor(() => expect(cardFor(sender)).toBeTruthy());

function renderDashboard(path = '/dashboard') {
    const { user } = seedSession({ id: 'u1', name: 'Ada', email: 'ada@example.com' });
    authApi.me.mockResolvedValue({ user });
    return render(
        <MemoryRouter initialEntries={[path]}>
            <AuthProvider>
                <Routes>
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/connect" element={<h1>Connect stub</h1>} />
                </Routes>
            </AuthProvider>
        </MemoryRouter>
    );
}

beforeEach(() => vi.clearAllMocks());

describe('Dashboard', () => {
    it('renders folders in the sidebar and voice notes in the grid', async () => {
        mockBackend();
        renderDashboard();

        expect(screen.getByRole('heading', { name: /^dashboard$/i })).toBeInTheDocument();
        expect(screen.getByText(/welcome, ada/i)).toBeInTheDocument();

        const sidebar = within(screen.getByRole('navigation', { name: /folders/i }));
        expect(await sidebar.findByRole('button', { name: /^work/i })).toBeInTheDocument();
        expect(sidebar.getByRole('button', { name: /^family/i })).toBeInTheDocument();

        await findCardFor('Omar Hassan');
        expect(cardFor('Mariam')).toBeTruthy();
        expect(cardFor('Mama')).toBeTruthy();
        expect(screen.getByText('4:32')).toBeInTheDocument(); // 272s
        expect(cards()).toHaveLength(3);
        expect(screen.getByText(/3 notes · 2 folders/i)).toBeInTheDocument();
        expect(screen.getAllByText(/whatsapp linked/i).length).toBeGreaterThan(0); // mobile + desktop pills
    });

    it('groups senders into a contacts rail, falling back to the phone number when unnamed', async () => {
        mockBackend();
        renderDashboard();

        const rail = contactsRail();
        expect(await rail.findByRole('button', { name: /omar hassan/i })).toBeInTheDocument();
        expect(rail.getByRole('button', { name: /mariam/i })).toBeInTheDocument();
        // No notifyName ever arrived for this one — it must read as a number,
        // never as an empty row.
        expect(rail.getByRole('button', { name: /\+201005555555/ })).toBeInTheDocument();
        expect(rail.queryByText(/unknown contact/i)).toBeNull();
    });

    it('filters the grid by contact and re-queries with ?sender=', async () => {
        mockBackend();
        const user = userEvent.setup();
        renderDashboard();
        await findCardFor('Omar Hassan');

        await user.click(contactsRail().getByRole('button', { name: /mariam/i }));

        await waitFor(() => expect(cards()).toHaveLength(1));
        expect(cardFor('Mariam')).toBeTruthy();
        expect(cardFor('Omar Hassan')).toBeNull();
        expect(api.get).toHaveBeenCalledWith('/notes', expect.objectContaining({ params: { sender: '201119876543@c.us' } }));

        // The chip is the way back for anyone whose sidebar is off-screen.
        await user.click(screen.getByRole('button', { name: /clear contact filter/i }));
        await waitFor(() => expect(cards()).toHaveLength(3));
    });

    it('runs the debounced deep search against the backend and marks the hits', async () => {
        mockBackend();
        const user = userEvent.setup();
        renderDashboard();
        await findCardFor('Omar Hassan');

        await user.type(screen.getByRole('searchbox', { name: /search notes/i }), 'deposit');

        await waitFor(() =>
            expect(api.get).toHaveBeenCalledWith('/notes', expect.objectContaining({ params: { search: 'deposit' } }))
        );
        await waitFor(() => expect(cards()).toHaveLength(1));
        expect(within(cards()[0]).getByText('deposit').tagName).toBe('MARK');
    });

    it('filters notes by folder via the URL search param and re-queries the API', async () => {
        mockBackend();
        const user = userEvent.setup();
        renderDashboard();

        const sidebar = within(screen.getByRole('navigation', { name: /folders/i }));
        await user.click(await sidebar.findByRole('button', { name: /^family/i }));

        expect(await screen.findByRole('heading', { level: 2, name: 'Family' })).toBeInTheDocument();
        await waitFor(() => expect(cards()).toHaveLength(1));
        expect(cardFor('Mama')).toBeTruthy();
        expect(cardFor('Omar Hassan')).toBeNull();
        expect(api.get).toHaveBeenCalledWith('/notes', expect.objectContaining({ params: { folder: 'f2' } }));
    });

    it('starts on a folder when the URL already has ?folder=', async () => {
        mockBackend();
        renderDashboard('/dashboard?folder=f1');
        await waitFor(() => expect(cards()).toHaveLength(2));
        expect(screen.getByRole('heading', { level: 2, name: 'Work' })).toBeInTheDocument();
    });

    it('narrows the grid on the very first keystroke, before the debounce fires', async () => {
        mockBackend();
        const user = userEvent.setup();
        renderDashboard();
        await findCardFor('Omar Hassan');

        await user.type(screen.getByRole('searchbox', { name: /search notes/i }), 'venue');
        expect(cards()).toHaveLength(1);
        expect(cardFor('Mariam')).toBeTruthy();

        await user.clear(screen.getByRole('searchbox', { name: /search notes/i }));
        await user.type(screen.getByRole('searchbox', { name: /search notes/i }), 'zzzz');
        expect(screen.getByText(/nothing matches that/i)).toBeInTheDocument();
    });

    it('expands a card to reveal the transcript', async () => {
        mockBackend();
        const user = userEvent.setup();
        renderDashboard();
        await findCardFor('Mama');

        expect(screen.queryByText(/bring the good plates from the top shelf/i)).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /show more/i }));
        expect(screen.getByText(/bring the good plates from the top shelf/i)).toBeInTheDocument();
    });

    it('shows an inline error state with retry when notes fail to load', async () => {
        mockBackend({ failNotes: true });
        const user = userEvent.setup();
        renderDashboard();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/load your notes/i);
        expect(alert).toHaveTextContent(/notes 503/i);

        mockBackend();
        await user.click(within(alert).getByRole('button', { name: /try again/i }));
        await findCardFor('Omar Hassan');
    });

    it('keeps the rest of the library usable when the contacts endpoint fails', async () => {
        mockBackend({ failContacts: true });
        renderDashboard();

        await findCardFor('Omar Hassan');
        expect(await contactsRail().findByText(/contacts unavailable/i)).toBeInTheDocument();
    });

    it('raises a toast with a retry action when folders fail to load, never alert()', async () => {
        const alertSpy = vi.spyOn(window, 'alert');
        mockBackend({ failFolders: true });
        const user = userEvent.setup();
        renderDashboard();

        expect(await screen.findByText(/load folders/i)).toBeInTheDocument();
        expect(alertSpy).not.toHaveBeenCalled();

        mockBackend();
        await user.click(screen.getByRole('button', { name: /^retry$/i }));
        const sidebar = within(screen.getByRole('navigation', { name: /folders/i }));
        expect(await sidebar.findByRole('button', { name: /^work/i })).toBeInTheDocument();
    });

    it('points unlinked users to /connect from the connection pill and the empty state', async () => {
        mockBackend({ notes: [], contacts: [], status: 'SCAN_QR_CODE' });
        renderDashboard();

        expect(await screen.findByText(/quiet in here/i)).toBeInTheDocument();
        const links = screen.getAllByRole('link', { name: /connect whatsapp|not linked/i });
        expect(links.length).toBeGreaterThan(0);
        links.forEach((l) => expect(l).toHaveAttribute('href', '/connect'));
    });

    it('opens the mobile folder drawer from the bottom nav and closes it with Escape', async () => {
        mockBackend();
        const user = userEvent.setup();
        renderDashboard();
        await findCardFor('Omar Hassan');

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /^folders$/i }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('heading', { name: /folders/i })).toBeInTheDocument();
        expect(within(dialog).getByRole('heading', { name: /contacts/i })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /^family/i })).toBeInTheDocument();

        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('selecting a folder in the drawer closes it and filters the grid', async () => {
        mockBackend();
        const user = userEvent.setup();
        renderDashboard();
        await findCardFor('Omar Hassan');

        await user.click(screen.getByRole('button', { name: /^folders$/i }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: /^work/i }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        await waitFor(() => expect(cards()).toHaveLength(2));
    });
});
