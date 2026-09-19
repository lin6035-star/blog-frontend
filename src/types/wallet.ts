/**
 * 钱包类型。
 *
 * 关于数字：后端 JacksonConfig 只把「字段名以 id 结尾的 Long」序列化成字符串
 * （雪花 ID 19 位，超出 JS 安全整数范围），其余 Long 一律保持 number。
 * 所以这里的 `id` 是 string，而 `balance` / `amount` 是 number。
 */

/** 钱包余额与进行中的预扣笔数 */
export interface WalletInfo {
  /** 当前余额（credit），**可能为负** */
  balance: number
  /**
   * 进行中的预扣笔数。
   *
   * 负余额有两种完全不同的含义，靠这个字段区分：
   * - `> 0`：额度被临时占用（调用还没结束），**不是欠款**
   * - `== 0`：结算后仍为负，才需要充值
   */
  pendingReserveCount: number
}

/** 充值套餐（来自后端 blog.wallet.packages 配置） */
export interface WalletPackage {
  code: string
  /** 应付金额，单位「分」——不是 credit，别和 `creditAmount` 混 */
  payAmount: number
  /** 到账额度（credit） */
  creditAmount: number
}

export type RechargeOrderStatus = 'PENDING' | 'PAID' | 'CANCELLED'

export interface RechargeOrder {
  orderNo: string
  packageCode: string
  payAmount: number
  creditAmount: number
  status: RechargeOrderStatus
  paidAt?: string | null
  createdAt?: string | null
}

/**
 * 账单条目（**聚合视角**）。
 *
 * 一次 AI 调用只会出现**一条净额**——预扣和退回是记账的实现细节，
 * 不应暴露给用户（用户要看的是「充了多少、花了多少」）。
 */
export interface WalletBillEntry {
  /** 业务主键 */
  bizId: string
  /** RECHARGE_ORDER = 充值到账 / SECKILL_ORDER = 秒杀到账 / AI_BILLING = AI 消费 */
  bizType: string
  /** 净额，有符号：正数入账、负数消费 */
  amount: number
  /** 该笔业务结算后的余额快照 */
  balanceAfter: number
  createdAt?: string | null
}
