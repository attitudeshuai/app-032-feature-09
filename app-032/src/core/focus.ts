/**
 * 「点一条未过结论 → 落到相关参数并标出」的跨页面共享状态。
 * 页底结论面板与参数/预览页不直接耦合：任一页点结论，先导航到参数页，
 * 参数页据 focusParam 滚动并高亮标出对应字段（叫法取自 guide.PARAM_LABELS）。
 */
import { ref } from 'vue'
import type { ParamKey } from './types'

/** 当前要点过去标出的参数（null = 无定位） */
export const focusParam = ref<ParamKey | null>(null)
/** 每次定位递增，保证连续点同一条结论也能重新闪烁一次 */
export const focusSeq = ref(0)

export function requestFocusParam(p: ParamKey) {
  focusParam.value = p
  focusSeq.value += 1
}

export function clearFocusParam() {
  focusParam.value = null
}
