/** 花灯放样数据模型（对齐规格书 §7，并补充放样所需的展开参数） */

export type LanternKind = 'prism' | 'revolution' | 'polyhedron' | 'box'
export type MouthStyle = 'flat' | 'taper' | 'gourd'
export type Covering = 'xuan' | 'silk' | 'parchment'
export type PageSize = 'A4' | 'A3'
export type PanelShape = 'trapezoid' | 'rectangle' | 'sector' | 'circle' | 'triangle'
export type MemberKind = 'vertical' | 'ring' | 'mouth_ring' | 'base_ring' | 'rib' | 'spoke'

export interface Point2 {
  x: number
  y: number
}

/** 分段（层）：高度为准，直径为轮廓派生结果 */
export interface LayerSpec {
  heightMm: number
  diameterMm: number
}

export interface Lantern {
  id: string
  kind: LanternKind
  name: string
  /** 最大直径（灯体最粗处） */
  maxDiameterMm: number
  /** 总高（= 各分段高度之和） */
  totalHeightMm: number
  /** 收口直径（上口） */
  mouthDiameterMm: number
  /** 底口直径（下口） */
  baseDiameterMm: number
  /** 棱数（prism/box）；旋转体时作为竖篾（母线篾）根数 */
  sides: number
  /** 分段高度与直径 */
  layers: LayerSpec[]
  /** 上收口方式 */
  mouthStyle: MouthStyle
  /** 下收口方式 */
  bottomStyle: MouthStyle
  /** 收口曲线强度 0~1 */
  smoothness: number
  /** 葫芦/花瓶形贝塞尔控制点（归一化：x 为半径插值比例，y 为肩部区间比例） */
  ctrl1: Point2
  ctrl2: Point2
  /** 旋转体母线等分数（默认 24，可调） */
  divisions: number
  /** 蒙面类型 */
  covering: Covering
  /** 缝份（mm，四边各加） */
  seamAllowanceMm: number
  /** 绑扎余量（mm，每端） */
  lashAllowanceMm: number
  /** 每层配色（长度 = layers.length，可短于层数则回落到主色） */
  layerColors: string[]
  /** 主色 */
  color: string
  /** 批量制灯数量 */
  batchCount: number
  /** 损耗率 0~0.2 */
  wasteRatio: number
  /** 1:1 打印纸张 */
  pageSize: PageSize
  /** 长条图跨页搭接量（mm） */
  overlapMm: number
  /** 结论↔参数对应表版本（如 'G2'；与存档时不一致则存档结论/导出单子整份作废） */
  guideVersion?: string
  /** 最近一次本机存档时的自检结论快照（用于指出存档里留的是不是老结论） */
  checksSnapshot?: CheckSnapshot
  /** 旧存档迁移时按默认值补入的参数（人类可读名称列表，要列给用户看） */
  migrationNotes?: string[]
  /** 已导出/已打印单子的留痕（参数一变即按指纹判定是否作废） */
  exports?: ExportRecord[]
  createdAt: string
  updatedAt: string
}

/** 导出单子种类：三份 CSV + 三种打印件 */
export type ExportKind = 'members' | 'panels' | 'materials' | 'print-loft' | 'print-frame' | 'print-labels'

/** 一次导出/打印的留痕 */
export interface ExportRecord {
  kind: ExportKind
  /** 文件名或单子名称 */
  name: string
  at: string
  /** 导出时的参数指纹 */
  fingerprint: string
  /** 导出时采用的对应表版本 */
  guideVersion: string
  /** 导出时各结论的通过情况（便于点明是哪一条的老结论） */
  entries: CheckSnapshotEntry[]
}

/** 存档时留下的单条结论 */
export interface CheckSnapshotEntry {
  id: string
  title: string
  pass: boolean
  value: string
}

/** 本机存档里留下的那一份自检结论 */
export interface CheckSnapshot {
  at: string
  guideVersion: string
  fingerprint: string
  entries: CheckSnapshotEntry[]
}

export interface FrameMember {
  id: string
  kind: MemberKind
  /** 名称，如「竖篾」「第 3 层横篾」「收口圈」 */
  label: string
  /** 截取长度（已含绑扎余量） */
  lengthMm: number
  /** 净长（不含余量） */
  rawLengthMm: number
  /** 建议弯曲半径（圆形圈 / 收口段） */
  bendRadiusMm?: number
  /** 折角（多边形圈的转角，度） */
  bendAngleDeg?: number
  /** 数量 */
  qty: number
  /** 分组：所属层或类别 */
  group: string
  /** 每根含几处绑扎余量 */
  lashJoints: number
  note?: string
}

export interface PanelMark {
  x: number
  y: number
  label: string
}

export interface Panel {
  id: string
  label: string
  shape: PanelShape
  /** 裁片下宽（已含缝份） */
  widthBottomMm: number
  /** 裁片上宽（已含缝份） */
  widthTopMm: number
  /** 裁片高（已含缝份） */
  heightMm: number
  seamAllowanceMm: number
  marksMm: PanelMark[]
  qty: number
  /** 展开净尺寸（不含缝份） */
  rawWidthTopMm: number
  rawWidthBottomMm: number
  rawHeightMm: number
  /** 圆形/正多边形裁片半径（净，不含缝份） */
  radiusMm?: number
  /** 正多边形边数（顶/底盖为多边形时） */
  polySides?: number
  /** 对应灯体层的索引（-1 表示顶/底盖） */
  layerIndex: number
  color: string
  note?: string
}

export interface MaterialTally {
  /** 备料竹篾/铁丝总长（m，含绑扎余量与损耗） */
  frameM: number
  /** 蒙面面积（m²，含缝份与损耗） */
  coveringM2: number
  /** 损耗率 */
  wasteRatio: number
  /** 扎线（m） */
  lashM: number
  /** 胶（g） */
  glueG: number
  /** LED 灯珠建议数量 */
  ledCount?: number
}

/** 参数身份：结论↔参数对应关系（G2：全参排队，一个不漏）的最小单位 */
export type ParamKey =
  | 'maxDiameterMm'
  | 'totalHeightMm'
  | 'mouthDiameterMm'
  | 'baseDiameterMm'
  | 'sides'
  | 'divisions'
  | 'layers'
  | 'mouthStyle'
  | 'bottomStyle'
  | 'smoothness'
  | 'ctrl1'
  | 'ctrl2'
  | 'seamAllowanceMm'
  | 'lashAllowanceMm'
  | 'covering'
  | 'batchCount'
  | 'wasteRatio'
  | 'pageSize'
  | 'overlapMm'

/** 一条参数调整建议（按影响大小排队） */
export interface ParamHint {
  param: ParamKey
  /** 参数在界面上的统一叫法（参数与预览页标出时用同一个说法） */
  label: string
  /** 影响等级：动它把本结论转成通过的可能性 */
  impact: 'high' | 'medium' | 'low'
  /** 具体怎么动（方向/步长/落点），面积核对等结论给出整数目标值 */
  advice: string
  /** 建议落点值（整数/一位小数的目标值，给出就允许界面“一键应用”） */
  suggestValue?: number
  /** 动这一处会牵动（重算后可能翻转的）别的结论，一个不漏 */
  affects: string[]
}

/** 一条结论的原始核对结果（装饰 G2 对应表之前） */
export interface RawCheck {
  id: string
  pass: boolean
  detail: string
  value?: string
}

/** 构件与裁片的自检结果（对应规格书 §10） */
export interface CheckResult extends RawCheck {
  title: string
  /** 对应表版本：同一条结论在所有页面/导出/存档必须取同一个说法 */
  guideVersion: string
  /** 相关参数（按影响大小排队，一个不漏）；通过后界面不再展示调整建议 */
  paramHints: ParamHint[]
  /** 本结论归属的页面口径（骨架页/裁片页/放样页各自过滤显示，仍是同一条结论；空数组=只在全量页） */
  scopes: ('frame' | 'panels' | 'print')[]
  /** 核对所用的单位与精度口径（人类可读，导出单子一并带出） */
  measure: string
}
