import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createHead } from '@vueuse/head'
import App from './App.vue'
import router from './router'
import './index.css'

// ★ Font Awesome 自托管:不依赖 cdnjs 外链,避免国内网络加载图标失败
import '@fortawesome/fontawesome-free/css/all.min.css'

import { isSupabase } from './api/supabase'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(createHead())

app.mount('#app')

// 版本指纹:排障用。浏览器控制台应打印此行
console.info(
  `[兔兔同行] 版本 2026.09.07-3 · 模式:${isSupabase ? '云端(Supabase)' : '本地演示'}` +
    ` · URL:${import.meta.env.VITE_SUPABASE_URL || '(未配置)'}`
)

// PWA:生产环境注册 Service Worker(离线外壳 + 可安装)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[pwa] 注册失败', e))
  })
}
