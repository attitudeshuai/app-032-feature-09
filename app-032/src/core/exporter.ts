/**
 * 导出：构件清单 / 裁片清单 / 备料单（CSV，本地生成，无外部请求）
 * 三份单子统一带出：对应表版本、参数取值、八条自检结论（与页面/存档同一份说法）。
 */
import type { CheckResult, ExportKind, ExportRecord, FrameMember, Lantern, Panel } from './types'
import type { BatchMaterials, SingleLightMaterials } from './materials'
import { coveringSpec } from './craft'
import {
  CHECK_IDS,
  CHECK_REGISTRY,
  GUIDE_VERSION,
  PARAM_LABELS,
  paramFingerprint,
  paramValueText,
  paramsBrief,
  type ParamKey
} from './guide'

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: (string | number)[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 单子参数口径：各页/存档/单子都必须是这一组取值 */
const PARAM_KEYS_BY_KIND: Record<ExportKind, ParamKey[]> = {
  members: [
    'maxDiameterMm',
    'totalHeightMm',
    'mouthDiameterMm',
    'baseDiameterMm',
    'sides',
    'layers',
    'mouthStyle',
    'bottomStyle',
    'lashAllowanceMm',
    'pageSize'
  ],
  panels: [
    'maxDiameterMm',
    'totalHeightMm',
    'mouthDiameterMm',
    'baseDiameterMm',
    'sides',
    'divisions',
    'layers',
    'mouthStyle',
    'bottomStyle',
    'seamAllowanceMm',
    'covering',
    'pageSize'
  ],
  materials: [
    'maxDiameterMm',
    'totalHeightMm',
    'mouthDiameterMm',
    'baseDiameterMm',
    'sides',
    'divisions',
    'layers',
    'seamAllowanceMm',
    'lashAllowanceMm',
    'covering',
    'batchCount',
    'wasteRatio'
  ],
  'print-loft': ['maxDiameterMm', 'totalHeightMm', 'seamAllowanceMm', 'pageSize', 'overlapMm'],
  'print-frame': ['maxDiameterMm', 'totalHeightMm', 'lashAllowanceMm'],
  'print-labels': ['maxDiameterMm', 'seamAllowanceMm', 'covering']
}

/** 单子页脚的统一口径块：版本 + 参数 + 八条结论（编号、通过否、取值、单位精度） */
export function conclusionBlock(
  l: Lantern,
  kind: ExportKind,
  checks: CheckResult[]
): (string | number)[][] {
  const rows: (string | number)[][] = []
  rows.push([])
  rows.push(['—— 结论与参数对应（同一份说法，页面 / 存档 / 导出共用）——'])
  rows.push(['对应表版本', GUIDE_VERSION, '参数指纹', paramFingerprint(l)])
  rows.push(['参数摘要', paramsBrief(l)])
  for (const k of PARAM_KEYS_BY_KIND[kind]) {
    rows.push([`参数｜${PARAM_LABELS[k]}`, paramValueText(l, k)])
  }
  rows.push([])
  rows.push(['自检编号', '结论', '结果', '取值', '单位与精度口径'])
  for (const id of CHECK_IDS) {
    const c = checks.find((x) => x.id === id)
    if (!c) continue
    rows.push([c.id, CHECK_REGISTRY[id].title, c.pass ? '通过' : '未通过', c.value || '', c.measure])
  }
  rows.push([])
  rows.push([
    `生成 ${new Date().toLocaleString()}；改任一参数后请重出本单——参数指纹不同即说明本单结论/取值已作废。`
  ])
  return rows
}

export const EXPORT_NAMES: Record<ExportKind, string> = {
  members: '构件清单',
  panels: '裁片清单',
  materials: '备料单',
  'print-loft': '1:1 放样图',
  'print-frame': '构件清单（打印件）',
  'print-labels': '裁片标签（打印件）'
}

/** 在本机存档里留一条导出/打印痕（参数一变即据此判单子作废）；同类重出则顶掉老记录 */
export function recordExport(l: Lantern, kind: ExportKind, checks: CheckResult[]) {
  const rec: ExportRecord = {
    kind,
    name: EXPORT_NAMES[kind],
    at: new Date().toISOString(),
    fingerprint: paramFingerprint(l),
    guideVersion: GUIDE_VERSION,
    entries: checks.map((c) => ({ id: c.id, title: c.title, pass: c.pass, value: c.value || '' }))
  }
  if (!Array.isArray(l.exports)) l.exports = []
  l.exports = l.exports.filter((e) => e.kind !== kind)
  l.exports.unshift(rec)
  l.exports = l.exports.slice(0, 12)
}

export function membersCsv(l: Lantern, members: FrameMember[], checks: CheckResult[]): string {
  const rows: (string | number)[][] = [
    [`花灯构件清单 · ${l.name}`],
    [
      `最大直径 ${l.maxDiameterMm}mm / 总高 ${l.totalHeightMm}mm / 绑扎余量 每端 ${l.lashAllowanceMm}mm / 对应表 ${GUIDE_VERSION} / 生成 ${new Date().toLocaleString()}`
    ],
    [],
    ['构件名称', '类别', '分组', '净长(mm)', '截取长度(mm,含余量)', '余量处数', '数量', '总截取长度(mm)', '弯曲半径(mm)', '折角(°)', '备注']
  ]
  for (const m of members) {
    rows.push([
      m.label,
      kindName(m.kind),
      m.group,
      m.rawLengthMm.toFixed(1),
      m.lengthMm.toFixed(1),
      m.lashJoints,
      m.qty,
      (m.lengthMm * m.qty).toFixed(1),
      m.bendRadiusMm ? m.bendRadiusMm.toFixed(1) : '—',
      m.bendAngleDeg ? m.bendAngleDeg.toFixed(1) : '—',
      m.note || ''
    ])
  }
  const stock = members.reduce((s, m) => s + m.lengthMm * m.qty, 0)
  const raw = members.reduce((s, m) => s + m.rawLengthMm * m.qty, 0)
  rows.push([])
  rows.push(['合计', '', '', raw.toFixed(1), '', '', members.reduce((s, m) => s + m.qty, 0), stock.toFixed(1), '', '', `备料 ${(stock / 1000).toFixed(3)}m`])
  rows.push(...conclusionBlock(l, 'members', checks))
  return toCsv(rows)
}

export function panelsCsv(l: Lantern, panels: Panel[], checks: CheckResult[]): string {
  const rows: (string | number)[][] = [
    [`蒙面裁片清单 · ${l.name}`],
    [
      `蒙面 ${coveringSpec(l.covering).name} / 缝份 每边 ${l.seamAllowanceMm}mm（已含在裁片尺寸内）/ 对应表 ${GUIDE_VERSION} / 生成 ${new Date().toLocaleString()}`
    ],
    [],
    ['裁片编号', '名称', '形状', '净上宽(mm)', '净下宽(mm)', '净高(mm)', '裁切上宽(mm)', '裁切下宽(mm)', '裁切高(mm)', '半径/对边(mm)', '数量', '对位标记数']
  ]
  for (const p of panels) {
    rows.push([
      p.id,
      p.label,
      shapeName(p.shape),
      p.rawWidthTopMm.toFixed(1),
      p.rawWidthBottomMm.toFixed(1),
      p.rawHeightMm.toFixed(1),
      p.widthTopMm.toFixed(1),
      p.widthBottomMm.toFixed(1),
      p.heightMm.toFixed(1),
      p.radiusMm ? p.radiusMm.toFixed(1) : '—',
      p.qty,
      p.marksMm.length
    ])
  }
  rows.push(...conclusionBlock(l, 'panels', checks))
  return toCsv(rows)
}

export function materialsCsv(
  l: Lantern,
  single: SingleLightMaterials,
  batch: BatchMaterials,
  checks: CheckResult[]
): string {
  const cov = coveringSpec(l.covering)
  const rows: (string | number)[][] = [
    [`备料单 · ${l.name}`],
    [`对应表 ${GUIDE_VERSION} / 生成 ${new Date().toLocaleString()} / 单位 mm·m²·m·g`],
    [],
    ['项目', '单灯用量', '单位', `批量 ${batch.count} 个（含 ${(batch.wasteRatio * 100).toFixed(0)}% 损耗）`],
    ['竹篾/铁丝（含绑扎余量）', single.frameM.toFixed(3), 'm', batch.frameM.toFixed(3)],
    ['竹篾构件净长', single.frameRawM.toFixed(3), 'm', batch.frameRawM.toFixed(3)],
    [`蒙面（${cov.name}，含缝份）`, single.coveringM2.toFixed(3), 'm²', batch.coveringM2.toFixed(3)],
    ['蒙面净面积（不含缝份）', single.coveringNetM2.toFixed(3), 'm²', batch.coveringNetM2.toFixed(3)],
    ['扎线', single.lashM.toFixed(3), 'm', batch.lashM.toFixed(3)],
    ['胶', single.glueG.toFixed(1), 'g', batch.glueG.toFixed(1)],
    ['LED 灯珠建议', single.ledCount, '颗', batch.ledCount],
    [],
    ['灯体体积', single.volumeL.toFixed(3), 'L', batch.volumeL.toFixed(3)],
    ['灯体表面积', single.surfaceM2.toFixed(3), 'm²', batch.surfaceM2.toFixed(3)]
  ]
  rows.push(...conclusionBlock(l, 'materials', checks))
  return toCsv(rows)
}

export function kindName(k: FrameMember['kind']): string {
  const map: Record<FrameMember['kind'], string> = {
    vertical: '竖篾',
    ring: '横篾',
    mouth_ring: '收口圈',
    base_ring: '底盘圈',
    rib: '母线篾',
    spoke: '辐条/中轴'
  }
  return map[k]
}

export function shapeName(s: Panel['shape']): string {
  const map: Record<Panel['shape'], string> = {
    trapezoid: '梯形',
    rectangle: '矩形',
    sector: '扇形',
    circle: '圆形/正多边形',
    triangle: '三角形'
  }
  return map[s]
}
