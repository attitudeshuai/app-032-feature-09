/**
 * 灯样存储（Vue 自带响应式 + localStorage，无 Pinia/Vuex）
 * 灯型库与工艺参数来自本地打包 src/data/lantern-types.json，断网可用。
 *
 * 本机存档（version 2）含三份内容，与页面自检同一套对应关系：
 *  - lanterns：灯样参数（旧存档缺参数时按写明的默认值补上，缺项列入 migrations）
 *  - snapshots：每个灯样最近一次自检结论快照（结论 + 取值 + 相关参数 + 结论版本号）
 *  - exports：已导出单子登记（哪份单子基于哪个结论版本；版本对不上即指的仍是老结论）
 */
import { reactive, watch } from 'vue'
import type { CheckSnapshot, Lantern } from './types'
import { CRAFT, coveringSpec, presetById, PRESETS } from './craft'
import { buildGeometry, effectiveHeight, r1 } from './geometry'
import { computeAll } from './checks'
import { DEFAULT_LOFT_OPTIONS } from './paginate'
import { checksDigest, PARAM_META } from './check-map'

const KEY = 'lantern-frame-lofting.v1'

/** 已导出单子登记：kind → 单子中文名 */
export const EXPORT_KIND_LABELS: Record<string, string> = {
  members: '构件清单 CSV',
  panels: '蒙面裁片清单 CSV',
  materials: '备料单 CSV'
}

export interface ExportRecord {
  lanternId: string
  kind: keyof typeof EXPORT_KIND_LABELS
  file: string
  at: string
  /** 导出时的结论版本号；与当前版本不一致即「指的仍是老结论」 */
  digest: string
}

export interface MigrationInfo {
  id: string
  name: string
  /** 旧存档缺了哪些参数（已按默认值补上） */
  filled: string[]
}

interface StoreState {
  lanterns: Lantern[]
  exports: ExportRecord[]
  snapshots: Record<string, CheckSnapshot>
  migrations: MigrationInfo[]
  ready: boolean
  storageError: string
}

export const state = reactive<StoreState>({
  lanterns: [],
  exports: [],
  snapshots: {},
  migrations: [],
  ready: false,
  storageError: ''
})

let suspendPersist = false
let timer: number | undefined

function makeId(): string {
  return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function r1v(v: number): number {
  return Math.round(v * 10) / 10
}

/** 依据灯型库预设新建灯样 */
export function createFromPreset(presetId: string): Lantern {
  const preset = presetById(presetId) || PRESETS[0]
  const p = preset.params
  const count = Math.max(1, Math.round(p.layerCount))
  const each = p.totalHeightMm / count
  const layers = Array.from({ length: count }, () => ({ heightMm: r1v(each), diameterMm: 0 }))
  // 保证分段高度之和 = 总高
  const sum = layers.reduce((s, x) => s + x.heightMm, 0)
  layers[layers.length - 1].heightMm = r1v(layers[layers.length - 1].heightMm + (p.totalHeightMm - sum))

  const now = new Date().toISOString()
  const lantern: Lantern = {
    id: makeId(),
    kind: preset.kind,
    name: preset.name,
    maxDiameterMm: p.maxDiameterMm,
    totalHeightMm: p.totalHeightMm,
    mouthDiameterMm: p.mouthDiameterMm,
    baseDiameterMm: p.baseDiameterMm,
    sides: p.sides,
    layers,
    mouthStyle: p.mouthStyle,
    bottomStyle: p.bottomStyle,
    smoothness: p.smoothness,
    ctrl1: p.ctrl1 ? { ...p.ctrl1 } : { x: 0.12, y: 0.3 },
    ctrl2: p.ctrl2 ? { ...p.ctrl2 } : { x: 0.85, y: 0.78 },
    divisions: p.divisions ?? CRAFT.defaultDivisions,
    covering: p.covering,
    seamAllowanceMm: CRAFT.defaultSeamAllowanceMm,
    lashAllowanceMm: CRAFT.defaultLashAllowanceMm,
    layerColors: [...p.layerColors],
    color: p.color,
    batchCount: 20,
    wasteRatio: coveringSpec(p.covering).wasteRatio,
    pageSize: 'A4',
    overlapMm: CRAFT.defaultOverlapMm,
    createdAt: now,
    updatedAt: now
  }
  syncLayerDiameters(lantern)
  return lantern
}

/**
 * 旧存档迁移：缺了的参数按写明的默认值补上再参与核对，缺的项逐条列出。
 * 默认值写法：工艺参数取 lantern-types.json 的 craft 段，其余取下列常量。
 */
function migrateLantern(l: Lantern): string[] {
  const filled: string[] = []
  const anyL = l as unknown as Record<string, unknown>
  const need = (key: string, def: () => unknown, label: string) => {
    if (anyL[key] === undefined || anyL[key] === null) {
      anyL[key] = def()
      filled.push(label)
    }
  }
  need('name', () => '未命名灯样', '名称')
  need('kind', () => 'prism', '灯型')
  need('maxDiameterMm', () => 300, PARAM_META.maxDiameterMm.label)
  need('totalHeightMm', () => 400, PARAM_META.totalHeightMm.label)
  need('mouthDiameterMm', () => anyL.maxDiameterMm ?? 300, PARAM_META.mouthDiameterMm.label)
  need('baseDiameterMm', () => anyL.mouthDiameterMm ?? anyL.maxDiameterMm ?? 300, PARAM_META.baseDiameterMm.label)
  need('sides', () => 6, PARAM_META.sides.label)
  need('mouthStyle', () => 'flat', PARAM_META.mouthStyle.label)
  need('bottomStyle', () => 'flat', PARAM_META.bottomStyle.label)
  need('smoothness', () => 0.45, PARAM_META.smoothness.label)
  need('ctrl1', () => ({ x: 0.12, y: 0.3 }), `${PARAM_META.ctrlCurve.label} 1`)
  need('ctrl2', () => ({ x: 0.85, y: 0.78 }), `${PARAM_META.ctrlCurve.label} 2`)
  need('divisions', () => CRAFT.defaultDivisions, PARAM_META.divisions.label)
  need('covering', () => 'xuan', PARAM_META.covering.label)
  need('seamAllowanceMm', () => CRAFT.defaultSeamAllowanceMm, PARAM_META.seamAllowanceMm.label)
  need('lashAllowanceMm', () => CRAFT.defaultLashAllowanceMm, PARAM_META.lashAllowanceMm.label)
  need('layerColors', () => [], '分层配色')
  need('color', () => '#b3241f', '主色')
  need('batchCount', () => 20, PARAM_META.batchCount.label)
  need('wasteRatio', () => coveringSpec((anyL.covering as Lantern['covering']) || 'xuan').wasteRatio, PARAM_META.wasteRatio.label)
  need('pageSize', () => 'A4', PARAM_META.pageSize.label)
  need('overlapMm', () => CRAFT.defaultOverlapMm, PARAM_META.overlapMm.label)
  need('createdAt', () => new Date().toISOString(), '创建时间')
  need('updatedAt', () => new Date().toISOString(), '修改时间')
  if (!Array.isArray(l.layers) || l.layers.length === 0) {
    l.layers = [{ heightMm: (anyL.totalHeightMm as number) || 300, diameterMm: 0 }]
    filled.push(PARAM_META.layers.label)
  } else {
    for (const ly of l.layers) {
      if (typeof ly.heightMm !== 'number' || ly.heightMm <= 0) {
        ly.heightMm = 100
        if (!filled.includes(PARAM_META.layers.label)) filled.push(PARAM_META.layers.label)
      }
      if (typeof ly.diameterMm !== 'number') ly.diameterMm = 0
    }
  }
  return filled
}

/** 把轮廓算出的直径写回分段（数据模型 §7 中 layers[].diameterMm） */
export function syncLayerDiameters(l: Lantern) {
  const g = buildGeometry(l)
  l.layers.forEach((ly, i) => {
    const sec = g.sections[i + 1]
    if (sec) ly.diameterMm = r1(sec.radiusMm * 2)
  })
  l.totalHeightMm = r1(effectiveHeight(l))
}

/** 分段高度均分（改总高/层数时调用） */
export function distributeLayers(l: Lantern) {
  const count = Math.max(1, Math.round(l.layers.length))
  const each = l.totalHeightMm / count
  l.layers = Array.from({ length: count }, () => ({ heightMm: r1v(each), diameterMm: 0 }))
  const sum = l.layers.reduce((s, x) => s + x.heightMm, 0)
  l.layers[count - 1].heightMm = r1v(l.layers[count - 1].heightMm + (l.totalHeightMm - sum))
  while (l.layerColors.length < count) l.layerColors.push(l.color)
  l.layerColors = l.layerColors.slice(0, count)
  syncLayerDiameters(l)
}

export function addLantern(l: Lantern) {
  state.lanterns.unshift(l)
  return l
}

export function getLantern(id: string): Lantern | undefined {
  return state.lanterns.find((l) => l.id === id)
}

export function duplicateLantern(id: string): Lantern | undefined {
  const src = getLantern(id)
  if (!src) return undefined
  const copy: Lantern = JSON.parse(JSON.stringify(src))
  copy.id = makeId()
  copy.name = src.name + ' 副本'
  copy.createdAt = copy.updatedAt = new Date().toISOString()
  state.lanterns.unshift(copy)
  return copy
}

export function removeLantern(id: string) {
  const i = state.lanterns.findIndex((l) => l.id === id)
  if (i >= 0) state.lanterns.splice(i, 1)
  delete state.snapshots[id]
  state.exports = state.exports.filter((e) => e.lanternId !== id)
}

/** 登记一次导出（同灯样同类单子只留最近一次） */
export function recordExport(rec: ExportRecord) {
  state.exports = [rec, ...state.exports.filter((e) => !(e.lanternId === rec.lanternId && e.kind === rec.kind))].slice(0, 100)
}

function persistNow() {
  suspendPersist = true
  try {
    for (const l of state.lanterns) {
      syncLayerDiameters(l)
      // 本机存档里留下的那一份自检快照：与页面、导出单子同一套对应关系
      try {
        const full = computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: l.pageSize, overlapMm: l.overlapMm })
        state.snapshots[l.id] = {
          at: new Date().toISOString(),
          digest: checksDigest(l, full.checks),
          checks: full.checks
        }
      } catch {
        delete state.snapshots[l.id]
      }
    }
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: 2, lanterns: state.lanterns, exports: state.exports, snapshots: state.snapshots })
    )
    state.storageError = ''
  } catch (e) {
    state.storageError = e instanceof Error ? e.message : String(e)
  } finally {
    suspendPersist = false
  }
}

function schedulePersist() {
  if (timer !== undefined) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = undefined
    persistNow()
  }, 180)
}

/** 载入本地灯样；首次进入预置一个六角宫灯，便于立即放样 */
export function loadStore() {
  if (state.ready) return
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as {
        lanterns?: Lantern[]
        exports?: ExportRecord[]
        snapshots?: Record<string, CheckSnapshot>
      }
      if (Array.isArray(data.lanterns)) {
        state.lanterns = data.lanterns
        for (const l of state.lanterns) {
          const filled = migrateLantern(l)
          if (filled.length) state.migrations.push({ id: l.id, name: l.name, filled })
        }
      }
      if (Array.isArray(data.exports)) state.exports = data.exports
      if (data.snapshots && typeof data.snapshots === 'object') state.snapshots = data.snapshots
    }
  } catch {
    state.storageError = '本地灯样数据损坏，已重置'
  }
  if (state.lanterns.length === 0) {
    state.lanterns.push(createFromPreset('hex-palace'))
  }
  state.ready = true
  // 只盯灯样参数与导出登记；快照在 persistNow 里重算，不参与监听，避免自我触发
  watch(
    () => [state.lanterns, state.exports],
    () => {
      if (suspendPersist) return
      schedulePersist()
    },
    { deep: true }
  )
  persistNow()
}

export function useLanternStore() {
  return {
    state,
    createFromPreset,
    addLantern,
    getLantern,
    duplicateLantern,
    removeLantern,
    distributeLayers,
    syncLayerDiameters,
    recordExport
  }
}
