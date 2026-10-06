<script setup lang="ts">
/**
 * 存档/单子一致性横幅：
 * - 旧档补入的缺项（含补的默认值）逐条列出；
 * - 参数指纹一变，点明本机存档里留的那份结论哪些条已老；
 * - 已导出/打印的单子与图纸按记录逐条点名，提示作废重出（已裁好的料须重来由用户自行处理）。
 */
import { computed } from 'vue'
import type { Lantern, CheckResult } from '../core/types'
import { GUIDE_VERSION, fmtTime, staleState } from '../core/guide'

const props = defineProps<{ lantern: Lantern; checks: CheckResult[] }>()

const statex = computed(() => staleState(props.lantern, props.checks))
const migration = computed(() => props.lantern.migrationNotes || [])
const hasAnything = computed(
  () => migration.value.length > 0 || statex.value.snapshotStale || statex.value.staleExports.length > 0
)
</script>

<template>
  <section v-if="hasAnything" class="archive">
    <h3>本机存档与已发单子核对（对应表 {{ GUIDE_VERSION }}）</h3>

    <div v-if="migration.length" class="block migrate">
      <div class="b-title">旧存档已按写明的默认值补齐缺项后再参与核对，补入项如下：</div>
      <ul>
        <li v-for="(m, i) in migration" :key="i">{{ m }}</li>
      </ul>
    </div>

    <div v-if="statex.snapshotStale" class="block stale">
      <div class="b-title">
        ⚠ 本机存档里留的那一份结论<span v-if="lantern.checksSnapshot">（{{ fmtTime(lantern.checksSnapshot.at) }}、版本 {{ lantern.checksSnapshot.guideVersion }}）</span>
        是老结论：参数已变，存档会在下次自动保存时按现参数重算覆盖；在此之前以本页实时结论为准。
      </div>
      <ul v-if="statex.snapshotDiff.length">
        <li v-for="d in statex.snapshotDiff" :key="d.id">
          <b>{{ d.id }}</b> 存档时「{{ d.oldPass ? '通过' : '未通过' }} {{ d.oldValue }}」
          → 现在「{{ d.nowPass ? '通过' : '未通过' }} {{ d.nowValue }}」
        </li>
      </ul>
      <div v-else-if="lantern.checksSnapshot" class="b-title">通过项数与取值口径与存档时一致，但参数指纹已不同（参数变了而结论恰好未翻转），仍按新参数重出单子。</div>
    </div>

    <div v-for="(e, i) in statex.staleExports" :key="i" class="block stale">
      <div class="b-title">
        ⚠ 已发出的「{{ e.name }}」（{{ fmtTime(e.at) }}，版本 {{ e.guideVersion }}）按的是老参数
        <template v-if="e.oldGuide">与老对应表</template>
        ，单子与图纸<b>作废，需重出</b>；已经照旧参数裁好、配好的料要重来。
      </div>
      <ul v-if="e.changed.length">
        <li v-for="d in e.changed" :key="d.id">
          <b>{{ d.id }}</b> 单子上「{{ d.oldPass ? '通过' : '未通过' }} {{ d.oldValue }}」
          → 现在「{{ d.nowPass ? '通过' : '未通过' }} {{ d.nowValue }}」
        </li>
      </ul>
    </div>

    <div v-if="!statex.snapshotStale && statex.staleExports.length === 0 && !migration.length" class="block ok">
      本机存档结论与当前参数一致（对应表 {{ GUIDE_VERSION }}）。
    </div>
  </section>
</template>

<style scoped>
.archive {
  background: #fffaf0;
  border: 1px solid #e4cfa2;
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

h3 {
  margin: 0;
  font-size: 13.5px;
  color: #8a5a12;
}

.block {
  border-radius: 8px;
  padding: 8px 11px;
  font-size: 12px;
  line-height: 1.6;
}

.block ul {
  margin: 5px 0 0;
  padding-left: 18px;
}

.migrate {
  background: #fdf3e0;
  border: 1px solid #e8d3a8;
  color: #7a5410;
}

.stale {
  background: #fdecea;
  border: 1px solid #f0c4bd;
  color: #7d231d;
}

.b-title {
  font-weight: 600;
}

.stale b {
  font-family: var(--mono);
}
</style>
