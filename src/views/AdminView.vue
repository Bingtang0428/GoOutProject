<script setup>
// ============================================================
// 后台管理(仅 role=admin 可进入)
//  - 计划与人员管理:查看/增减参与者与围观者/删除计划
//  - 邀请码管理:生成(管理员/成员/围观)、撤销、查看使用状态
// ============================================================
import { ref, computed, onMounted } from 'vue'
import { useHead } from '@vueuse/head'
import { usePlansStore } from '@/stores/plans'
import { useAuthStore } from '@/stores/auth'
import { supabase, isSupabase } from '@/api/supabase'
import { makeUuid } from '@/utils/misc'
import { fmtRange } from '@/utils/date'
import DesktopSidebar from '@/components/layout/DesktopSidebar.vue'
import MobileTopNav from '@/components/layout/MobileTopNav.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import Avatar from '@/components/ui/Avatar.vue'

useHead({ title: '后台管理 · 兔兔同行' })

const plansStore = usePlansStore()
const auth = useAuthStore()

const codes = ref([])
const busy = ref(false)
const msg = ref('')

/* ---------- 统计 ---------- */
const peopleSet = computed(() => {
  const s = new Set()
  for (const p of plansStore.plans) {
    for (const m of [...(p.members || []), ...(p.viewers || [])]) s.add(m.id)
  }
  return s
})
const stats = computed(() => ({
  plans: plansStore.plans.length,
  people: peopleSet.value.size,
  codes: codes.value.length,
  unused: codes.value.filter((c) => !c.use_count && !c.revoked).length
}))

async function loadCodes() {
  if (!isSupabase) return
  const { data, error } = await supabase.from('invite_codes').select('*').order('created_at', { ascending: false }).limit(200)
  if (!error) codes.value = data || []
}

onMounted(async () => {
  await plansStore.init()
  await loadCodes()
})

/* ---------- 生成邀请码 ---------- */
const showGen = ref(false)
const genRole = ref('member') // admin | member | viewer
const genPlanId = ref('')
const genLabel = ref('')
const genCode = ref('')
const genMaxUses = ref(1) // 1-100
const genBusy = ref(false)

function randCode(role) {
  const p = role === 'admin' ? 'ADMIN' : 'TT'
  return `${p}-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`
}

function openGen() {
  genRole.value = 'member'
  genPlanId.value = plansStore.plans[0]?.id || ''
  genLabel.value = ''
  genMaxUses.value = 1
  genCode.value = randCode('member')
  showGen.value = true
}

function onGenRoleChange() {
  if (genRole.value !== 'admin') genPlanId.value = plansStore.plans[0]?.id || ''
  else genPlanId.value = ''
  genCode.value = randCode(genRole.value)
}

function usesValue() {
  const n = Math.round(Number(genMaxUses.value))
  return Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 1
}

async function createCode() {
  if (genRole.value !== 'admin' && !genPlanId.value) {
    msg.value = '成员/围观邀请码需要选择对应的计划'
    return
  }
  genBusy.value = true
  msg.value = ''
  try {
    const { error } = await supabase.from('invite_codes').insert({
      id: makeUuid(),
      code: genCode.value,
      role: genRole.value,
      plan_id: genRole.value === 'admin' ? null : genPlanId.value,
      label: genLabel.value.trim(),
      max_uses: usesValue(),
      use_count: 0,
      created_by: auth.user ? { id: auth.user.id, name: auth.user.name } : null
    })
    if (error) throw error
    await loadCodes()
    showGen.value = false
    copyText(genCode.value)
  } catch (e) {
    msg.value = e?.message || '生成失败,请重试'
  } finally {
    genBusy.value = false
  }
}

async function revokeCode(id) {
  if (!confirm('撤销后该邀请码将无法使用(已使用的不受影响),继续?')) return
  const { error } = await supabase.from('invite_codes').update({ revoked: true }).eq('id', id)
  if (!error) loadCodes()
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {})
  } else {
    window.prompt('复制邀请码', text)
  }
}

/* ---------- 计划人员管理 ---------- */
const managePlan = ref(null) // 展开人员管理的计划
const addName = ref('')
const addAs = ref('participant') // participant | viewer

const planById = (id) => plansStore.plans.find((p) => p.id === id)

const ROLE_TAG = {
  admin: { text: '管理员', cls: 'chip-brand' },
  member: { text: '参与者', cls: 'chip-success' },
  viewer: { text: '围观者', cls: 'chip-plain' }
}

async function addPerson() {
  const name = addName.value.trim()
  if (!name || !managePlan.value) return
  if (addAs.value === 'viewer') await plansStore.inviteViewer(managePlan.value.id, name)
  else await plansStore.inviteParticipant(managePlan.value.id, name)
  addName.value = ''
}

async function removePerson(plan, id, isOwner) {
  if (isOwner) {
    alert('创建者不能直接移出;如需更换,请由创建者本人操作或新建计划')
    return
  }
  if (confirm(`把该成员从「${plan.name}」移出?`)) await plansStore.removePerson(plan.id, id)
}

async function deletePlan(plan) {
  if (confirm(`删除计划「${plan.name}」及其全部数据?此操作不可恢复。`)) {
    await plansStore.removePlan(plan.id)
    if (managePlan.value?.id === plan.id) managePlan.value = null
  }
}
</script>

<template>
  <div class="min-h-dvh">
    <DesktopSidebar />
    <MobileTopNav title="兔兔同行" subtitle="后台管理" :back="true" @back="$router.replace('/')" />

    <main class="min-h-dvh pb-24 lg:pl-[280px] lg:pb-12">
      <div class="wrap pt-2 sm:pt-6">
        <section class="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 class="title-1 flex items-center gap-3">
              <i class="fa-solid fa-shield-halved text-primary" aria-hidden="true"></i>后台管理
            </h1>
            <p class="muted mt-1">管理人员、计划与邀请码</p>
          </div>
          <div v-if="!isSupabase" class="chip chip-amber"><span class="dot"></span>演示模式:邀请码功能需 Supabase</div>
          <BaseButton v-else icon="fa-key" @click="openGen">生成邀请码</BaseButton>
        </section>

        <p v-if="msg" class="mb-4 rounded-[10px] bg-amber/10 px-4 py-2 text-[12.5px] text-amber">{{ msg }}</p>

        <!-- 统计 -->
        <div class="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div class="card card-lift p-4">
            <p class="muted text-[11.5px] font-semibold">计划数</p>
            <p class="mt-1 text-[22px] font-bold text-ink">{{ stats.plans }}</p>
          </div>
          <div class="card card-lift p-4">
            <p class="muted text-[11.5px] font-semibold">参与成员(去重)</p>
            <p class="mt-1 text-[22px] font-bold text-ink">{{ stats.people }}</p>
          </div>
          <div class="card card-lift p-4">
            <p class="muted text-[11.5px] font-semibold">邀请码总数</p>
            <p class="mt-1 text-[22px] font-bold text-ink">{{ stats.codes }}</p>
          </div>
          <div class="card card-lift p-4">
            <p class="muted text-[11.5px] font-semibold">未用邀请码</p>
            <p class="mt-1 text-[22px] font-bold text-ink" :class="stats.unused ? 'text-primary' : ''">{{ stats.unused }}</p>
          </div>
        </div>

        <!-- 邀请码列表 -->
        <section class="card mb-6 p-5 sm:p-6">
          <h2 class="title-2 mb-4 flex items-center gap-2">
            <i class="fa-solid fa-key text-primary" aria-hidden="true"></i>邀请码
            <span class="muted text-[12.5px] font-normal">支持设置使用次数(1-100)· 成员码/围观码需绑定计划</span>
          </h2>
          <div v-if="codes.length" class="space-y-2">
            <div v-for="c in codes" :key="c.id" class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[12px] bg-surface-2/60 px-4 py-3">
              <code class="font-mono text-[13px] font-bold text-ink">{{ c.code }}</code>
              <span class="chip" :class="ROLE_TAG[c.role]?.cls || 'chip-plain'">{{ ROLE_TAG[c.role]?.text }}</span>
              <span v-if="c.plan_id" class="chip chip-plain">{{ planById(c.plan_id)?.name || '计划已删除' }}</span>
              <span v-if="c.label" class="muted text-[12px]">{{ c.label }}</span>
              <span class="chip chip-plain">
                使用 {{ c.use_count || 0 }}/{{ c.max_uses ?? 1 }}
              </span>
              <span class="ml-auto flex items-center gap-2 text-[12px]">
                <span v-if="c.revoked" class="chip chip-rose">已撤销</span>
                <span v-else-if="c.use_count >= c.max_uses" class="chip chip-plain">次数已用完<template v-if="c.used_by"> · {{ c.used_by.name }}</template></span>
                <span v-else class="chip chip-success">
                  <template v-if="c.use_count">已用 {{ c.use_count }} 次<template v-if="c.used_by">(最近 {{ c.used_by.name }})</template> · </template>
                  剩 {{ (c.max_uses ?? 1) - c.use_count }} 次
                </span>
                <button v-if="!c.revoked && (c.use_count || 0) < (c.max_uses ?? 1)" class="chip chip-amber cursor-pointer" @click="revokeCode(c.id)">撤销</button>
                <button class="icon-btn !h-7 !w-7" title="复制" @click="copyText(c.code)">
                  <i class="fa-solid fa-copy text-[12px]" aria-hidden="true"></i>
                </button>
              </span>
            </div>
          </div>
          <p v-else class="muted py-4 text-center text-[13px]">
            {{ isSupabase ? '还没有邀请码,点击右上角「生成邀请码」' : '演示模式无邀请码系统,配置 Supabase 后可用' }}
          </p>
        </section>

        <!-- 计划与人员 -->
        <section class="space-y-3">
          <h2 class="title-2 mb-1 flex items-center gap-2">
            <i class="fa-solid fa-folder-open text-primary" aria-hidden="true"></i>计划与成员
          </h2>
          <p v-if="!plansStore.plans.length" class="muted py-6 text-center text-[13px]">
            暂无计划 —— 普通用户用成员邀请码进入后会创建自己的计划
          </p>
          <article v-for="p in plansStore.plans" :key="p.id" class="card p-5">
            <header class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div class="min-w-0 flex-1">
                <p class="truncate text-[15px] font-semibold text-ink">{{ p.name }}</p>
                <p class="muted mt-0.5 text-[12px]">
                  {{ p.destination || '目的地待定' }} · {{ fmtRange(p.start_date, p.end_date) }} · 创建者
                  <b class="text-ink-soft">{{ p.members?.find((m) => m.id === p.owner_id)?.name || p.owner_id }}</b>
                </p>
              </div>
              <span class="chip chip-brand">参与者 {{ p.members?.length || 0 }}</span>
              <span class="chip chip-plain">围观 {{ p.viewers?.length || 0 }}</span>
              <button class="btn btn-ghost btn-sm" @click="managePlan = managePlan?.id === p.id ? null : p">
                {{ managePlan?.id === p.id ? '收起' : '管理成员' }}
              </button>
              <button class="btn btn-danger-soft btn-sm" @click="deletePlan(p)">
                <i class="fa-solid fa-trash-can" aria-hidden="true"></i>删除
              </button>
            </header>

            <!-- 人员管理 -->
            <div v-if="managePlan?.id === p.id" class="mt-4 border-t border-line/70 pt-4">
              <div class="mb-3 flex flex-wrap gap-2">
                <span
                  v-for="m in p.members"
                  :key="m.id"
                  class="chip chip-plain gap-1.5 !px-2"
                  :title="m.id === p.owner_id ? '创建者' : '参与者'"
                >
                  <Avatar :name="m.name" :size="18" :ring="false" />
                  {{ m.name }}
                  <i v-if="m.id === p.owner_id" class="fa-solid fa-crown text-[9px] text-amber" aria-hidden="true"></i>
                  <i
                    v-else
                    class="fa-solid fa-xmark cursor-pointer opacity-50 hover:opacity-100"
                    @click="removePerson(p, m.id, m.id === p.owner_id)"
                  ></i>
                </span>
                <span
                  v-for="v in p.viewers"
                  :key="v.id"
                  class="chip chip-plain gap-1.5 !px-2 opacity-75"
                  title="围观者(只读)"
                >
                  <Avatar :name="v.name" :size="18" :ring="false" />
                  {{ v.name }}
                  <i class="fa-solid fa-xmark cursor-pointer opacity-50 hover:opacity-100" @click="removePerson(p, v.id, false)"></i>
                </span>
              </div>
              <div class="flex flex-wrap items-end gap-2">
                <input v-model="addName" class="field !w-48 !py-2 text-[13px]" placeholder="输入昵称后添加" @keyup.enter="addPerson" />
                <div class="flex gap-1">
                  <button class="chip !px-3 !py-2.5" :class="addAs === 'participant' ? 'chip-brand' : 'chip-plain'" @click="addAs = 'participant'">参与者</button>
                  <button class="chip !px-3 !py-2.5" :class="addAs === 'viewer' ? 'chip-brand' : 'chip-plain'" @click="addAs = 'viewer'">围观者</button>
                </div>
                <BaseButton size="sm" icon="fa-plus" :disabled="!addName.trim()" @click="addPerson">添加</BaseButton>
              </div>
            </div>
          </article>
        </section>
      </div>
    </main>

    <!-- 生成邀请码弹窗 -->
    <BaseModal v-model="showGen" title="生成邀请码" :max-width="'480px'">
      <div class="space-y-4">
        <div>
          <label class="flabel">邀请类型</label>
          <div class="flex gap-2">
            <button
              v-for="r in [
                { key: 'admin', text: '管理员', desc: '可进后台' },
                { key: 'member', text: '参与者', desc: '可编辑计划' },
                { key: 'viewer', text: '围观者', desc: '只读' }
              ]"
              :key="r.key"
              type="button"
              class="chip flex-1 flex-col !px-3 !py-2.5"
              :class="genRole === r.key ? 'chip-brand' : 'chip-plain'"
              @click="genRole = r.key; onGenRoleChange()"
            >
              {{ r.text }}
              <span class="text-[10px] font-normal opacity-70">{{ r.desc }}</span>
            </button>
          </div>
        </div>
        <div v-if="genRole !== 'admin'">
          <label class="flabel">绑定计划</label>
          <select v-model="genPlanId" class="field">
            <option v-for="p in plansStore.plans" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div>
          <label class="flabel">可用次数(1-100)</label>
          <div class="flex items-center gap-3">
            <input v-model.number="genMaxUses" type="number" min="1" max="100" class="field !w-28" />
            <span class="muted text-[12px]">该码共可被登录使用 {{ usesValue() }} 次,次数用完自动失效</span>
          </div>
        </div>
        <div>
          <label class="flabel">用途备注(可选)</label>
          <input v-model="genLabel" class="field" placeholder="例如:接待杭州来的苏晚" maxlength="40" />
        </div>
        <div>
          <label class="flabel">邀请码(可改)</label>
          <div class="flex gap-2">
            <input v-model="genCode" class="field font-mono tracking-wider" spellcheck="false" />
            <BaseButton variant="soft" size="sm" icon="fa-shuffle" @click="genCode = randCode(genRole)">换一个</BaseButton>
          </div>
        </div>
        <p class="muted text-[12px]"><i class="fa-solid fa-lightbulb mr-1 text-amber" aria-hidden="true"></i>邀请码可被多次使用(次数用尽自动失效);可随时在列表里撤销剩余次数。</p>
      </div>
      <template #footer>
        <BaseButton variant="ghost" @click="showGen = false">取消</BaseButton>
        <BaseButton icon="fa-key" :loading="genBusy" :disabled="!genCode.trim()" @click="createCode">生成并复制</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
