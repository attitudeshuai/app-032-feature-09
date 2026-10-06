/**
 * 灯样存储（Vue 自带响应式 + localStorage，无 Pinia/Vuex）
 * 灯型库与工艺参数来自本地打包 src/data/lantern-types.json，断网可用。
 *
 * 存档一致性（对应表 G2，见 core/guide.ts）：
 *  - 旧档载入时按写明的默认值补齐缺参，缺项列在 migrationNotes；
 *  - 每次落盘前按当前参数指纹重算八条结论快照（checksSnapshot）；
 *  - 参数一变指纹就变，界面/单子据此判定存档留的是不是老结论。
 */
import { reactive, watch } from 'vue'
import type { Lantern } from './types'
import { CRAFT, coveringSpec, presetById, PRESETS } from './craft'
import { distributeLayers, syncLayerDiameters } from './layers'
import {
  GUIDE_VERSION,
  migrateLantern,
  paramFingerprint,
  snapshotOf
} from './guide'
import { computeAll } from './checks'
import { DEFAULT_LOFT_OPTIONS } from './paginate'

const KEY = 'lantern-frame-lofting.v2'
const LEGACY_KEY = 'lantern-frame-lofting.v1'

interface StoreState {
  lanterns: Lantern[]
  ready: boolean
  storageError: string
}

export const state = reactive<StoreState>({ lanterns: [], ready: false, storageError: '' })

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
    guideVersion: GUIDE_VERSION,
    checksSnapshot: undefined,
    migrationNotes: [],
    exports: [],
    createdAt: now,
    updatedAt: now
  }
  syncLayerDiameters(lantern)
  return lantern
}

export { distributeLayers, syncLayerDiameters }

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
  // 副本的存档/导出留痕属于原灯样，不继承
  copy.checksSnapshot = undefined
  copy.exports = []
  copy.migrationNotes = []
  state.lanterns.unshift(copy)
  return copy
}

export function removeLantern(id: string) {
  const i = state.lanterns.findIndex((l) => l.id === id)
  if (i >= 0) state.lanterns.splice(i, 1)
}

/** 按当前参数重算八条结论快照（本机存档里留的那一份） */
function refreshSnapshot(l: Lantern) {
  const fp = paramFingerprint(l)
  if (l.checksSnapshot && l.checksSnapshot.fingerprint === fp && l.checksSnapshot.guideVersion === GUIDE_VERSION) return
  const full = computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: l.pageSize, overlapMm: l.overlapMm })
  l.checksSnapshot = snapshotOf(l, full.checks, new Date().toISOString())
}

function persistNow() {
  suspendPersist = true
  try {
    for (const l of state.lanterns) {
      syncLayerDiameters(l)
      l.guideVersion = GUIDE_VERSION
      l.updatedAt = new Date().toISOString()
      refreshSnapshot(l)
    }
    localStorage.setItem(KEY, JSON.stringify({ version: 2, guideVersion: GUIDE_VERSION, lanterns: state.lanterns }))
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

/** 立即存档（导出/打印前调用，让单子与存档取同一份结论） */
export function persistImmediately() {
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timer = undefined
  }
  persistNow()
}

/** 载入本地灯样；首次进入预置一个六角宫灯，便于立即放样 */
export function loadStore() {
  if (state.ready) return
  try {
    let raw = localStorage.getItem(KEY)
    let fromLegacy = false
    if (!raw) {
      raw = localStorage.getItem(LEGACY_KEY)
      fromLegacy = !!raw
    }
    if (raw) {
      const data = JSON.parse(raw) as { lanterns?: Partial<Lantern>[] }
      if (Array.isArray(data.lanterns)) {
        state.lanterns = data.lanterns.map((x) => {
          const { lantern, missing } = migrateLantern({ ...x, id: String(x.id || makeId()) })
          lantern.migrationNotes = missing
          if (fromLegacy) {
            lantern.exports = [] // v1 档没有导出留痕，老单子一律按作废提示由用户自行重出
          }
          return lantern
        })
      }
    }
  } catch {
    state.storageError = '本地灯样数据损坏，已重置'
  }
  if (state.lanterns.length === 0) {
    state.lanterns.push(createFromPreset('hex-palace'))
  }
  state.ready = true
  watch(
    () => state.lanterns,
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
    persistImmediately
  }
}
