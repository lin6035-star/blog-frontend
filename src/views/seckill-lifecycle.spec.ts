// @vitest-environment node
// 本文件只读源码文本做断言，不需要 DOM；跑在 jsdom 下会让 node:fs 被 externalize 而收集失败
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const seckillView = readFileSync(resolve(__dirname, 'SeckillView.vue'), 'utf8')

function bodyOf(from: string, to: string) {
  const start = seckillView.indexOf(from)
  expect(start, `找不到 ${from}`).toBeGreaterThan(-1)
  return seckillView.slice(start, seckillView.indexOf(to, start))
}

describe('seckill activity lifecycle display', () => {
  it('never lets the local clock unlock "started"', () => {
    // 本地时钟只允许把状态推向「更不可抢」（过了 endAt → 已结束），方向是保守的。
    // startAt 一旦参与判断，就会造出「前端说能抢、后端说没开始」的窗口——
    // 后端的状态由定时任务翻转，最长晚 5 秒
    const phaseBody = bodyOf('function activityPhase(', 'function buttonLabel(')

    expect(phaseBody).toContain("activity.status === 'ENDED' || activity.remainingStock <= 0")
    expect(phaseBody).toContain("if (activity.status === 'DRAFT')")
    expect(phaseBody).toContain('new Date(activity.endAt)')
    expect(phaseBody).not.toContain('startAt')
  })

  it('keeps personal results above the activity phase in buttonLabel', () => {
    // 已经到账、正在入账的人，不该因为活动结束而看到「已结束」
    const labelBody = bodyOf('function buttonLabel(', 'function isBusy(')

    const granted = labelBody.indexOf("case 'GRANTED'")
    const phase = labelBody.indexOf('activityPhase(activity)')
    expect(granted).toBeGreaterThan(-1)
    expect(phase).toBeGreaterThan(granted)
    expect(labelBody).toContain("return '未开始'")
    expect(labelBody).toContain("'已结束'")
  })

  it('disables the button for non-active phases instead of letting the backend reject', () => {
    // 原先是「看着能点、点了才被后端拒」，DRAFT 活动尤其明显
    expect(seckillView).toContain("activityPhase(activity) !== 'active'")
  })

  it('refreshes at the time boundaries instead of judging them locally', () => {
    expect(seckillView).toContain('function scheduleRefresh()')
    // startAt 已过但后端还没翻转时用短节奏重试，吃掉任务那 0~5 秒的延迟
    expect(seckillView).toContain('STALE_DRAFT_RETRY_MS')
    expect(seckillView).toContain('refreshTimer = setTimeout(loadActivities')
    expect(seckillView).toContain('clearTimeout(refreshTimer)')
  })

  it('keeps refreshing even when the list has nothing to schedule from', () => {
    // 没有这一兜，列表空 ⇒ 排不出边界 ⇒ 永远不再拉取，页面就此冻死：
    // 用户挂着等开场，什么都不会发生
    expect(seckillView).toContain('IDLE_REFRESH_MS')
    expect(seckillView).toContain('refreshTimer = setTimeout(loadActivities, IDLE_REFRESH_MS)')
  })
})
