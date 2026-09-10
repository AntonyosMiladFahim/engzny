/** @type {import('tailwindcss').Config} */
const defaultTheme = require('tailwindcss/defaultTheme');

/*
 * engzny design tokens
 * --------------------
 * Dark-only, "configured GNOME desktop" aesthetic: ink-black surfaces with a
 * faint warm tint, hairline borders, one loud chartreuse accent (signal) and a
 * quiet teal counterpart (verdigris). Errors use ember, never red-500.
 */
module.exports = {
    content: ['./index.html', './src/**/*.{js,jsx}'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                ink: {
                    950: '#070809',
                    900: '#0B0D10',
                    800: '#111419',
                    700: '#181C23',
                    600: '#20262F',
                    500: '#2B333E',
                },
                fog: {
                    50: '#F7F8FA',
                    100: '#E9ECF1',
                    200: '#CBD2DC',
                    300: '#A6B0BE',
                    400: '#7E8998',
                    500: '#5C6675',
                    600: '#414A57',
                },
                signal: {
                    200: '#EEFBB2',
                    300: '#DDF77E',
                    400: '#C9F04A',
                    500: '#B5E02F',
                    600: '#93BD1E',
                },
                verdigris: {
                    300: '#8FE3D4',
                    400: '#5FD3C0',
                    500: '#3FB8A6',
                },
                ember: {
                    200: '#FFD2C2',
                    300: '#FFB39A',
                    400: '#FF8A65',
                    500: '#F2663F',
                },
            },
            fontFamily: {
                sans: ['Cantarell', 'Inter', ...defaultTheme.fontFamily.sans],
                mono: ['"JetBrains Mono"', ...defaultTheme.fontFamily.mono],
            },
            fontSize: {
                // Fluid display sizes: min, preferred (viewport-based), max.
                display: ['clamp(2.5rem, 1.6rem + 3.2vw, 4.5rem)', { lineHeight: '0.98', letterSpacing: '-0.035em', fontWeight: '700' }],
                'display-sm': ['clamp(1.75rem, 1.3rem + 1.6vw, 2.5rem)', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '700' }],
                title: ['1.625rem', { lineHeight: '1.15', letterSpacing: '-0.025em', fontWeight: '700' }],
                eyebrow: ['0.6875rem', { lineHeight: '1', letterSpacing: '0.16em', fontWeight: '500' }],
            },
            borderRadius: {
                xl2: '1.125rem',
                '3xl': '1.75rem',
                '4xl': '2.25rem',
            },
            boxShadow: {
                // Layered "material" shadows: a hairline inner highlight + two soft depth layers.
                glass: '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 32px 80px -32px rgba(0,0,0,0.85), 0 12px 32px -16px rgba(0,0,0,0.6)',
                'glass-sm': '0 1px 0 0 rgba(255,255,255,0.05) inset, 0 10px 30px -14px rgba(0,0,0,0.7)',
                hairline: 'inset 0 0 0 1px rgba(255,255,255,0.07)',
                signal: '0 12px 36px -12px rgba(201,240,74,0.55), 0 1px 0 0 rgba(255,255,255,0.35) inset',
                'signal-sm': '0 6px 18px -8px rgba(201,240,74,0.5), 0 1px 0 0 rgba(255,255,255,0.3) inset',
                focus: '0 0 0 4px rgba(201,240,74,0.18)',
            },
            backdropBlur: {
                xs: '2px',
                '3xl': '48px',
            },
            backgroundImage: {
                // 56px hairline grid; masked in the component so it fades out at the edges.
                grid: 'linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)',
                // Film-grain noise (SVG turbulence), applied at ~4% opacity over the backdrop.
                noise: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E\")",
                'signal-sheen': 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 45%)',
            },
            transitionTimingFunction: {
                // Fast-out, settle-in: feels like a compositor, not a CSS demo.
                snap: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
                'snap-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
            },
            transitionDuration: {
                150: '150ms',
                250: '250ms',
            },
            keyframes: {
                'spin-slow': { to: { transform: 'rotate(360deg)' } },
                'pulse-dot': {
                    '0%, 100%': { opacity: '1', transform: 'scale(1)' },
                    '50%': { opacity: '0.45', transform: 'scale(0.8)' },
                },
                shimmer: {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(100%)' },
                },
            },
            animation: {
                'spin-slow': 'spin-slow 1.1s linear infinite',
                'pulse-dot': 'pulse-dot 2.2s ease-in-out infinite',
                shimmer: 'shimmer 1.6s ease-in-out infinite',
            },
            screens: {
                xs: '420px',
            },
        },
    },
    plugins: [],
};
