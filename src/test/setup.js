import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';
import { toast } from '../components/ui/toast';

beforeAll(() => {
    // jsdom gaps used by framer-motion / useTilt / Dashboard search.
    if (!window.matchMedia) {
        window.matchMedia = vi.fn().mockImplementation((query) => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
    }
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
    window.scrollTo = vi.fn(); // jsdom ships a 'not implemented' stub that logs errors
    if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:mock');
    if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
    cleanup();
    toast.clear();
    window.localStorage.clear();
});
