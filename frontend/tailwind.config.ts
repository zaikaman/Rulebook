import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: 'var(--rb-surface)',
        'surface-raised': 'var(--rb-surface-raised)',
        border: 'var(--rb-border)',
        ink: 'var(--rb-ink)',
        'ink-muted': 'var(--rb-ink-muted)',
        automation: 'var(--rb-automation)',
        funds: 'var(--rb-funds)',
        active: 'var(--rb-status-active)',
        paused: 'var(--rb-status-paused)',
        cancelled: 'var(--rb-status-cancelled)',
        latched: 'var(--rb-status-latched)',
        silent: 'var(--rb-status-silent)',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        heading: ['var(--font-manrope)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
