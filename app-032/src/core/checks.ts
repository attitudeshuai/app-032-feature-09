/**
 * 自检（对应规格书 §10 验收标准）
 * 每次参数变化都会重算全部几何并跑一遍断言，结果直接显示在界面上。
 */
import type { CheckResult, Lantern, RawCheck } from './types'
import { bodySurfaceArea, polygonEdge, polyhedronInfo, ringPerimeter, segmentInfos } from './geometry'
import { buildFrame, type FrameResult } from './frame'
import { buildPanels, panelNetArea, type PanelResult } from './panels'
import { computeBatch, computeMaterials, type BatchMaterials, type SingleLightMaterials } from './materials'
import { assertNoPanelSplit, paginate, type LoftOptions, type Sheet } from './paginate'
import { CRAFT } from './craft'
import { areaBandOf, decorate, divisionsToPass, type HintContext } from './guide'

export interface FullResult {
  frame: FrameResult
  panels: PanelResult
  materials: SingleLightMaterials
  batch: BatchMaterials
  sheets: Sheet[]
  checks: CheckResult[]
  elapsedMs: number
}

/** 装饰前的 CHK 原始核对值；id 必须在 guide.CHECK_REGISTRY 名册内 */
type CheckSeed = RawCheck

const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1)
const f3 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3)

export function computeAll(l: Lantern, loft: LoftOptions): FullResult {
  const t0 = performance.now()
  const frame = buildFrame(l)
  const panels = buildPanels(l)
  const materials = computeMaterials(l)
  const batch = computeBatch(materials, Math.max(1, Math.round(l.batchCount)), l.wasteRatio)
  const sheets = paginate(l, loft)
  const elapsedMs = performance.now() - t0
  const checks = runChecks(l, frame, panels, materials, batch, sheets, elapsedMs)
  // 所有结论统一挂到 G2 对应表上：标题/单位精度/参数建议/牵动关系只取 guide 名册
  const ctx: HintContext = { frame, panels, materials, batch, sheets, elapsedMs }
  const netArea = panels.panels.reduce((a, p) => a + panelNetArea(p) * p.qty, 0)
  const refArea = bodySurfaceArea(frame.geometry, Math.max(3, Math.round(l.divisions)))
  const ratio = refArea > 0 ? netArea / refArea : 0
  const decorated = checks.map((c) => decorate(c, l, ctx, ratio))
  return { frame, panels, materials, batch, sheets, checks: decorated, elapsedMs }
}

function runChecks(
  l: Lantern,
  frame: FrameResult,
  panels: PanelResult,
  materials: SingleLightMaterials,
  batch: BatchMaterials,
  sheets: Sheet[],
  elapsedMs: number
): CheckSeed[] {
  const out: CheckSeed[] = []
  const g = frame.geometry
  const lash = Math.max(0, l.lashAllowanceMm)

  // ---- CHK-01 几何：棱长/周长与手算一致 ----
  {
    const cases = [
      { name: '正六棱柱底边（D200）', got: polygonEdge(100, 6), expect: 100, tol: 1 },
      { name: '正八棱柱底边（D200）', got: polygonEdge(100, 8), expect: 76.5367, tol: 1 },
      { name: '圆形横篾圈周长（D200）', got: ringPerimeter(100, 0, false), expect: 628.3185, tol: 1 },
      { name: '六边形周长（D200）', got: ringPerimeter(100, 6, true), expect: 600, tol: 1 }
    ]
    const bad = cases.filter((c) => Math.abs(c.got - c.expect) > c.tol)
    out.push({
      id: 'CHK-01',
      pass: bad.length === 0,
      value: bad.length === 0 ? '4/4 项通过' : `${bad.length} 项超差`,
      detail: cases
        .map((c) => `${c.name}：算得 ${f3(c.got)} / 手算 ${f3(c.expect)}（Δ${f3(Math.abs(c.got - c.expect))}）；单位 mm，保留 3 位小数，容差 ±1mm`)
        .join('；')
    })
  }

  // ---- CHK-02 竖篾/棱篾长度核对（构件长按 1 位小数下料，核对同口径） ----
  if (g.kind === 'polyhedron') {
    const info = polyhedronInfo(g)
    const edgeMember = frame.members.find((m) => m.kind === 'vertical')
    const raw = edgeMember ? edgeMember.rawLengthMm : 0
    const pass = Math.abs(raw - Math.round(info.edgeMm * 10) / 10) <= 0.1 + 1e-6
    out.push({
      id: 'CHK-02',
      pass,
      value: `棱篾 ${f1(raw)}mm / 公式棱长 ${f1(info.edgeMm)}mm`,
      detail: `多面体无竖篾，棱篾按外接球直径 ⌀${f1(info.circumR * 2)}mm 的正${
        info.kind === 'tetra' ? '四' : '八'
      }面体公式下料；单位 mm，保留 1 位小数，Δ${f1(Math.abs(raw - info.edgeMm))}mm`
    })
  } else {
    const segs = segmentInfos(g)
    const sumH = segs.reduce((s, x) => s + x.heightMm, 0)
    const sumSlant = segs.reduce((s, x) => s + x.slantMm, 0)
    const vertical = frame.members.find((m) => m.kind === 'vertical' || m.kind === 'rib')
    // 构件净长已按 mm 1 位小数下料；累计端同口径四舍五入后再比，避免舍入层叠误报
    const raw = vertical ? vertical.rawLengthMm : 0
    const allStraight = segs.every((s) => Math.abs(s.drMm) < 0.05)
    const pass =
      Math.abs(raw - Math.round(sumSlant * 10) / 10) <= 0.1 + 1e-6 &&
      (!allStraight || Math.abs(raw - Math.round(sumH * 10) / 10) <= 0.1 + 1e-6)
    out.push({
      id: 'CHK-02',
      pass,
      value: `Δ折线 ${f1(Math.abs(raw - Math.round(sumSlant * 10) / 10))}mm`,
      detail: allStraight
        ? `竖篾净长 ${f1(raw)}mm，分段高累计 ${f1(sumH)}mm，平口直柱两者一致（Δ${f1(Math.abs(raw - Math.round(sumH * 10) / 10))}mm）；单位 mm，保留 1 位小数`
        : `竖篾净长 ${f1(raw)}mm，分段高累计 ${f1(sumH)}mm，折线长累计 ${f1(sumSlant)}mm（收口段横向偏移 ${f1(sumSlant - sumH)}mm）；单位 mm，保留 1 位小数`
    })
  }

  // ---- CHK-03 缝份 ----
  {
    const s = Math.max(0, l.seamAllowanceMm)
    const bad = panels.panels.filter(
      (p) =>
        Math.abs(p.widthTopMm - (p.rawWidthTopMm + 2 * s)) > 0.06 ||
        Math.abs(p.widthBottomMm - (p.rawWidthBottomMm + 2 * s)) > 0.06 ||
        Math.abs(p.heightMm - (p.rawHeightMm + 2 * s)) > 0.06
    )
    out.push({
      id: 'CHK-03',
      pass: bad.length === 0,
      value: `${panels.panels.length - bad.length}/${panels.panels.length} 种裁片通过`,
      detail:
        bad.length === 0
          ? `全部 ${panels.panels.length} 种裁片上/下/高三个尺寸均等于净尺寸 + ${f1(s)}×2mm（单位 mm，保留 1 位小数）；裁片图以红色虚线绘制缝份折线`
          : `超差裁片：${bad.map((p) => p.label).join('、')}`
    })
  }

  // ---- CHK-04 备料守恒 ----
  {
    const stock = frame.members.reduce((a, m) => a + m.lengthMm * m.qty, 0)
    const rawTotal = frame.members.reduce((a, m) => a + m.rawLengthMm * m.qty, 0)
    const lashTotal = frame.members.reduce((a, m) => a + m.qty * m.lashJoints * lash, 0)
    const diff = stock - rawTotal
    const pass = stock >= rawTotal - 1e-6 && Math.abs(diff - lashTotal) <= 0.5
    out.push({
      id: 'CHK-04',
      pass,
      value: `Σ备料 ${f1(stock)}mm / Σ净长 ${f1(rawTotal)}mm`,
      detail: `差值 ${f1(diff)}mm，应等于余量总和 ${f1(lashTotal)}mm（竖篾两端、横篾圈接头各计 ${f1(lash)}mm）；单位 mm，保留 1 位小数`
    })
  }

  // ---- CHK-05 面积核对（按裁片净面积 / 灯体表面积分档；比值百分数两位小数，面积 m² 三位小数） ----
  {
    const netArea = panels.panels.reduce((a, p) => a + panelNetArea(p) * p.qty, 0)
    const refArea = bodySurfaceArea(g, Math.max(3, Math.round(l.divisions)))
    const ratio = refArea > 0 ? netArea / refArea : 0
    const pass = ratio >= 0.97 && ratio <= 1.03
    const band = areaBandOf(ratio).band
    let advice = ''
    if (!pass && l.kind === 'revolution') {
      const search = divisionsToPass(l, ratio)
      if (search.target !== null) {
        advice = `；母线等分数按整数从 ${l.divisions} 逐档往上加，加到 ${search.target} 即落进容差（预计比值 ${(search.ratioAtTarget! * 100).toFixed(2)}%）`
      } else {
        advice = `；一直加到 ${CRAFT.divMax} 等分仍进不了容差（最好约 ${(search.bestRatio * 100).toFixed(2)}%），需同时调整直径/总高`
      }
    } else if (!pass) {
      advice = '；棱柱/多面体侧面积与裁片面积同公式，比值应恒为 100.00%，请检查是否动过分段或收口参数'
    }
    out.push({
      id: 'CHK-05',
      pass,
      value: `比值 ${(ratio * 100).toFixed(2)}%（${band}）`,
      detail: `裁片净面积 ${f3(netArea / 1_000_000)}m² / 灯体表面积（含顶底盖）${f3(refArea / 1_000_000)}m²；面积折 m² 保留 3 位小数，比值按百分数保留 2 位小数，合格区间 [97.00%, 103.00%]${advice}`
    })
  }

  // ---- CHK-06 分页：裁片不跨页（超区裁片整块单独输出、绝不拆分即算过） ----
  {
    const r = assertNoPanelSplit(sheets)
    const overNote = r.overflow > 0 ? `；另有 ${r.overflow} 块裁片比 ${l.pageSize} 可打印区大，已整块单独成页（未拆分），打印时须换 ${l.pageSize === 'A4' ? 'A3' : '更大纸'}或按编号手工接纸` : ''
    out.push({
      id: 'CHK-06',
      pass: r.pass,
      value: r.pass ? (r.overflow > 0 ? `通过（${r.overflow} 块超区整块输出）` : '通过') : '失败',
      detail: `${r.detail}${overNote}；跨页仅出现在骨架长条上，接缝处绘制对位十字并标注搭接 ${f1(loftOverlap(sheets))}mm 与拼接编号；纸张 ${l.pageSize}（${l.pageSize === 'A4' ? '210×297' : '297×420'}mm）`
    })
  }

  // ---- CHK-07 批量 ----
  {
    const n = Math.max(1, Math.round(l.batchCount))
    const k = n * (1 + l.wasteRatio)
    // 与单灯值的偏差只来自展示精度（长度 3 位小数 / 胶 1 位小数）
    const errs = [
      Math.abs(batch.frameM - materials.frameM * k),
      Math.abs(batch.coveringM2 - materials.coveringM2 * k),
      Math.abs(batch.lashM - materials.lashM * k)
    ]
    const pass = errs.every((e) => e <= 0.0011) && Math.abs(batch.glueG - materials.glueG * k) <= 0.051
    out.push({
      id: 'CHK-07',
      pass,
      value: `竹篾 ${f3(batch.frameM)}m / 蒙面 ${f3(batch.coveringM2)}m²`,
      detail: `单灯竹篾 ${f3(materials.frameM)}m × ${n} × ${(1 + l.wasteRatio).toFixed(2)} = ${f3(materials.frameM * k)}m = 批量值；蒙面、扎线、胶同理（LED 按颗数 × ${n} 计，不参与损耗）；长度 m 保留 3 位小数，胶 g 保留 1 位小数`
    })
  }

  // ---- CHK-08 性能 ----
  {
    const pass = elapsedMs < 100
    out.push({
      id: 'CHK-08',
      pass,
      value: `${elapsedMs.toFixed(1)}ms`,
      detail: `${l.divisions} 等分 × ${l.layers.length} 层：构件 ${frame.totalQty} 根、裁片 ${panels.totalQty} 块、图纸 ${sheets.length} 页，全流程耗时 ${elapsedMs.toFixed(1)}ms（含分页）；耗时 ms 保留 1 位小数，阈值 100ms`
    })
  }

  return out
}

function loftOverlap(sheets: Sheet[]): number {
  for (const s of sheets) {
    for (const it of s.items) {
      if (it.type === 'strip' && it.overlapMm > 0) return it.overlapMm
    }
  }
  return 0
}

/** 校验尺标称长度（mm）：1:1 打印用 */
export const CALIBRATION_RULER_MM = 100
export const CALIBRATION_CIRCLE_MM = 100

/** 由圆周长反推直径（尺寸反推工具用） */
export function diameterFromPerimeter(lengthMm: number, n: number, polygon: boolean, lashMm: number): number {
  const net = Math.max(0, lengthMm - lashMm)
  if (polygon) {
    const s = Math.max(3, Math.round(n))
    return net / (s * Math.sin(Math.PI / s))
  }
  return net / Math.PI
}

/** 由母线（竖篾）长度反推可用最大直径：保持收口比例与总高，二分求解 */
export function diameterFromRib(l: Lantern, ribLengthMm: number): number {
  const target = Math.max(10, ribLengthMm - 2 * l.lashAllowanceMm)
  let lo = 20
  let hi = 3000
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    const test: Lantern = { ...l, maxDiameterMm: mid, mouthDiameterMm: (mid * l.mouthDiameterMm) / Math.max(1, l.maxDiameterMm), baseDiameterMm: (mid * l.baseDiameterMm) / Math.max(1, l.maxDiameterMm) }
    const segs = segmentInfos(buildFrame(test).geometry)
    const len = segs.reduce((a, s) => a + s.slantMm, 0)
    if (len < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
