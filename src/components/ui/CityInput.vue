<script setup>
// ============================================================
// 城市选择:省份 → 城市 级联下拉
// v-model 存「城市名」字符串;allowCustom=true 时可输入海外/其他自由文本
// 城市组件结构:ProvinceSelect + CitySelect + (自定义输入)
// ============================================================
import { ref, computed, watch } from 'vue'
import { listProvinces, listCities, provinceOfCity } from '@/utils/chinaRegion'

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '选择城市' },
  allowCustom: { type: Boolean, default: true },
  compact: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue'])

const provs = listProvinces()
const provCode = ref('')
const custom = ref(false)
const customText = ref('')

// 值回显:modelValue 归属某省,自动选中对应省(市列表联动)
watch(
  () => props.modelValue,
  (v) => {
    if (!v) {
      custom.value = false
      return
    }
    const hit = provinceOfCity(v)
    if (hit && hit.code !== provCode.value) provCode.value = hit.code
  },
  { immediate: true }
)

const cities = computed(() => listCities(provCode.value))

function onProvinceChange() {
  custom.value = false // 切省后回到下拉选择
  const first = cities.value[0]?.name
  emit('update:modelValue', first || '')
}

function onCityChange(e) {
  const v = e.target.value
  if (v === '__custom') {
    custom.value = true
    emit('update:modelValue', customText.value)
  } else {
    custom.value = false
    emit('update:modelValue', v)
  }
}

function useCustom() {
  custom.value = true
  emit('update:modelValue', customText.value)
}

// 允许手动清除(选择 “— 不选 —”)
function onClear() {
  custom.value = false
  provCode.value = ''
  emit('update:modelValue', '')
}
</script>

<template>
  <div class="flex items-center gap-2">
    <!-- 省 -->
    <select v-model="provCode" class="field" :class="compact ? '!w-[7.5rem] !px-2.5 !py-1.5 !text-[13px]' : 'w-1/2'" @change="onProvinceChange">
      <option value="" disabled>{{ placeholder.startsWith('选择') ? '选择省份' : placeholder }}</option>
      <option v-for="p in provs" :key="p.code" :value="p.code">{{ p.name }}</option>
    </select>

    <!-- 市 -->
    <select
      v-if="provCode && !custom"
      class="field"
      :class="compact ? '!w-[8.5rem] !px-2.5 !py-1.5 !text-[13px]' : 'w-1/2'"
      :value="modelValue"
      :disabled="!cities.length"
      @change="onCityChange"
    >
      <option v-for="c in cities" :key="c.code" :value="c.name">{{ c.name }}</option>
      <option v-if="allowCustom" value="__custom">… 其他 / 海外</option>
    </select>

    <!-- 自定义文本 -->
    <input
      v-else-if="custom"
      v-model="customText"
      class="field"
      :class="compact ? '!w-[9rem] !px-2.5 !py-1.5 !text-[13px]' : 'w-1/2'"
      :placeholder="'手动输入(如海外城市)'"
      @input="emit('update:modelValue', customText)"
    />

    <!-- 无可选项时的兜底 -->
    <input
      v-else-if="!provCode"
      v-model="customText"
      class="field"
      :class="compact ? '!w-[8.5rem] !px-2.5 !py-1.5 !text-[13px]' : 'w-1/2'"
      :placeholder="placeholder"
      @input="emit('update:modelValue', customText); custom = true"
    />

    <button
      v-if="modelValue"
      type="button"
      class="icon-btn !h-7 !w-7 shrink-0"
      title="清除"
      @click="onClear"
    >
      <i class="fa-solid fa-xmark text-[11px]" aria-hidden="true"></i>
    </button>
    <button
      v-if="allowCustom && !custom"
      type="button"
      class="btn btn-ghost btn-sm !px-2.5"
      title="手动输入其他城市"
      @click="useCustom"
    >
      <i class="fa-solid fa-pen" aria-hidden="true"></i>
    </button>
  </div>
</template>
