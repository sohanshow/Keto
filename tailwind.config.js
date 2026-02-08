/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // True black theme
        void: '#000000',
        carbon: '#0a0a0a',
        charcoal: '#121212',
        graphite: '#1a1a1a',
        smoke: '#2a2a2a',
        // Warm accent
        gold: '#d4a853',
        amber: '#f5c563',
        ember: '#e8a045',
        // Neutrals
        ash: '#404040',
        silver: '#888888',
      },
      fontFamily: {
        display: ['Playfair Display', 'serif'],
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'float': 'float 6s ease-in-out infinite',
        'breathe': 'breathe 2.5s ease-in-out infinite',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 20px rgba(212, 168, 83, 0.2)' },
          '100%': { boxShadow: '0 0 40px rgba(212, 168, 83, 0.4), 0 0 60px rgba(212, 168, 83, 0.2)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        breathe: {
          '0%, 100%': { 
            transform: 'scale(1)',
            boxShadow: '0 0 30px rgba(212, 168, 83, 0.3)',
          },
          '50%': { 
            transform: 'scale(1.03)',
            boxShadow: '0 0 50px rgba(212, 168, 83, 0.5)',
          },
        },
      },
    },
  },
  plugins: [],
};
