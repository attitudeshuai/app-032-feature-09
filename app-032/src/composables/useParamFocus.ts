/**
 * 「点一条没过的结论 → 落到相关参数并标出」的页面侧机制。
 * 自检面板把结论 id 写进路由 query（?focus=CHK-xx），本组合式函数读出后：
 * 按 check-map 的同一套对应关系找到相关参数，给带 data-param 的元素加 .param-focus 描边，
 * 并滚动到第一个相关参数。参数一改（或 15s 后）描边撤下。
 */
import { nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { paramLinksFor } from '../core/check-map'
import type { ParamId } from '../core/types'

export function useParamFocus() {
  const route = useRoute()
  const focusCheck = ref('')
  const focusParams = ref<ParamId[]>([])
  let timer: number | undefined

  function clearDom() {
    document.querySelectorAll('.param-focus').forEach((el) => el.classList.remove('param-focus'))
  }

  function clear() {
    focusCheck.value = ''
    focusParams.value = []
    clearDom()
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
  }

  function applyDom() {
    clearDom()
    for (const p of focusParams.value) {
      document.querySelectorAll(`[data-param="${p}"]`).forEach((el) => el.classList.add('param-focus'))
    }
  }

  watch(
    () => [route.query.focus, route.query.t] as const,
    async ([v]) => {
      const id = String(v || '')
      if (!id) return
      focusCheck.value = id
      focusParams.value = paramLinksFor(id).map((x) => x.param)
      await nextTick()
      applyDom()
      const first = focusParams.value
        .map((p) => document.querySelector(`[data-param="${p}"]`))
        .find((el): el is Element => !!el)
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => clear(), 15000)
    },
    { immediate: true }
  )

  onUnmounted(() => {
    clearDom()
    if (timer !== undefined) window.clearTimeout(timer)
  })

  return { focusCheck, focusParams, clearFocus: clear }
}
