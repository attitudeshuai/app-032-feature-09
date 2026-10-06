/**
 * 结论 ↔ 参数 对应关系（全项目唯一来源，「同一套说法」只维护在这里）。
 *
 * 取舍（两条路选一条，认下代价）：
 * 选「每条结论列出全部相关参数、按影响大小排队」——一个不漏；
 * 代价是让出「去处的唯一」：一条结论同时指向几个参数，改其中一个又会牵动别的结论，
 * 来回试的次数变多。未选「每条结论只认一个主参数」：去处唯一、好点好记，
 * 但有的结论起作用的那个参数不在主参数上，照着改未必能过。
 *
 * 反向关系（改一个参数会牵动哪些结论）由同一张表反推，不另维护，保证处处一致。
 * 页面高亮、各页自检、三份导出单子、本机存档快照都从这里取参数名与排队。
 */
import type { CheckParamRef, CheckResult, Lantern, ParamId } from './types'

export interface ParamMeta {
  /** 参数中文名（全项目同一说法） */
  label: string
  /** 参数所在页面：点结论后落到的页面 */
  page: 'design' | 'print'
  unit?: string
}

export const PARAM_META: Record<ParamId, ParamMeta> = {
  maxDiameterMm: { label: '最大直径', page: 'design', unit: 'mm' },
  totalHeightMm: { label: '总高', page: 'design', unit: 'mm' },
  mouthDiameterMm: { label: '收口直径', page: 'design', unit: 'mm' },
  baseDiameterMm: { label: '底口直径', page: 'design', unit: 'mm' },
  sides: { label: '棱数 / 母线根数', page: 'design' },
  layers: { label: '层数 / 分段高', page: 'design', unit: 'mm' },
  mouthStyle: { label: '上收口方式', page: 'design' },
  bottomStyle: { label: '下收口方式', page: 'design' },
  smoothness: { label: '收口曲线强度', page: 'design' },
  ctrlCurve: { label: '葫芦口控制点', page: 'design' },
  divisions: { label: '母线等分数', page: 'design' },
  covering: { label: '蒙面类型', page: 'design' },
  seamAllowanceMm: { label: '缝份（每边）', page: 'design', unit: 'mm' },
  lashAllowanceMm: { label: '绑扎余量（每端）', page: 'design', unit: 'mm' },
  batchCount: { label: '批量数量', page: 'design' },
  wasteRatio: { label: '损耗率', page: 'design' },
  pageSize: { label: '纸张大小', page: 'print' },
  overlapMm: { label: '长条搭接量', page: 'print', unit: 'mm' }
}

interface LinkSpec {
  param: ParamId
  /** 影响权重：1（小）~ 5（大），排队依据 */
  weight: number
  /** 怎么动最可能把这条结论转成通过 */
  advice: string
}

const CHECK_PARAM_MAP: Record<string, LinkSpec[]> = {
  // CHK-01 为公式自检（固定算例 D200），与灯样参数无关
  'CHK-01': [],
  'CHK-02': [
    { param: 'layers', weight: 5, advice: '竖篾净长 = 各层分段母线长累计，先核对各层分段高' },
    { param: 'totalHeightMm', weight: 4, advice: '改总高会重排各层分段高，竖篾净长随之变' },
    { param: 'smoothness', weight: 3, advice: '曲线强度改变收口段横向偏移，折线长随之变' },
    { param: 'mouthStyle', weight: 2, advice: '平口/收口/葫芦口决定上段是否产生横向偏移' },
    { param: 'bottomStyle', weight: 2, advice: '下收口方式同理，影响下段折线长' },
    { param: 'ctrlCurve', weight: 2, advice: '葫芦口控制点改变收口段曲线，折线长随之变' },
    { param: 'maxDiameterMm', weight: 1, advice: '与口部直径之差决定收口段横向偏移量' },
    { param: 'mouthDiameterMm', weight: 1, advice: '与最大直径之差决定上段横向偏移' },
    { param: 'baseDiameterMm', weight: 1, advice: '与最大直径之差决定下段横向偏移' }
  ],
  'CHK-03': [
    { param: 'seamAllowanceMm', weight: 5, advice: '裁片尺寸 = 净尺寸 + 缝份×2，只随缝份取值变化' }
  ],
  'CHK-04': [
    { param: 'lashAllowanceMm', weight: 5, advice: '差值必须等于 余量处数 × 每端余量，先核对每端绑扎余量' },
    { param: 'sides', weight: 2, advice: '棱数决定多边形横篾圈的接头处数（圆形为 1 处）' },
    { param: 'layers', weight: 2, advice: '层数决定横篾圈数量，余量处数随之变' },
    { param: 'maxDiameterMm', weight: 1, advice: '直径改变各圈净长，备料与净长同步变' }
  ],
  'CHK-05': [
    { param: 'divisions', weight: 5, advice: '旋转体近似展开的误差来源；按整数往上加等分数，首个落进容差的即为建议值' },
    { param: 'maxDiameterMm', weight: 2, advice: '直径放大误差绝对值，先确认直径无误' },
    { param: 'mouthDiameterMm', weight: 1, advice: '收口直径改变上段面片与顶盖面积' },
    { param: 'baseDiameterMm', weight: 1, advice: '底口直径改变下段面片与底盖面积' },
    { param: 'layers', weight: 1, advice: '分段高改变各层面片面积分配' },
    { param: 'smoothness', weight: 1, advice: '曲线强度改变收口段面片形状' }
  ],
  'CHK-06': [
    { param: 'pageSize', weight: 5, advice: '裁片超宽/超高时先把纸张从 A4 换成 A3' },
    { param: 'overlapMm', weight: 3, advice: '搭接量影响长条分段与跨页拼接' },
    { param: 'maxDiameterMm', weight: 2, advice: '直径决定裁片宽度，超纸宽会挤页' },
    { param: 'seamAllowanceMm', weight: 2, advice: '缝份加在裁片四边，直接影响裁片外廓' },
    { param: 'divisions', weight: 1, advice: '等分数决定旋转体每块展开片宽度' },
    { param: 'totalHeightMm', weight: 1, advice: '总高决定裁片高度与长条长度' }
  ],
  'CHK-07': [
    { param: 'batchCount', weight: 5, advice: '批量总量 = 单灯 × 数量 × (1 + 损耗率)，先核对数量' },
    { param: 'wasteRatio', weight: 5, advice: '损耗率直接乘进批量总量' }
  ],
  'CHK-08': [
    { param: 'divisions', weight: 4, advice: '等分数越大展开片越多，计算与分页越慢' },
    { param: 'layers', weight: 3, advice: '层数越多构件与裁片越多' },
    { param: 'sides', weight: 2, advice: '棱数/母线根数决定每圈构件数量' },
    { param: 'pageSize', weight: 1, advice: '纸张越小分页越多' }
  ]
}

/** 结论 → 相关参数（按影响从大到小排队） */
export function paramLinksFor(checkId: string): CheckParamRef[] {
  return (CHECK_PARAM_MAP[checkId] || [])
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((s) => ({
      param: s.param,
      label: PARAM_META[s.param].label,
      weight: s.weight,
      advice: s.advice,
      page: PARAM_META[s.param].page
    }))
}

/** 反查：改一个参数会牵动哪些结论（由同一张表推出，保证同一套说法） */
export function checksTouchedBy(param: ParamId): { checkId: string; weight: number }[] {
  const out: { checkId: string; weight: number }[] = []
  for (const [checkId, links] of Object.entries(CHECK_PARAM_MAP)) {
    const hit = links.find((x) => x.param === param)
    if (hit) out.push({ checkId, weight: hit.weight })
  }
  return out.sort((a, b) => b.weight - a.weight)
}

/**
 * 结论版本号：由灯样参数 + 各自检结论的通过状态与取值算出。
 * 参数或结论一变即变；导出单子、本机存档都带上它，
 * 哪一处指的还是老结论，比对版本号即可点明。
 */
export function checksDigest(l: Lantern, checks: CheckResult[]): string {
  const payload = JSON.stringify({
    p: [
      l.kind,
      l.maxDiameterMm,
      l.totalHeightMm,
      l.mouthDiameterMm,
      l.baseDiameterMm,
      l.sides,
      l.layers.map((x) => x.heightMm).join('/'),
      l.mouthStyle,
      l.bottomStyle,
      l.smoothness,
      l.ctrl1?.x,
      l.ctrl1?.y,
      l.ctrl2?.x,
      l.ctrl2?.y,
      l.divisions,
      l.covering,
      l.seamAllowanceMm,
      l.lashAllowanceMm,
      l.batchCount,
      l.wasteRatio,
      l.pageSize,
      l.overlapMm
    ],
    c: checks.map((c) => `${c.id}:${c.pass ? 1 : 0}:${c.value ?? ''}`)
  })
  let h = 5381
  for (let i = 0; i < payload.length; i++) h = ((h << 5) + h + payload.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}
