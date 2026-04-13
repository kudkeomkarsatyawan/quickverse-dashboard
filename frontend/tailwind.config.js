/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        mono: ['"SF Mono"', '"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
      },
      colors: {
        canvas:    'var(--canvas)',
        raised:    'var(--raised)',
        overlay:   'var(--overlay)',
        inset:     'var(--inset)',
        line:      'var(--line)',
        'line-strong': 'var(--line-strong)',
        ink: {
          DEFAULT: 'var(--ink)',
          secondary: 'var(--ink-secondary)',
          tertiary: 'var(--ink-tertiary)',
          faint: 'var(--ink-faint)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          soft: 'var(--accent-soft)',
          hover: 'var(--accent-hover)',
        },
      },
      borderRadius: {
        DEFAULT: '0.5rem',
      },
      fontSize: {
        '2xs': ['0.625rem', '0.875rem'],
      },
    },
  },
  plugins: [],
}
