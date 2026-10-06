/**
 * 结论 ↔ 参数对应表（全应用唯一出处）
 * ------------------------------------------------------------------
 * 取舍记录（两条路只能挑一条，已挑定并认下代价）：
 *   G1 = 每条结论只认一个主参数：去处唯一、好点好记；
 *        代价是有的结论真正起作用的参数不在主参数上，照着改未必能过。
 *   G2 = 全部相关参数都列出、按影响大小排队，一个不漏（本版采用）；
 *        代价是一条结论同时指向几个参数，动其中一个又会牵动别的结论，
 *        来回试的次数变多——界面上每条建议都列出「牵动结论」，把这个代价摆明。
 * 凡 G2 对应关系落到处：参数与灯体预览页标出的参数、骨架页/裁片页的结论、
 * 备料与批量用量、三份导出单子、本机存档，必须用同一张表、同一个说法。
 * 旧版（无版本戳或 G1）一旦存过档、出过单子：存档结论与单子/图纸整份作废重出。
 */
import type { Lantern, ParamKey, CheckSnapshot, CheckResult } from './types'

export type { ParamKey }
import { CRAFT, coveringSpec } from './craft'
import { buildFrame } from './frame'
import { buildPanels } from './panels'
import { bodySurfaceArea } from './geometry'
import { PAPER_DIMS, assertNoPanelSplit } from './paginate'
import { distributeLayers, syncLayerDiameters } from './layers'
import type { FrameResult } from './frame'
import type { PanelResult } from './panels'
import type { BatchMaterials, SingleLightMaterials } from './materials'
import type { Sheet } from './paginate'

export const GUIDE_VERSION = 'G2'

export type CheckId = 'CHK-01' | 'CHK-02' | 'CHK-03' | 'CHK-04' | 'CHK-05' | 'CHK-06' | 'CHK-07' | 'CHK-08'

export const CHECK_IDS: CheckId[] = ['CHK-01', 'CHK-02', 'CHK-03', 'CHK-04', 'CHK-05', 'CHK-06', 'CHK-07', 'CHK-08']

/** 参数的统一叫法（预览页标注、结论建议、导出单子、存档留痕全用这一份） */
export const PARAM_LABELS: Record<ParamKey, string> = {
  maxDiameterMm: '最大直径',
  totalHeightMm: '总高',
  mouthDiameterMm: '收口直径',
  baseDiameterMm: '底口直径',
  sides: '棱数 / 母线根数',
  divisions: '母线等分数',
  layers: '分段（层数与各层高度）',
  mouthStyle: '上收口方式',
  bottomStyle: '下收口方式',
  smoothness: '收口曲线强度',
  ctrl1: '葫芦控制点 1',
  ctrl2: '葫芦控制点 2',
  seamAllowanceMm: '缝份',
  lashAllowanceMm: '绑扎余量',
  covering: '蒙面类型',
  batchCount: '批量数量',
  wasteRatio: '损耗率',
  pageSize: '打印纸张',
  overlapMm: '长条搭接量'
}

/** 参数取值的统一书写口径（导出单子 / 存档留痕用） */
export function paramValueText(l: Lantern, p: ParamKey): string {
  switch (p) {
    case 'maxDiameterMm':
    case 'totalHeightMm':
    case 'mouthDiameterMm':
    case 'baseDiameterMm':
      return `${l[p]}mm`
    case 'sides':
      return `${l.sides}`
    case 'divisions':
      return `${l.divisions} 等分`
    case 'layers':
      return `${l.layers.length} 层 / 各层高 ${l.layers.map((x) => x.heightMm).join('、')}mm`
    case 'mouthStyle':
    case 'bottomStyle':
      return l[p]
    case 'smoothness':
      return l.smoothness.toFixed(2)
    case 'ctrl1':
    case 'ctrl2':
      return `(${l[p].x.toFixed(2)}, ${l[p].y.toFixed(2)})`
    case 'seamAllowanceMm':
    case 'lashAllowanceMm':
      return `每处 ${l[p]}mm`
    case 'covering':
      return coveringSpec(l.covering).name
    case 'batchCount':
      return `${l.batchCount} 个`
    case 'wasteRatio':
      return `${(l.wasteRatio * 100).toFixed(0)}%`
    case 'pageSize':
      return l.pageSize
    case 'overlapMm':
      return `${l.overlapMm}mm`
  }
}

export interface CheckMeta {
  id: CheckId
  title: string
  /** 单位与精度口径（人类可读，导出单子原样带出） */
  measure: string
  /** 在哪些页面的页底出现（design/materials 不设过滤，显示全部） */
  scopes: ('frame' | 'panels' | 'print')[]
}

/** 八条结论的固定名册：编号、标题、单位精度口径、归属页面 */
export const CHECK_REGISTRY: Record<CheckId, CheckMeta> = {
  'CHK-01': {
    id: 'CHK-01',
    title: '几何手算核对（棱长 / 周长，误差 ≤ 1mm）',
    measure: '长度 mm（3 位小数）；手算容差 ±1mm',
    scopes: ['frame']
  },
  'CHK-02': {
    id: 'CHK-02',
    title: '竖篾净长 = 分段母线折线长累计',
    measure: '长度 mm（1 位小数）；等式容差 0.1mm',
    scopes: ['frame']
  },
  'CHK-03': {
    id: 'CHK-03',
    title: '裁片尺寸 = 展开净尺寸 + 缝份 × 2（每边）',
    measure: '长度 mm（1 位小数）；三向等式容差 0.06mm',
    scopes: ['panels']
  },
  'CHK-04': {
    id: 'CHK-04',
    title: '备料守恒：Σ备料长度 ≥ Σ净长，且差值 = 余量总和',
    measure: '长度 mm（1 位小数）；差值等式容差 0.5mm',
    scopes: ['frame']
  },
  'CHK-05': {
    id: 'CHK-05',
    title: '面积核对：Σ裁片净面积 / 灯体表面积 ∈ [97.00%, 103.00%]',
    measure: '面积折 m²（3 位小数）；比值按百分数（2 位小数）；合格区间 [97.00%, 103.00%]',
    scopes: ['panels', 'print']
  },
  'CHK-06': {
    id: 'CHK-06',
    title: '分页：任一裁片不跨页（长条跨页带对位十字与搭接量）',
    measure: '裁片计数（块）；超区裁片必须整块输出、不得拆分',
    scopes: ['panels', 'print']
  },
  'CHK-07': {
    id: 'CHK-07',
    title: '批量制灯：总量 = 单灯 × 数量 × (1 + 损耗率)',
    measure: '长度 m（3 位小数）/ 胶 g（1 位小数）；批量等式容差 0.001m、0.05g',
    scopes: []
  },
  'CHK-08': {
    id: 'CHK-08',
    title: '放样计算 < 100ms',
    measure: '耗时 ms（1 位小数）；阈值 100ms',
    scopes: ['frame', 'print']
  }
}

/**
 * 牵动关系：动某个参数会重新核到哪几条结论（静态全图，一个不漏）。
 * 结论建议里「动这里会牵动」的说法一律从这里取，不准各页自己写。
 */
export const AFFECTS: Record<ParamKey, CheckId[]> = {
  maxDiameterMm: ['CHK-01', 'CHK-02', 'CHK-05', 'CHK-06', 'CHK-08'],
  totalHeightMm: ['CHK-02', 'CHK-05', 'CHK-06', 'CHK-08'],
  mouthDiameterMm: ['CHK-02', 'CHK-05', 'CHK-06'],
  baseDiameterMm: ['CHK-02', 'CHK-05', 'CHK-06'],
  sides: ['CHK-01', 'CHK-02', 'CHK-04', 'CHK-05', 'CHK-06', 'CHK-08'],
  divisions: ['CHK-03', 'CHK-05', 'CHK-06', 'CHK-08'],
  layers: ['CHK-02', 'CHK-05', 'CHK-06', 'CHK-08'],
  mouthStyle: ['CHK-02', 'CHK-05', 'CHK-06'],
  bottomStyle: ['CHK-02', 'CHK-05', 'CHK-06'],
  smoothness: ['CHK-02', 'CHK-05'],
  ctrl1: ['CHK-02', 'CHK-05'],
  ctrl2: ['CHK-02', 'CHK-05'],
  seamAllowanceMm: ['CHK-03', 'CHK-06'],
  lashAllowanceMm: ['CHK-04'],
  covering: ['CHK-07'],
  batchCount: ['CHK-07'],
  wasteRatio: ['CHK-07'],
  pageSize: ['CHK-06'],
  overlapMm: []
}

/** 面积核对分档（按裁片净面积 / 灯体表面积的比值） */
export function areaBandOf(ratio: number): { band: string; pass: boolean } {
  if (!isFinite(ratio) || ratio <= 0) return { band: '无法核算', pass: false }
  if (ratio < 0.94) return { band: '净面积明显偏小（差 >6%）', pass: false }
  if (ratio < 0.97) return { band: '净面积偏小（逼近 97.00% 下限）', pass: false }
  if (ratio <= 1.03) return { band: '合格（落在 97.00%~103.00%）', pass: true }
  if (ratio <= 1.06) return { band: '净面积偏大（逼近 103.00% 上限）', pass: false }
  return { band: '净面积明显偏大（差 >6%）', pass: false }
}

// ---------------------------------------------------------------------------
// 参数指纹：任何会改到几何/裁片/用量/图纸的参数都进指纹；
// 指纹一变，存档快照与已导出单子即判为「老结论」。
// ---------------------------------------------------------------------------

const FP_KEYS: ParamKey[] = [
  'maxDiameterMm',
  'totalHeightMm',
  'mouthDiameterMm',
  'baseDiameterMm',
  'sides',
  'divisions',
  'mouthStyle',
  'bottomStyle',
  'smoothness',
  'ctrl1',
  'ctrl2',
  'seamAllowanceMm',
  'lashAllowanceMm',
  'covering',
  'batchCount',
  'wasteRatio',
  'pageSize',
  'overlapMm'
]

function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function paramFingerprint(l: Lantern): string {
  const o: Record<string, unknown> = { g: GUIDE_VERSION, kind: l.kind }
  for (const k of FP_KEYS) (o[k] as unknown) = l[k]
  o.layers = l.layers.map((x) => [x.heightMm])
  return fnv1a(JSON.stringify(o))
}

/** 人能核对的参数摘要（存档/单子上留的参数到底是哪一组） */
export function paramsBrief(l: Lantern): string {
  return [
    `⌀${l.maxDiameterMm}`,
    `H${l.totalHeightMm}`,
    `收口⌀${l.mouthDiameterMm}`,
    `底⌀${l.baseDiameterMm}`,
    `${l.sides}棱`,
    `${l.layers.length}层`,
    `等分${l.divisions}`,
    `缝份${l.seamAllowanceMm}`,
    `绑扎${l.lashAllowanceMm}`,
    `${l.pageSize}`,
    `搭接${l.overlapMm}`,
    `批量${l.batchCount}`,
    `损耗${(l.wasteRatio * 100).toFixed(0)}%`
  ].join(' ')
}

// ---------------------------------------------------------------------------
// 旧存档补齐：缺参数按写明的默认值补，缺项列清单；无版本戳按老档对待。
// ---------------------------------------------------------------------------

/** 旧存档缺项 → 默认值（写明，补入后参与核对） */
export const MIGRATION_DEFAULTS = {
  seamAllowanceMm: CRAFT.defaultSeamAllowanceMm,
  lashAllowanceMm: CRAFT.defaultLashAllowanceMm,
  divisions: CRAFT.defaultDivisions,
  overlapMm: CRAFT.defaultOverlapMm,
  pageSize: 'A4' as const,
  batchCount: 20,
  smoothness: 0,
  mouthStyle: 'flat' as const,
  bottomStyle: 'flat' as const,
  covering: 'xuan' as const,
  ctrl1: { x: 0.12, y: 0.3 },
  ctrl2: { x: 0.85, y: 0.78 }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v)

/** 把旧档补齐为当前模型；返回补了哪些项（人类可读，必须列给用户） */
export function migrateLantern(raw: Partial<Lantern> & { id: string; name?: string }): {
  lantern: Lantern
  missing: string[]
  oldGuide: boolean
} {
  const missing: string[] = []
  const note = (label: string, val: string) => missing.push(`${label}（旧档缺失，按默认值 ${val} 补入）`)

  const kind = raw.kind || 'prism'
  const maxDiameterMm = isNum(raw.maxDiameterMm) ? raw.maxDiameterMm : 300
  if (!isNum(raw.maxDiameterMm)) note('最大直径', '300mm')

  const totalHeightMm = isNum(raw.totalHeightMm) ? raw.totalHeightMm : 300
  if (!isNum(raw.totalHeightMm)) note('总高', '300mm')

  let mouthDiameterMm = isNum(raw.mouthDiameterMm) ? raw.mouthDiameterMm : maxDiameterMm
  if (!isNum(raw.mouthDiameterMm)) note('收口直径', `随最大直径 ${maxDiameterMm}mm`)
  let baseDiameterMm = isNum(raw.baseDiameterMm) ? raw.baseDiameterMm : maxDiameterMm
  if (!isNum(raw.baseDiameterMm)) note('底口直径', `随最大直径 ${maxDiameterMm}mm`)

  const defaultSides = kind === 'box' || kind === 'polyhedron' ? 4 : kind === 'revolution' ? 8 : 6
  const sides = isNum(raw.sides) ? Math.round(raw.sides) : defaultSides
  if (!isNum(raw.sides)) note(PARAM_LABELS.sides, `${defaultSides}`)

  let layers =
    Array.isArray(raw.layers) && raw.layers.length > 0
      ? raw.layers.map((x) => ({ heightMm: isNum(x.heightMm) ? x.heightMm : totalHeightMm / (raw.layers as unknown[]).length, diameterMm: isNum(x.diameterMm) ? x.diameterMm : 0 }))
      : []
  if (layers.length === 0) {
    note(PARAM_LABELS.layers, `1 层 / 层高 ${totalHeightMm}mm`)
    layers = [{ heightMm: totalHeightMm, diameterMm: 0 }]
  }

  const mouthStyle = raw.mouthStyle || MIGRATION_DEFAULTS.mouthStyle
  if (!raw.mouthStyle) note(PARAM_LABELS.mouthStyle, '平口')
  const bottomStyle = raw.bottomStyle || MIGRATION_DEFAULTS.bottomStyle
  if (!raw.bottomStyle) note(PARAM_LABELS.bottomStyle, '平口')

  const smoothness = isNum(raw.smoothness) ? raw.smoothness : MIGRATION_DEFAULTS.smoothness
  if (!isNum(raw.smoothness)) note(PARAM_LABELS.smoothness, '0')

  const divisions = isNum(raw.divisions) ? Math.round(raw.divisions) : MIGRATION_DEFAULTS.divisions
  if (!isNum(raw.divisions)) note(`${PARAM_LABELS.divisions}`, `${MIGRATION_DEFAULTS.divisions}`)

  const seamAllowanceMm = isNum(raw.seamAllowanceMm) ? raw.seamAllowanceMm : MIGRATION_DEFAULTS.seamAllowanceMm
  if (!isNum(raw.seamAllowanceMm)) note(PARAM_LABELS.seamAllowanceMm, `每边 ${MIGRATION_DEFAULTS.seamAllowanceMm}mm`)

  const lashAllowanceMm = isNum(raw.lashAllowanceMm) ? raw.lashAllowanceMm : MIGRATION_DEFAULTS.lashAllowanceMm
  if (!isNum(raw.lashAllowanceMm)) note(PARAM_LABELS.lashAllowanceMm, `每端 ${MIGRATION_DEFAULTS.lashAllowanceMm}mm`)

  const covering = raw.covering || MIGRATION_DEFAULTS.covering
  if (!raw.covering) note(PARAM_LABELS.covering, coveringSpec(MIGRATION_DEFAULTS.covering).name)

  const batchCount = isNum(raw.batchCount) ? Math.round(raw.batchCount) : MIGRATION_DEFAULTS.batchCount
  if (!isNum(raw.batchCount)) note(PARAM_LABELS.batchCount, `${MIGRATION_DEFAULTS.batchCount}`)

  const wasteRatio =
    isNum(raw.wasteRatio) ? raw.wasteRatio : coveringSpec(covering).wasteRatio
  if (!isNum(raw.wasteRatio)) note(PARAM_LABELS.wasteRatio, `${Math.round(wasteRatio * 100)}%（随蒙面类型）`)

  const pageSize = raw.pageSize === 'A3' ? 'A3' : 'A4'
  if (!raw.pageSize) note(PARAM_LABELS.pageSize, 'A4')

  const overlapMm = isNum(raw.overlapMm) ? raw.overlapMm : MIGRATION_DEFAULTS.overlapMm
  if (!isNum(raw.overlapMm)) note(PARAM_LABELS.overlapMm, `${MIGRATION_DEFAULTS.overlapMm}mm`)

  const nowIso = raw.createdAt || new Date().toISOString()
  const lantern: Lantern = {
    id: raw.id,
    kind: kind as Lantern['kind'],
    name: raw.name || '未命名灯样',
    maxDiameterMm,
    totalHeightMm,
    mouthDiameterMm,
    baseDiameterMm,
    sides,
    layers,
    mouthStyle: mouthStyle as Lantern['mouthStyle'],
    bottomStyle: bottomStyle as Lantern['bottomStyle'],
    smoothness,
    ctrl1: raw.ctrl1 ? { ...raw.ctrl1 } : { ...MIGRATION_DEFAULTS.ctrl1 },
    ctrl2: raw.ctrl2 ? { ...raw.ctrl2 } : { ...MIGRATION_DEFAULTS.ctrl2 },
    divisions,
    covering: covering as Lantern['covering'],
    seamAllowanceMm,
    lashAllowanceMm,
    layerColors: Array.isArray(raw.layerColors) && raw.layerColors.length ? [...raw.layerColors] : ['#b3241f'],
    color: raw.color || '#b3241f',
    batchCount,
    wasteRatio,
    pageSize,
    overlapMm,
    guideVersion: GUIDE_VERSION,
    checksSnapshot: raw.checksSnapshot,
    migrationNotes: undefined,
    exports: Array.isArray(raw.exports) ? raw.exports : [],
    createdAt: nowIso,
    updatedAt: raw.updatedAt || nowIso
  }
  syncLayerDiameters(lantern)

  const oldGuide = raw.guideVersion !== GUIDE_VERSION
  if (oldGuide) {
    missing.unshift(
      raw.guideVersion
        ? `对应表版本为 ${raw.guideVersion}（现行 ${GUIDE_VERSION}）：存档里的老结论作废，已按 ${GUIDE_VERSION} 重新核对`
        : `对应表版本缺失（按 ${GUIDE_VERSION} 前的老档对待）：存档里的老结论作废，已按 ${GUIDE_VERSION} 重新核对`
    )
  }
  return { lantern, missing, oldGuide }
}

// ---------------------------------------------------------------------------
// 改参数的唯一入口（点建议「用这个值」与预览页手改都走这里，保证联动一致）
// ---------------------------------------------------------------------------

export function applyParam(l: Lantern, p: ParamKey, value: number | string) {
  switch (p) {
    case 'divisions':
      l.divisions = Math.max(CRAFT.divMin, Math.min(CRAFT.divMax, Math.round(Number(value))))
      break
    case 'totalHeightMm': {
      l.totalHeightMm = Math.max(40, Number(value))
      distributeLayers(l)
      break
    }
    case 'layers':
      // 层数调整由预览页专用控件处理（要重建 layers 数组），这里不做直通
      break
    case 'seamAllowanceMm':
      l.seamAllowanceMm = Math.max(0, Math.min(40, Number(value)))
      break
    case 'lashAllowanceMm':
      l.lashAllowanceMm = Math.max(0, Math.min(80, Number(value)))
      break
    case 'maxDiameterMm':
      l.maxDiameterMm = Math.max(20, Math.min(3000, Number(value)))
      break
    case 'mouthDiameterMm':
      l.mouthDiameterMm = Math.max(10, Math.min(3000, Number(value)))
      break
    case 'baseDiameterMm':
      l.baseDiameterMm = Math.max(10, Math.min(3000, Number(value)))
      break
    case 'batchCount':
      l.batchCount = Math.max(1, Math.min(500, Math.round(Number(value))))
      break
    case 'wasteRatio':
      l.wasteRatio = Math.max(0, Math.min(0.2, Number(value)))
      break
    case 'overlapMm':
      l.overlapMm = Math.max(0, Math.min(60, Number(value)))
      break
    case 'pageSize':
      l.pageSize = value === 'A3' ? 'A3' : 'A4'
      break
    default:
      // 枚举/控制点等在各自控件上改，不提供数值直通
      break
  }
}

// ---------------------------------------------------------------------------
// 影响排队：对每条结论，用数值扰动给相关参数排影响大小（全参候选，一个不漏）
// ---------------------------------------------------------------------------

export interface HintContext {
  frame: FrameResult
  panels: PanelResult
  materials: SingleLightMaterials
  batch: BatchMaterials
  sheets: Sheet[]
  elapsedMs: number
}

interface Ranked {
  param: ParamKey
  impact: 'high' | 'medium' | 'low'
  advice: string
  suggestValue?: number
}

const impactRank = { high: 0, medium: 1, low: 2 }

function areaRatio(l: Lantern, divisionsOverride?: number): number {
  const ll: Lantern = { ...l, divisions: divisionsOverride ?? l.divisions }
  const g = buildFrame(ll).geometry
  const net = buildPanels(ll).netAreaMm2
  const ref = bodySurfaceArea(g, Math.max(3, Math.round(ll.divisions)))
  return ref > 0 ? net / ref : 0
}

function clone(l: Lantern): Lantern {
  return { ...l, layers: l.layers.map((x) => ({ ...x })), ctrl1: { ...l.ctrl1 }, ctrl2: { ...l.ctrl2 }, layerColors: [...l.layerColors] }
}

/** CHK-05 面积核对：母线等分数按整数逐档往上加，求能落进容差的最小整数 */
export function divisionsToPass(l: Lantern, ratioAtCurrent: number): { target: number | null; ratioAtTarget: number | null; best: number; bestRatio: number } {
  const cur = Math.max(3, Math.round(l.divisions))
  let best = cur
  let bestRatio = ratioAtCurrent
  let target: number | null = null
  let ratioAtTarget: number | null = null
  for (let d = cur + 1; d <= CRAFT.divMax; d++) {
    const r = areaRatio(l, d)
    if (Math.abs(r - 1) < Math.abs(bestRatio - 1)) {
      best = d
      bestRatio = r
    }
    if (target === null && r >= 0.97 && r <= 1.03) {
      target = d
      ratioAtTarget = r
    }
  }
  return { target, ratioAtTarget, best, bestRatio }
}

/** CHK-06：裁片在当前纸面上的超区情况 */
function panelOverflow(l: Lantern, paper: Lantern['pageSize']) {
  const dims = PAPER_DIMS[paper]
  const contentW = dims.wMm - 16
  const contentH = dims.hMm - (12 + 4) - 8
  const over: { label: string; w: number; h: number }[] = []
  for (const p of buildPanels(l).panels) {
    const w = Math.max(p.widthTopMm, p.widthBottomMm) + 8
    const h = p.heightMm + 13
    if (w > contentW + 0.001 || h > contentH + 0.001) over.push({ label: p.label, w, h })
  }
  return { over, contentW, contentH }
}

function rankArea(l: Lantern, ratio: number): Ranked[] {
  const out: Ranked[] = []
  const revolution = l.kind === 'revolution'

  if (revolution) {
    const search = divisionsToPass(l, ratio)
    if (search.target !== null) {
      out.push({
        param: 'divisions',
        impact: 'high',
        advice: `母线等分数按整数从 ${l.divisions} 逐档往上加，加到 ${search.target} 即落进容差（预计比值 ${(search.ratioAtTarget! * 100).toFixed(2)}%，面积 m² 三位小数口径不变）`,
        suggestValue: search.target
      })
    } else {
      out.push({
        param: 'divisions',
        impact: Math.abs(search.bestRatio - 1) < Math.abs(ratio - 1) ? 'medium' : 'low',
        advice: `一直加到上限 ${CRAFT.divMax} 等分（比值最低约 ${(search.bestRatio * 100).toFixed(2)}%）仍进不了 [97.00%,103.00%]，光加等分不够，还得动尺寸`,
        suggestValue: search.best
      })
    }
  }

  // 尺寸类参数：±5% 扰动看对比值靠近 1 的程度排队
  const scalars: { p: ParamKey; dir: string }[] = [
    { p: 'maxDiameterMm', dir: '直径' },
    { p: 'totalHeightMm', dir: '总高' },
    { p: 'mouthDiameterMm', dir: '收口直径' },
    { p: 'baseDiameterMm', dir: '底口直径' },
    { p: 'smoothness', dir: '收口曲线强度' }
  ]
  for (const { p } of scalars) {
    if (p === 'smoothness' && l.mouthStyle === 'flat' && l.bottomStyle === 'flat') continue
    const up = clone(l)
    ;(up[p] as number) = Math.min(p === 'smoothness' ? 1 : 1e9, (l[p] as number) * 1.05 + (p === 'smoothness' ? 0 : 0))
    const rUp = areaRatio(up)
    const gain = Math.abs(ratio - 1) - Math.abs(rUp - 1)
    if (!revolution && Math.abs(gain) < 0.0005) {
      out.push({ param: p, impact: 'low', advice: `${PARAM_LABELS[p]}：棱柱/多面体侧面积与裁片面积同公式，改它对比值几乎无影响（当前 Δ比值 ${(gain * 100).toFixed(2)}%）` })
      continue
    }
    const toward = gain > 0 ? '加大' : gain < -0.0005 ? '减小' : '两边都试'
    out.push({
      param: p,
      impact: gain > 0.01 ? 'high' : gain > 0.002 ? 'medium' : 'low',
      advice: `${toward}${PARAM_LABELS[p]}可把比值向 100.00% 拉（试算 +5% 时比值 ${(rUp * 100).toFixed(2)}%）；比值始终按百分数两位小数、面积折 m² 三位小数核`
    })
  }

  out.push({
    param: 'layers',
    impact: revolution ? 'low' : 'low',
    advice: '改层数/各层高会重配侧面与顶底盖的面积占比；不改变总面积公式，通常只作微调'
  })
  if (!revolution) {
    out.push({
      param: 'sides',
      impact: 'low',
      advice: '棱数改变单块裁片形状但 n 块总面积不变，比值不受影响'
    })
  }
  return out
}

function rankPaging(l: Lantern, pass: boolean, overflow = 0): Ranked[] {
  const out: Ranked[] = []
  const cur = panelOverflow(l, l.pageSize)
  // 断言通过但有超区整块输出时，仍按「有超区片」给换纸/缩小建议（打不出来，需手工接纸）
  if (!pass || overflow > 0) {
    if (l.pageSize === 'A4') {
      const a3 = panelOverflow(l, 'A3')
      out.push({
        param: 'pageSize',
        impact: a3.over.length < cur.over.length ? 'high' : 'low',
        advice:
          a3.over.length < cur.over.length
            ? `改用 A3（可打印区 ${a3.contentW}×${a3.contentH}mm）后超区裁片 ${cur.over.length} → ${a3.over.length} 块，仍超的要整块接纸`
            : `换 A3（可打印区 ${a3.contentW}×${a3.contentH}mm)也放不下，裁片本身过大`,
        suggestValue: undefined
      })
    } else {
      out.push({ param: 'pageSize', impact: 'low', advice: '已是 A3；A3 仍超区只能缩小裁片或按编号手工接纸' })
    }

    if (l.kind === 'revolution') {
      const maxR = Math.max(...buildFrame(l).geometry.sections.map((s) => s.radiusMm))
      const need = Math.ceil((2 * Math.PI * maxR) / Math.max(1, cur.contentW - 8 - 2 * l.seamAllowanceMm))
      const target = Math.max(l.divisions + 1, need)
      if (target <= CRAFT.divMax) {
        const probe = clone(l)
        probe.divisions = target
        out.push({
          param: 'divisions',
          impact: panelOverflow(probe, l.pageSize).over.length < cur.over.length ? 'high' : 'medium',
          advice: `母线等分数按整数加到 ${target}：每块展开片宽 ≈ 周长/等分数，加宽方向不再超区（顶/底圆片超区与等分数无关）`,
          suggestValue: target
        })
      }
    }

    const seamProbe = clone(l)
    seamProbe.seamAllowanceMm = Math.max(0, l.seamAllowanceMm - 5)
    out.push({
      param: 'seamAllowanceMm',
      impact: panelOverflow(seamProbe, l.pageSize).over.length < cur.over.length ? 'medium' : 'low',
      advice: `减小缝份（现每边 ${l.seamAllowanceMm}mm）只缩小裁切外框，净样不变；试算每边 ${seamProbe.seamAllowanceMm}mm`
    })

    for (const p of ['maxDiameterMm', 'totalHeightMm', 'mouthDiameterMm', 'baseDiameterMm'] as ParamKey[]) {
      const probe = clone(l)
      ;(probe[p] as number) = (l[p] as number) * 0.95
      out.push({
        param: p,
        impact: panelOverflow(probe, l.pageSize).over.length < cur.over.length ? 'high' : 'low',
        advice: `减小${PARAM_LABELS[p]}约 5% 可整体缩小裁片（会同时牵动几何与面积核对，改完重核）；超区 ${cur.over.length} 块时通常要改得更多`
      })
    }
    out.push({ param: 'layers', impact: 'low', advice: '增加层数把每段高度切小，可降低单片高度，但块数变多' })
  } else {
    out.push({ param: 'pageSize', impact: 'low', advice: `当前 ${l.pageSize} 可打印区内所有裁片完整；换 A3 更宽松` })
    out.push({ param: 'seamAllowanceMm', impact: 'low', advice: '加大缝份会顶大裁切外框，逼近纸面时可能超区' })
    if (l.kind === 'revolution') out.push({ param: 'divisions', impact: 'low', advice: '减小等分数单片变宽，可能超区' })
    for (const p of ['maxDiameterMm', 'totalHeightMm', 'mouthDiameterMm', 'baseDiameterMm', 'layers'] as ParamKey[]) {
      out.push({ param: p, impact: 'low', advice: `改${PARAM_LABELS[p]}会重排裁片，当前已通过、一般无需动` })
    }
  }
  return out
}

/** 构造一条结论的全部参数建议（影响排序 + 牵动结论） */
function toHints(self: CheckId, ranked: Ranked[]): import('./types').ParamHint[] {
  return ranked
    .sort((a, b) => impactRank[a.impact] - impactRank[b.impact] || PARAM_LABELS[a.param].localeCompare(PARAM_LABELS[b.param], 'zh'))
    .map((r) => ({
      param: r.param,
      label: PARAM_LABELS[r.param],
      impact: r.impact,
      advice: r.advice,
      suggestValue: r.suggestValue,
      affects: AFFECTS[r.param].filter((id) => id !== self)
    }))
}

/** 通过态的相关参数名单：全部相关参数一个不漏，但只说明当前为什么不用动 */
function passHints(id: CheckId, l: Lantern): import('./types').ParamHint[] {
  const params = (Object.keys(AFFECTS) as ParamKey[]).filter((p) => AFFECTS[p].includes(id))
  return params.map((p) => ({
    param: p,
    label: PARAM_LABELS[p],
    impact: 'low' as const,
    advice: `本项当前通过；${PARAM_LABELS[p]}参与本项计算，改动后会自动重核，越界即加回未过名单。当前取值：${paramValueText(l, p)}`,
    affects: AFFECTS[p].filter((x) => x !== id)
  }))
}

export function buildHints(id: CheckId, l: Lantern, ctx: HintContext, ratio: number): import('./types').ParamHint[] {
  let ranked: Ranked[] = []
  switch (id) {
    case 'CHK-01':
      ranked = [
        { param: 'maxDiameterMm', impact: 'low', advice: '公式核对项：算得值与手算值用同一条 2R·sin(π/n)，改直径不改变核对结论' },
        { param: 'sides', impact: 'low', advice: '棱数只换算例（6 棱/8 棱），公式恒等；此项若失败属程序错误而非参数问题' }
      ]
      break
    case 'CHK-02':
      ranked = [
        { param: 'totalHeightMm', impact: 'high', advice: '总高一改按层数均分各段，竖篾折线长随之变；先核对总高与各段高之和' },
        { param: 'layers', impact: 'high', advice: '各分段高度直接累加为竖篾折线长；查某一层是否被手工改过' },
        { param: 'mouthDiameterMm', impact: 'medium', advice: '收口直径改肩部横向偏移，只动折线长、不动分段高累计' },
        { param: 'baseDiameterMm', impact: 'medium', advice: '底口直径同理，影响下肩折线长' },
        { param: 'mouthStyle', impact: 'medium', advice: '平口直柱无横向偏移；切到收口/葫芦口会引入折线增量' },
        { param: 'bottomStyle', impact: 'medium', advice: '下收口方式同理' },
        { param: 'smoothness', impact: 'medium', advice: '强度改变肩部占高比例，间接重排各分段高度' },
        { param: 'ctrl1', impact: l.mouthStyle === 'gourd' ? 'medium' : 'low', advice: '葫芦控制点改肩部曲线形状；非葫芦口时不参与' },
        { param: 'ctrl2', impact: l.mouthStyle === 'gourd' ? 'medium' : 'low', advice: '葫芦控制点改肩部曲线形状；非葫芦口时不参与' },
        { param: 'sides', impact: 'low', advice: '棱数/母线根数改变篾的根数，不改变单根折线长' },
        { param: 'maxDiameterMm', impact: 'low', advice: '最大直径只在带收口时间接影响折线，作用远小于总高' }
      ]
      break
    case 'CHK-03':
      ranked = [
        { param: 'seamAllowanceMm', impact: 'high', advice: `缝份现在每边 ${l.seamAllowanceMm}mm，裁片三向尺寸 = 净尺寸 + 缝份×2；等式由构造保证` },
        { param: 'divisions', impact: 'low', advice: '等分数只改每块净宽，缝份等式照样成立，不用于转通过' },
        { param: 'maxDiameterMm', impact: 'low', advice: '直径只改净尺寸，缝份随净尺寸外加，等式不变' },
        { param: 'totalHeightMm', impact: 'low', advice: '总高只改净尺寸，缝份随净尺寸外加，等式不变' }
      ]
      break
    case 'CHK-04':
      ranked = [
        { param: 'lashAllowanceMm', impact: 'high', advice: `绑扎余量现每端 ${l.lashAllowanceMm}mm；备料与净长之差恒等于「处数 × ${l.lashAllowanceMm}」` },
        { param: 'sides', impact: 'medium', advice: '多边形横篾圈按棱数计接头处数，改棱数会改余量总和与备料差值' },
        { param: 'layers', impact: 'low', advice: '层数改横篾圈根数，备料总长变，差值等式仍成立' }
      ]
      break
    case 'CHK-05':
      ranked = rankArea(l, ratio)
      break
    case 'CHK-06': {
      const split = assertNoPanelSplit(ctx.sheets)
      ranked = rankPaging(l, split.pass, split.overflow)
      break
    }
    case 'CHK-07':
      ranked = [
        { param: 'batchCount', impact: 'high', advice: `批量现 ${l.batchCount} 个；总量恒等于 单灯 × ${l.batchCount} × (1+损耗率)，等式由计算保证` },
        { param: 'wasteRatio', impact: 'high', advice: `损耗率现 ${(l.wasteRatio * 100).toFixed(0)}%；LED 按颗数 × 数量，不乘损耗` },
        { param: 'covering', impact: 'medium', advice: '换蒙面类型会带出该材料的默认损耗率与用胶量，切完看损耗率是否被带走' }
      ]
      break
    case 'CHK-08':
      ranked = [
        { param: 'divisions', impact: 'low', advice: `现 ${l.divisions} 等分：裁片块数与图纸页数随等分数上升，耗时仍远低于 100ms` },
        { param: 'layers', impact: 'low', advice: '层数增加构件与裁片种类，耗时微增' },
        { param: 'sides', impact: 'low', advice: '棱数/母线根数影响构件数，耗时微增' }
      ]
      break
  }
  return toHints(id, ranked)
}

/** 把重算结果挂到结论上（编号/标题/口径全取名册，避免各页各说各话） */
export function decorate(check: Pick<CheckResult, 'id' | 'pass' | 'detail' | 'value'>, l: Lantern, ctx: HintContext, ratio: number): CheckResult {
  const id = check.id as CheckId
  const meta = CHECK_REGISTRY[id]
  return {
    ...check,
    id,
    title: meta.title,
    guideVersion: GUIDE_VERSION,
    measure: meta.measure,
    scopes: meta.scopes,
    // 未过：按影响排队的调整建议；已过：相关参数名单（一个不漏，只标位置不给改法）
    paramHints: check.pass ? passHints(id, l) : buildHints(id, l, ctx, ratio)
  }
}

/** 存档/单子里的老结论逐条点差（点明是哪一条、当时值与现在值） */
export interface EntryDiff {
  id: string
  oldPass: boolean
  oldValue: string
  nowPass: boolean
  nowValue: string
}

export function diffEntries(
  oldEntries: CheckSnapshot['entries'],
  current: CheckResult[]
): EntryDiff[] {
  const cur = new Map(current.map((c) => [c.id, c]))
  const out: EntryDiff[] = []
  for (const e of oldEntries) {
    const c = cur.get(e.id)
    if (!c) continue
    if (c.pass !== e.pass || (c.value || '') !== (e.value || '')) {
      out.push({ id: e.id, oldPass: e.pass, oldValue: e.value || '', nowPass: c.pass, nowValue: c.value || '' })
    }
  }
  return out
}

export function snapshotOf(l: Lantern, checks: CheckResult[], at: string): CheckSnapshot {
  return {
    at,
    guideVersion: GUIDE_VERSION,
    fingerprint: paramFingerprint(l),
    entries: checks.map((c) => ({ id: c.id, title: c.title, pass: c.pass, value: c.value || '' }))
  }
}

/** 导出单子留痕与当前参数/结论的对照（参数一改即判为老单子） */
export interface StaleExport {
  name: string
  at: string
  guideVersion: string
  oldGuide: boolean
  changed: EntryDiff[]
}

/** 逐条点出存档里的快照、已发出的单子/图纸哪些还是老结论、老在哪一条 */
export function staleState(l: Lantern, checks: CheckResult[]): {
  snapshotStale: boolean
  snapshotDiff: EntryDiff[]
  staleExports: StaleExport[]
} {
  const fp = paramFingerprint(l)
  const snapshotStale = !l.checksSnapshot || l.checksSnapshot.guideVersion !== GUIDE_VERSION || l.checksSnapshot.fingerprint !== fp
  const snapshotDiff = l.checksSnapshot ? diffEntries(l.checksSnapshot.entries, checks) : []
  const staleExports: StaleExport[] = []
  for (const e of l.exports || []) {
    if (e.guideVersion !== GUIDE_VERSION || e.fingerprint !== fp) {
      staleExports.push({
        name: e.name,
        at: e.at,
        guideVersion: e.guideVersion,
        oldGuide: e.guideVersion !== GUIDE_VERSION,
        changed: diffEntries(e.entries, checks)
      })
    }
  }
  return { snapshotStale, snapshotDiff, staleExports }
}

export function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
