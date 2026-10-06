<script setup lang="ts">
/**
 * 已导出单子的「老结论」点名条：
 * 导出时登记了结论版本号；当前版本号一变，基于旧版本导出的单子即作废，
 * 在这里逐份点明（哪一份、什么时候导的、旧版本号），提示重出。
 */
import { computed } from 'vue'
import { EXPORT_KIND_LABELS, state } from '../core/store'

const props = defineProps<{ lanternId: string; digest: string }>()

const stale = computed(() => state.exports.filter((e) => e.lanternId === props.lanternId && e.digest !== props.digest))

function fmt(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <section v-if="stale.length" class="stale-banner no-print">
    <b>以下 {{ stale.length }} 份已导出的单子指的仍是老结论 / 老参数（当前结论版本 {{ digest }}），已作废，请重新导出：</b>
    <ul>
      <li v-for="e in stale" :key="e.kind + e.at">
        《{{ EXPORT_KIND_LABELS[e.kind] || e.kind }}》{{ e.file }} · 导出于 {{ fmt(e.at) }} · 旧版本 {{ e.digest }}
        —— 按该单裁好、配好的料需按新单重出
      </li>
    </ul>
  </section>
</template>

<style scoped>
.stale-banner {
  background: #fdf3e2;
  border: 1px solid #e8cfa4;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 12.5px;
  color: #8a4b12;
  line-height: 1.6;
}

.stale-banner b {
  display: block;
  margin-bottom: 4px;
}

.stale-banner ul {
  margin: 0;
  padding-left: 18px;
}
</style>
