<script setup lang="ts">
/**
 * 自检面板：逐条展示 §10 验收断言的实时结果（对应表 G2，唯一说法取自 core/guide）。
 * - 未通过的结论排到最前；点一条未过结论即可跳到相关参数并标出；
 * - 建议按影响（高/中/低）排队，一个不漏；每条写明「会牵动」哪些别的结论；
 * - 参数一改全量重核：转通过的从未过名单移走，新冒出来的加进来。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CheckResult, ParamHint } from '../core/types'
import { applyParam } from '../core/guide'
import { requestFocusParam } from '../core/focus'
import { getLantern } from '../core/store'

const props = defineProps<{
  checks: CheckResult[]
  title?: string
  elapsedMs?: number
  /** 本页面口径：只显示名册里归属本页的结论（同一条结论在各页仍是同一说法） */
  scope?: 'design' | 'frame' | 'panels' | 'print' | 'materials'
  /** 是否允许在本面板里直接改参数（默认允许） */
  mutable?: boolean
}>()

const route = useRoute()
const router = useRouter()

const ordered = computed(() => {
  const list = [...props.checks]
  list.sort((a, b) => Number(a.pass) - Number(b.pass) || a.id.localeCompare(b.id))
  return list
})

const failCount = computed(() => props.checks.filter((c) => !c.pass).length)

function gotoParam(h: ParamHint) {
  const id = route.params.id as string | undefined
  if (!id) return
  const printParams: ParamHint['param'][] = ['pageSize', 'overlapMm']
  const target = printParams.includes(h.param) ? `/print/${id}` : `/design/${id}`
  if (route.path !== target) {
    router.push(target).then(() => requestFocusParam(h.param))
  } else {
    requestFocusParam(h.param)
  }
}

function applyValue(h: ParamHint) {
  const id = route.params.id as string | undefined
  if (!id || h.suggestValue === undefined) return
  // 直接改的是 reactive store 里的灯样；computeAll 会随之重核刷新
  const l = getLantern(id)
  if (l) {
    applyParam(l, h.param, h.suggestValue)
    requestFocusParam(h.param)
  }
}

const impactText = { high: '高影响', medium: '中影响', low: '低影响' }
</script>

<template>
  <section class="checks">
    <header>
      <h3>{{ title || '自检 / 验收断言' }}</h3>
      <span v-if="elapsedMs !== undefined" class="pill">
        计算耗时 {{ elapsedMs.toFixed(1) }}ms
      </span>
      <span class="pill" :class="{ bad: failCount > 0 }">
        {{ checks.length - failCount }} / {{ checks.length }} 通过<template v-if="failCount > 0"> · {{ failCount }} 条未过</template>
      </span>
    </header>

    <p class="guide-note">
      对应表 <b>G2</b>（已认下代价）：每条未过结论列出<b>全部相关参数并按影响排队、一个不漏</b>；
      代价是一条结论同时牵几个参数，动一个会牵动下面点名的别的结论，来回试的次数会变多——
      每条建议都写明「会牵动」哪些结论。点参数名即跳到该参数并标出，改完全部八条自动重核。
    </p>

    <ul>
      <li v-for="c in ordered" :key="c.id" class="row" :class="{ fail: !c.pass }">
        <div class="line">
          <span class="tag">{{ c.id }}</span>
          <span class="mark" :class="c.pass ? 'ok' : 'no'">{{ c.pass ? '通过' : '未通过' }}</span>
          <div class="body">
            <div class="title">
              {{ c.title }}
              <em v-if="c.value">｜{{ c.value }}</em>
            </div>
            <div class="detail">{{ c.detail }}</div>
            <div class="measure">单位与精度：{{ c.measure }}</div>
          </div>
        </div>

        <!-- 未过：相关参数按影响排队 -->
        <div v-if="!c.pass && c.paramHints.length" class="hints">
          <div class="hints-head">按影响大小排队的相关参数（点名称跳过去标出）：</div>
          <ol>
            <li v-for="h in c.paramHints" :key="h.param" class="hint" :class="h.impact">
              <div class="hint-main">
                <button type="button" class="param-chip" :title="`在参数页标出：${h.label}`" @click="gotoParam(h)">
                  <span class="chip-impact">{{ impactText[h.impact] }}</span>
                  {{ h.label }}
                </button>
                <button
                  v-if="mutable !== false && h.suggestValue !== undefined"
                  type="button"
                  class="apply"
                  @click="applyValue(h)"
                >
                  用 {{ h.suggestValue }}<template v-if="h.param === 'divisions'"> 等分</template>
                </button>
              </div>
              <p class="advice">{{ h.advice }}</p>
              <p class="affects">
                动这一处会牵动：
                <template v-if="h.affects.length">
                  <span v-for="(a, i) in h.affects" :key="a" class="aff-tag">{{ a }}<span v-if="i < h.affects.length - 1">、</span></span>
                </template>
                <em v-else>不牵动其它结论（仅重算本条）</em>
              </p>
            </li>
          </ol>
        </div>
        <div v-else-if="!c.pass" class="hints">
          <p class="advice">该结论为公式/等式恒等项，当前未通过属异常；请检查对应输入是否为合法数值。</p>
        </div>
        <details v-else class="passed-hints">
          <summary>已通过 · 相关参数 {{ c.paramHints.length }} 个（点开可跳去标出；改动越界会自动加回未过名单）</summary>
          <div class="passed-chips">
            <button
              v-for="h in c.paramHints"
              :key="h.param"
              type="button"
              class="param-chip pass-chip"
              :title="`${h.advice}｜牵动：${h.affects.join('、') || '无'}`"
              @click="gotoParam(h)"
            >
              {{ h.label }}
            </button>
          </div>
        </details>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.checks {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 14px 16px;
  box-shadow: var(--shadow);
}

header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

h3 {
  margin: 0;
  font-size: 15px;
  color: var(--ink);
}

.pill {
  font-size: 11px;
  padding: 2px 9px;
  border-radius: 999px;
  background: #eaf4ef;
  color: var(--jade);
  border: 1px solid #cbe3d8;
  font-family: var(--mono);
}

.pill.bad {
  background: #fdecea;
  color: var(--red);
  border-color: #f2c7c1;
}

.guide-note {
  margin: 0 0 10px;
  font-size: 11.5px;
  line-height: 1.6;
  color: #6a5c52;
  background: var(--surface-2);
  border: 1px dashed var(--line-strong);
  border-radius: 8px;
  padding: 7px 10px;
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--line);
}

.row.fail {
  background: #fdf1ef;
  border-color: #f2c7c1;
}

.line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.tag {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-soft);
  padding-top: 2px;
  white-space: nowrap;
}

.mark {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 5px;
  white-space: nowrap;
  font-weight: 600;
}

.mark.ok {
  background: #e3f1ea;
  color: var(--jade);
}

.mark.no {
  background: #fadbd6;
  color: var(--red);
}

.body {
  flex: 1;
  min-width: 0;
}

.title {
  font-size: 13px;
  font-weight: 600;
}

.title em {
  font-style: normal;
  font-family: var(--mono);
  font-weight: 400;
  color: var(--blue);
  font-size: 12px;
}

.detail {
  font-size: 12px;
  color: var(--ink-soft);
  word-break: break-word;
}

.measure {
  font-size: 11px;
  color: #8a7c6d;
  margin-top: 2px;
}

.hints {
  margin: 8px 0 2px 22px;
  border-left: 3px solid #e2b5ad;
  padding-left: 10px;
}

.hints-head {
  font-size: 11.5px;
  color: var(--red);
  margin-bottom: 5px;
}

ol {
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  list-style: none;
}

.hint {
  background: #fffaf6;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 6px 9px;
}

.hint.high {
  border-left: 3px solid var(--red);
}

.hint.medium {
  border-left: 3px solid var(--gold);
}

.hint.low {
  border-left: 3px solid #b8ac9c;
}

.hint-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.param-chip {
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--line-strong);
  background: #fff;
  color: var(--ink);
  border-radius: 6px;
  padding: 3px 9px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.param-chip:hover {
  border-color: var(--red);
  color: var(--red);
}

.chip-impact {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: #f3e8dd;
  color: #7c6a58;
}

.hint.high .chip-impact {
  background: #fbe0db;
  color: var(--red);
}

.hint.medium .chip-impact {
  background: #f6e8c8;
  color: #8a6414;
}

.apply {
  font: inherit;
  font-size: 11px;
  border: 1px solid var(--jade);
  color: var(--jade);
  background: #f0f7f4;
  border-radius: 6px;
  padding: 2px 8px;
  cursor: pointer;
}

.apply:hover {
  background: var(--jade);
  color: #fff;
}

.advice {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: var(--ink-soft);
  line-height: 1.55;
}

.affects {
  margin: 3px 0 0;
  font-size: 11px;
  color: #8a7c6d;
}

.aff-tag {
  font-family: var(--mono);
  color: var(--blue);
}

.affects em {
  font-style: normal;
  color: #9a8d7e;
}

.passed-note {
  margin: 6px 0 0 22px;
  font-size: 11px;
  color: #8aa89c;
}

.passed-hints {
  margin: 6px 0 0 22px;
  font-size: 11.5px;
  color: #6f8f83;
}

.passed-hints summary {
  cursor: pointer;
}

.passed-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}

.pass-chip {
  font-weight: 400;
  color: #5c7d70;
  border-color: #c5d8cf;
  background: #f4f9f6;
}
</style>
