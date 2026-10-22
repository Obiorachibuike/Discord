import type { Config } from 'tailwindcss';
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['var(--font-sans)', 'Inter', 'sans-serif'], display: ['var(--font-display)', 'Inter', 'sans-serif'] },
      colors: {
        canvas: 'hsl(var(--canvas))', panel: 'hsl(var(--panel))', elevated: 'hsl(var(--elevated))',
        muted: 'hsl(var(--muted))', line: 'hsl(var(--line))', ink: 'hsl(var(--ink))',
        subtle: 'hsl(var(--subtle))', accent: 'hsl(var(--accent))', 'accent-soft': 'hsl(var(--accent-soft))'
      },
      boxShadow: { float: '0 18px 70px rgba(0,0,0,.22)' },
      animation: { 'fade-in': 'fadeIn .22s ease-out', 'slide-up': 'slideUp .35s ease-out' },
      keyframes: { fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } }, slideUp: { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } } }
    }
  }, plugins: []
} satisfies Config;
