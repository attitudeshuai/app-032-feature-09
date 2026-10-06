<script setup lang="ts">
/**
 * 自检面板：逐条展示 §10 验收断言的实时结果。
 * - 未过的结论单独列成「未过名单」：转通过的自动移走，新冒出来的打「新」；
 * - 点一条未过的，按 check-map 的同一套对应关系落到相关参数所在页面并标出；
 * - 每条未过结论按影响大小列出最可能把它转成通过的参数，
 *   以及改这个参数会牵动哪些别的结论（由同一张对应关系表反推）。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CheckResult, ParamId } from '../core/types'
import { checksTouchedBy } from '../core/check-map'

const props = defineProps<{ checks: CheckResult[]; title?: string; elapsedMs?: number; digest?: string }>()

const route = useRoute()
const router = useRouter()

const failed = computed(() => props.checks.filter((c) => !c.pass))

/** 已在名单里的未过 id：新冒出来的打「新」标记（6s），转通过的自动移出名单 */
const knownFailed = ref<Set<string>>(new Set(props.checks.filter((c) => !c.pass).map((c) => c.id)))
const freshIds = ref<Set<string>>(new Set())
let freshTimer: number | undefined

watch(
  () => failed.value.map((c) => c.id).join(','),
  () => {
    const now = new Set(failed.value.map((c) => c.id))
    const fresh = [...now].filter((id) => !knownFailed.value.has(id))
    knownFailed.value = now
    if (fresh.length) {
      freshIds.value = new Set(fresh)
      if (freshTimer !== undefined) window.clearTimeout(freshTimer)
      freshTimer = window.setTimeout(() => {
        freshIds.value = new Set()
      }, 6000)
    }
  }
)

/** 改 param 会牵动的其它结论（同一套对应关系的反查，去掉结论自身） */
function ripples(param: ParamId, selfId: string): string {
  return checksTouchedBy(param)
    .filter((x) => x.checkId !== selfId)
    .map((x) => x.checkId)
    .join('、')
}

/** 点一条未过的：落到影响最大的那个参数所在页面，并标出全部相关参数 */
function locate(c: CheckResult) {
  const id = route.params.id as string
  if (!id || c.params.length === 0) return
  const page = c.params[0].page === 'print' ? 'print' : 'design'
  router.push({ path: `/${page}/${id}`, query: { focus: c.id, t: String(Date.now()) } })
}

const weightBar = (w: number) => '●'.repeat(w) + '○'.repeat(Math.max(0, 5 - w))
</script>

<template>
  <section class="checks">
    <header>
      <h3>{{ title || '自检 / 验收断言' }}</h3>
      <span v-if="elapsedMs !== undefined" class="pill">
        计算耗时 {{ elapsedMs.toFixed(1) }}ms
      </span>
      <span v-if="digest" class="pill ver" title="参数或结论一变，版本号即变；导出单子与本机存档带同一个号">
        结论版本 {{ digest }}
      </span>
      <span class="pill" :class="{ bad: failed.length > 0 }">
        {{ checks.length - failed.length }} / {{ checks.length }} 通过
      </span>
    </header>

    <div v-if="failed.length" class="failed-list">
      <span class="fl-label">未过 {{ failed.length }} 条（点一条落到相关参数）：</span>
      <button v-for="c in failed" :key="c.id" class="fl-item" @click="locate(c)">
        {{ c.id }}<em v-if="freshIds.has(c.id)">新</em>
      </button>
    </div>
    <p v-else class="all-pass">全部通过 · 参数一改即重核，未过名单随之更新</p>

    <ul>
      <li v-for="c in checks" :key="c.id" :class="{ fail: !c.pass }">
        <span class="tag">{{ c.id }}</span>
        <span class="mark" :class="c.pass ? 'ok' : 'no'">{{ c.pass ? '通过' : '未通过' }}</span>
        <div class="body">
          <div class="title">
            {{ c.title }}
            <em v-if="c.value">｜{{ c.value }}</em>
          </div>
          <div class="detail">{{ c.detail }}</div>

          <template v-if="!c.pass && c.params.length">
            <button class="locate" @click="locate(c)">落到相关参数并标出 →</button>
            <ol class="ranked">
              <li v-for="p in c.params" :key="p.param">
                <span class="w" :title="`影响 ${p.weight}/5`">{{ weightBar(p.weight) }}</span>
                <b>{{ p.label }}</b>
                <span class="pg">{{ p.page === 'print' ? '1:1 放样图页' : '参数与预览页' }}</span>
                <span class="ad">{{ p.advice }}</span>
                <span v-if="ripples(p.param, c.id)" class="ripple">牵动：{{ ripples(p.param, c.id) }}</span>
              </li>
            </ol>
          </template>
          <div v-else-if="!c.pass" class="no-param">
            该结论为公式自检（固定算例），与灯样参数无关；若不通过说明计算内核异常。
          </div>
          <div v-else-if="c.params.length" class="related">相关参数：{{ c.params.map((p) => p.label).join('、') }}</div>
        </div>
      </li>
    </ul>

    <p class="mapping-note">
      对应关系取舍：每条结论列出全部相关参数并按影响排队（● 越多影响越大），改一个参数可能牵动多条结论——让出「一条结论唯一去处」，求不漏项。
      单位与精度：长度 mm 保留一位小数；面积 m² 保留三位小数；面积比值按百分数保留两位小数。
    </p>
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
  margin-bottom: 10px;
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

.pill.ver {
  background: #f6e3ba;
  color: #8f1c19;
  border-color: #e0c78a;
}

.failed-list {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  background: #fdf1ef;
  border: 1px solid #f2c7c1;
  border-radius: 8px;
  padding: 7px 10px;
  margin-bottom: 10px;
}

.fl-label {
  font-size: 12px;
  color: var(--red);
  font-weight: 600;
}

.fl-item {
  font: inherit;
  font-family: var(--mono);
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 999px;
  border: 1px solid var(--red);
  background: #fff;
  color: var(--red);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.fl-item:hover {
  background: var(--red);
  color: #fff;
}

.fl-item em {
  font-style: normal;
  font-size: 10px;
  background: var(--gold);
  color: #fff;
  border-radius: 4px;
  padding: 0 4px;
}

.all-pass {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--jade);
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--line);
}

li.fail {
  background: #fdf1ef;
  border-color: #f2c7c1;
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

.locate {
  font: inherit;
  font-size: 12px;
  margin-top: 6px;
  padding: 3px 12px;
  border-radius: 6px;
  border: 1px solid var(--red);
  background: #fff;
  color: var(--red);
  cursor: pointer;
  font-weight: 600;
}

.locate:hover {
  background: var(--red);
  color: #fff;
}

.ranked {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ranked li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  padding: 5px 8px;
  background: #fff;
  border: 1px dashed var(--line-strong);
  border-radius: 6px;
  font-size: 12px;
}

.ranked .w {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--gold);
  letter-spacing: 1px;
}

.ranked b {
  color: var(--ink);
}

.ranked .pg {
  font-size: 10px;
  padding: 0 6px;
  border-radius: 999px;
  background: #eef2f6;
  color: var(--blue);
  border: 1px solid #d3dee8;
}

.ranked .ad {
  color: var(--ink-soft);
  flex: 1;
  min-width: 200px;
}

.ranked .ripple {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--red);
  white-space: nowrap;
}

.no-param {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ink-soft);
}

.related {
  margin-top: 4px;
  font-size: 11px;
  color: var(--ink-soft);
}

.mapping-note {
  margin: 10px 0 0;
  padding-top: 8px;
  border-top: 1px dashed var(--line);
  font-size: 11px;
  color: var(--ink-soft);
  line-height: 1.6;
}
</style>
