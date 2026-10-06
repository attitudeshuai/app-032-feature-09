/* 冒烟测试：对应关系挂载 / CHK-05 等分建议 / 结论版本号 / 旧存档迁移 */
import { computeAll } from '../src/core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../src/core/paginate'
import { checksDigest, checksTouchedBy, paramLinksFor } from '../src/core/check-map'
import { createFromPreset, state, loadStore } from '../src/core/store'

let failures = 0
function ok(cond: boolean, msg: string) {
  if (cond) console.log('  PASS', msg)
  else {
    failures++
    console.log('  FAIL', msg)
  }
}

// ---- 1. 每条结论都带同一套对应关系 ----
console.log('1. 结论 → 参数 对应关系')
const hex = createFromPreset('hex-palace')
const full = computeAll(hex, { ...DEFAULT_LOFT_OPTIONS, paper: 'A4', overlapMm: 10 })
ok(full.checks.length === 8, '8 条结论')
ok(full.checks.every((c) => Array.isArray(c.params)), '每条结论都有 params 数组')
ok(full.checks.find((c) => c.id === 'CHK-01')!.params.length === 0, 'CHK-01 与参数无关（空列表）')
const chk04 = full.checks.find((c) => c.id === 'CHK-04')!
ok(chk04.params[0].param === 'lashAllowanceMm' && chk04.params[0].weight === 5, 'CHK-04 首参数=绑扎余量 影响5')
ok(chk04.params.every((p, i, a) => i === 0 || a[i - 1].weight >= p.weight), '参数按影响从大到小排队')
const touched = checksTouchedBy('lashAllowanceMm').map((x) => x.checkId)
ok(touched.includes('CHK-04'), '反查：绑扎余量 牵动 CHK-04')
ok(paramLinksFor('CHK-05')[0].param === 'divisions', 'CHK-05 首参数=母线等分数')

// ---- 2. CHK-05 分档 + 等分数按整数往上加能落进容差 ----
console.log('2. 面积核对分档与等分建议')
const lotus = createFromPreset('lotus')
lotus.divisions = 6
const bad = computeAll(lotus, { ...DEFAULT_LOFT_OPTIONS, paper: 'A4', overlapMm: 10 })
const c5 = bad.checks.find((c) => c.id === 'CHK-05')!
ok(!c5.pass, `6 等分时 CHK-05 不过（${c5.value}）`)
ok(/分档：/.test(c5.detail) && /(临界档|超差档|严重超差档)/.test(c5.detail), `分档写入 detail：${c5.value}`)
ok(/%/.test(c5.value) && /\d+\.\d{2}%/.test(c5.value), '比值百分数两位小数')
const m = c5.detail.match(/提高到 (\d+)/)
ok(!!m, `给出整数等分建议：${m && m[0]}`)
const divAdvice = c5.params.find((p) => p.param === 'divisions')!
ok(/提高到 \d+/.test(divAdvice.advice), `divisions 参数建议被动态改写：${divAdvice.advice}`)
if (m) {
  lotus.divisions = Number(m[1])
  const fixed = computeAll(lotus, { ...DEFAULT_LOFT_OPTIONS, paper: 'A4', overlapMm: 10 })
  const c5b = fixed.checks.find((c) => c.id === 'CHK-05')!
  ok(c5b.pass, `按建议改为 ${m[1]} 等分后 CHK-05 转通过（${c5b.value}）`)
}

// ---- 3. 结论版本号：参数一改即变 ----
console.log('3. 结论版本号')
const d1 = checksDigest(hex, full.checks)
hex.seamAllowanceMm = 12
const full2 = computeAll(hex, { ...DEFAULT_LOFT_OPTIONS, paper: 'A4', overlapMm: 10 })
const d2 = checksDigest(hex, full2.checks)
ok(d1 !== d2, `缝份 10→12 后版本号变化（${d1} → ${d2}）`)

// ---- 4. 旧存档迁移：缺参数按默认值补上并列出缺项 ----
console.log('4. 旧存档迁移')
const legacy = JSON.parse(JSON.stringify(createFromPreset('oct-palace')))
delete legacy.divisions
delete legacy.seamAllowanceMm
delete legacy.pageSize
delete legacy.overlapMm
delete legacy.ctrl1
;(globalThis as any).localStorage = {
  getItem: () => JSON.stringify({ version: 1, lanterns: [legacy] }),
  setItem: () => {},
  removeItem: () => {}
}
loadStore()
const mig = state.migrations.find((x) => x.id === legacy.id)
ok(!!mig, '迁移记录已列出')
ok(!!mig && mig.filled.some((f) => f.includes('母线等分数')), `缺项含「母线等分数」：${mig?.filled.join('、')}`)
ok(!!mig && mig.filled.some((f) => f.includes('缝份')), '缺项含「缝份」')
ok(state.lanterns[0].divisions === 24, '母线等分数按默认值 24 补上')
ok(!!state.snapshots[legacy.id], '存档里留下自检快照')
ok(state.snapshots[legacy.id]?.checks.length === 8, '快照含 8 条结论')
ok(Array.isArray(state.snapshots[legacy.id]?.checks[0]?.params), '快照结论带同一套参数对应关系')

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
