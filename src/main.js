import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createHead } from '@vueuse/head'
import App from './App.vue'
import router from './router'
import './index.css'

// ★ Font Awesome 自托管:不依赖 cdnjs 外链,避免国内网络加载图标失败
import '@fortawesome/fontawesome-free/css/all.min.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(createHead())

app.mount('#app')
