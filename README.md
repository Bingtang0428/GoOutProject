<<<<<<< HEAD
# 兔兔同行 · 自驾旅行企划(多人协作版)

> 雨林通往雪景,你向往的旅行 ♪

一款面向自驾游小团队的轻量级计划管理工具。清新、通透、有呼吸感,像一本精致的旅行手账。
路线(时间轴+地图)、食宿、待办、收藏攻略、提醒、分账、大交通,全队企划实时同步。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Vue 3 (Composition API) + Vite + Pinia + Vue Router |
| 样式 | Tailwind CSS(设计令牌经 CSS 变量,`prefers-color-scheme` 自动暗色) |
| 图标 | Font Awesome 6(免费版,CDN) |
| 工具 | @vueuse/core(滚动/点击等)、@vueuse/head(页面元标签) |
| 后端 | Supabase(Postgres + Realtime + Storage),未配置时自动降级为本地演示模式 |
| 部署 | Vercel(SPA rewrites 已配置于 `vercel.json`) |

## 快速开始

```bash
npm install
npm run dev        # 无后端配置 → 自动进入「本地演示模式」
npm run build      # 产物在 dist/
```

### Supabase 模式(开启多人实时协作)

1. 在 [supabase.com](https://supabase.com) 创建项目;
2. Dashboard → SQL Editor 运行 [`supabase/schema.sql`](supabase/schema.sql)(建表 + RLS + Storage 桶);
3. 复制 `.env.example` 为 `.env`,填入 URL 与 anon key;
4. 重启 `npm run dev`,登录页将变为邮箱注册/登录。

> 演示模式数据仅存于浏览器 localStorage;接入 Supabase 后所有读写通过
> `postgres_changes` 实时通道同步给每个成员(见 `src/stores/content.js` 注释)。

## 项目结构

```
├── index.html                     # FA6 CDN / 页面骨架
├── tailwind.config.js             # 语义色→CSS 变量、圆角/阴影令牌
├── vercel.json                    # SPA rewrite
├── supabase/
│   └── schema.sql                 # 建表 + RLS + storage 桶(plans/stays/todos/guides/reminders/bills/comments)
└── src/
    ├── main.js / App.vue / index.css   # 全局样式:设计令牌 + fade-up/scale-in 等关键帧
    ├── api/
    │   ├── supabase.js            # 客户端 + Storage 上传(注释清晰)
    │   ├── geocode.js             # OSM Nominatim 地理编码(地图标记定位)
    │   ├── weather.js             # Open-Meteo 天气(按日预报/图标文案)
    │   └── localDb.js             # 演示模式 localStorage 层
    ├── stores/                    # Pinia
    │   ├── auth.js                #   登录(演示 / Supabase 双模式)
    │   ├── plans.js               #   计划 + 权限模型 + 回收站 + 实时订阅
    │   └── content.js             #   路线/食宿/待办/攻略/提醒/分账/建议/大交通/车辆里程(实时通道核心)
    ├── router/index.js
    ├── views/                     # LoginView / HomeView(计划列表+看板+回收站) / PlanView(计划详情)
    ├── components/
    │   ├── ui/                    # BaseModal、BaseCheckbox、BaseButton、BaseTag、Avatar…
    │   ├── layout/                # DesktopSidebar、MobileTopNav、MobileTabBar
    │   ├── home/                  # PlanCard(渐变卡片)、PlanFormModal
    │   ├── plan/                  # PlanPermModal(权限管理)、ExportSheet(导出 PDF/长图)
    │   └── sections/              # Route(时间轴+地图+天气+建议)/ Stay / Todo / Guide / Reminder
    │                             #   / Bill(记账+预算+车辆里程)/ Transits(大交通)
    └── utils/                     # date / misc(配色、ID)/ demoData(内置演示数据)
```

## 功能一览

- **首页看板**:对当前主计划展示 已规划日期 / 整体路线(首尾站点与总地点数)/ 下一站 / 下一项待办任务 / 今日未读提醒,可切换计划并一键跳转对应模块;
- **计划回收站**:演示模式下删除的计划进入回收站(首页垃圾桶图标),内容完整保留,可一键恢复或永久清除;
- **计划列表**:渐变封面卡片,名称、日期、圆形叠放头像、完成度进度条、角色徽标(创建者/参与者/围观者);
- **路线规划**:时间轴逐日排程 + **Leaflet 地图视图** —— 按日同色圆点与路段连线,**单天路段实线、跨天路段虚线**区分(悬停显示时长);自动地理编码补全坐标;每段可「自动算时长」(自驾走 OSRM 路网、公交按系数保守估算并标注"约")或手动填写自驾/公交分钟数;每日附 Open-Meteo 天气;
- **城市选择**:省级→市级级联下拉(china-area-data 内置),创建计划时设置「集合城市」;队员在大交通弹窗里自动带入该默认值、可自行修改,返程自动反向带入;
- **大交通企划**:按「人」规划 到达/离开 两段(飞机/高铁/大巴/自驾),五湖四海先到集合点再同行;顶部总览每种交通的人数与待补充名单;
- **食宿安排**:住宿/餐厅卡片,地址、电话(tel 一键拨打)、标签与预订开关;支持在分账中直接关联记账;
- **TODO List**:圆形复选框旋转打勾、文字变灰删除线;截止日期小圆点标签(已到期 rose / 今天 amber),支持筛选;
- **收藏攻略**:瀑布流,封面可上传 Supabase Storage(演示模式自动转 base64);
- **提醒事项**:按 今天/明天/后续/已过期 分组,未读呼吸点,已读自动变淡;
- **分账**:子视图 = 记账 / 预算看板 / 车辆里程。
  - 记账:每笔「谁付钱 + 涉及分摊的人」,分类联动食宿/路线「一键带入」,按人卡片展示 垫付/应摊/结余 + 转账建议;
  - 预算看板:计划总预算(创建者可设)→ 已花/剩余/超支、进度条、按分类花费可视化与人均参考;
  - 车辆里程:车辆昵称/车牌、加油里程记录,统计百公里油耗与每公里成本;加油可一键「同步进分账(油费)」,删除记录自动撤回对应账单;
- **导出行程单**:任意成员可在计划页导出 —— 打印另存为 PDF 或一键下载长图 PNG(含集合交通/每日路线/食宿/待办/分账结算);
- **条目撤销**:删除任务/食宿/账单/攻略/提醒/交通等条目后,页面底部浮层支持 7 秒内一键撤销(保留原 id 与时间);
- **权限**:创建者(owner_id)可编辑/删除计划并管理成员;参与者(members)可编辑全部内容;围观者(viewers)只读,所有编辑入口与开关自动隐藏。计划页提供「加入为参与者」入口;

## 设计规范速记

- 主题为**豆沙粉**主色 `#B75973`(亮/暗模式自动换深一档或浅一档);点缀 amber-400(提醒)、rose-400(删除/紧急);卡片纯白/半透明毛玻璃;
- 卡片 20px 圆角、内边距 24px;小元素 10px 圆角;间距遵循 8px 网格;
- 阴影 `0 8px 30px rgba(98,62,74,.07)` → 悬浮加深 `0 12px 40px rgba(183,89,115,.18)` 且轻微上浮(仅桌面 hover);
- 所有动效 ease-out、250–300ms;按钮/卡片按下 `scale(0.96)`;勾选「旋转打勾」;
- 顶栏随滚动由透明渐变毛玻璃(`useScroll`);暗色模式自动跟随系统。

> 地图依赖 OpenStreetMap + Nominatim 地理编码,离线或外网受限时路线列表功能不受影响。

## 部署到 Vercel

```bash
npm i -g vercel
vercel            # Framework 自动识别 Vite
```

在 Project → Settings → Environment Variables 中配置 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`,
重新部署后即为云端多人协作版。

> ⚠️ `supabase/schema.sql` 中的 RLS 策略面向原型全放开,正式上线前请替换为基于
> `auth.uid()` / 成员关系(plans.members)的访问控制。
=======
# GoOutProject
逃离工位企划代码仓
>>>>>>> 6390a82c92df6445f5a4c782a00059042c3dbb88
