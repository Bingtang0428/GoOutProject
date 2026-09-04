/** @type {import('tailwindcss').Config} */
export default {
  // 自动暗色模式:跟随系统 prefers-color-scheme
  darkMode: 'media',
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        // 语义色均映射到 CSS 变量(支持 /opacity 语法,如 bg-primary/10)
        // 亮/暗两套取值在 src/index.css 中通过 prefers-color-scheme 自动切换
        primary: 'rgb(var(--c-primary) / <alpha-value>)',
        'primary-deep': 'rgb(var(--c-primary-deep) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        'ink-soft': 'rgb(var(--c-ink-soft) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        page: 'rgb(var(--c-bg) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--c-s2) / <alpha-value>)',
        amber: 'rgb(var(--c-amber) / <alpha-value>)',
        rose: 'rgb(var(--c-rose) / <alpha-value>)'
      },
      borderRadius: {
        card: '20px',
        box: '10px',
        pill: '999px'
      },
      boxShadow: {
        card: '0 8px 30px rgba(15, 23, 42, 0.06)',
        'card-hover': '0 12px 40px rgba(183, 89, 115, 0.16)',
        pop: '0 18px 50px rgba(15, 23, 42, 0.16)'
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Inter',
          'SF Pro Text',
          'Segoe UI',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'system-ui',
          'sans-serif'
        ]
      },
      transitionDuration: {
        250: '250ms',
        280: '280ms'
      }
    }
  },
  plugins: []
}
