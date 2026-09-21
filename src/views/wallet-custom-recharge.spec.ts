// @vitest-environment node
// 本文件只读源码文本做断言，不需要 DOM；跑在 jsdom 下会让 node:fs 被 externalize 而收集失败
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const walletView = readFileSync(resolve(__dirname, 'WalletView.vue'), 'utf8')
const walletApi = readFileSync(resolve(__dirname, '../api/wallet.ts'), 'utf8')

describe('custom recharge', () => {
  it('sends payYuan and never payAmount', () => {
    // 字段名是唯一能看出单位的地方：这个项目里 payAmount 一律是「分」，
    // 写成 { payAmount: 5 } 会让用户想充 5 元、实际充了 5 分
    expect(walletApi).toContain('createCustomRechargeOrder(payYuan: number)')
    expect(walletApi).toContain(
      "request.post<RechargeOrder>('/wallet/recharge/orders/custom', { payYuan })",
    )
  })

  it('declares the amount as nullable because n-input-number clears to null', () => {
    // null 和 0 必须分开：用 !customYuan 之类的假值判断会把「没填」当成「填了 0」
    expect(walletView).toContain('ref<number | null>(null)')
    expect(walletView).toContain('yuan === null')
  })

  it('never formats the yuan amount with the fen-based formatter', () => {
    // formatPayAmount 吃「分」：formatPayAmount(5) 显示成 ¥0.05。
    // 而 5 元和 5 分看起来都"对"，要等付完钱才会有人发现——所以这里用源码断言钉死
    expect(walletView).not.toContain('formatPayAmount(customYuan')
    expect(walletView).not.toContain('formatPayAmount(yuan')
    expect(walletView).not.toContain('formatPayAmount(customCredit')
    // 确认框直接用原值，不做任何换算
    expect(walletView).toContain('确认支付 ¥${yuan}')
  })

  it('reuses the shared pay endpoint instead of a custom payment path', () => {
    // 单开一条「自定义支付」会绕掉订单状态 CAS——幂等只剩流水唯一索引一层防线，
    // 而那个 bug 只在并发双击时才现形
    expect(walletView).toContain('walletApi.payRechargeOrder(order.data.orderNo)')
    expect(walletApi).not.toContain('payCustomRechargeOrder')
  })

  it('loads the custom config outside the main Promise.all', () => {
    // 塞进 Promise.all 的话，「自定义充值配置没取到」会升级成「钱包页整个打不开」——
    // 滚动发布窗口期用户会连余额都看不见。失败时只把入口藏起来，套餐照常
    expect(walletView).toContain('walletApi.getCustomConfig()')
    expect(walletView).toContain('customEnabled.value = false')
  })

  it('guards both entry points before opening the confirm dialog', () => {
    // paying 只在 onPositiveClick 里置位，不在开框前拦的话，
    // 第一个确认框还没点确认时再点另一个入口会叠开两个框 → 两张订单、两次到账。
    // 订单 CAS 防不了这个，它只能防「同一张订单付两次」
    const guards = walletView.match(/if \(paying\.value\) \{\s*return\s*\}/g) ?? []
    expect(guards.length).toBeGreaterThanOrEqual(2)
  })
})
