import request from '@/utils/request'
import type { PageData } from '@/types/result'
import type {
  RechargeOrder,
  WalletBillEntry,
  WalletCustomConfig,
  WalletInfo,
  WalletPackage,
} from '@/types/wallet'

/** 钱包接口（全部需要登录，路径不带 /api，由 request 的 baseURL 补） */
export const walletApi = {
  /** 当前余额 + 进行中的预扣笔数 */
  getWallet() {
    return request.get<WalletInfo>('/wallet')
  },

  /**
   * 账单（聚合视角）。
   *
   * 后端已按业务聚合：一次 AI 调用只有一条净额，不会出现「扣了 400 又退 365」的中间态。
   */
  getBill(page = 1, pageSize = 10) {
    return request.get<PageData<WalletBillEntry>>('/wallet/bill', {
      params: { page, pageSize },
    })
  },

  /** 充值套餐列表 */
  getPackages() {
    return request.get<WalletPackage[]>('/wallet/packages')
  },

  /**
   * 下单。
   *
   * ⚠️ 只传 packageCode：应付金额与到账额度都由后端按套餐决定。
   * 前端传金额等于自助发钱，接口层就不接受。
   */
  createRechargeOrder(packageCode: string) {
    return request.post<RechargeOrder>('/wallet/recharge/orders', { packageCode })
  },

  /** 自定义充值的上下限与兑换比例（只读配置，用来渲染输入提示） */
  getCustomConfig() {
    return request.get<WalletCustomConfig>('/wallet/recharge/custom-config')
  },

  /**
   * 自定义金额下单。
   *
   * ⚠️ 传的是**元**（整数），字段名 `payYuan` 而不是 `payAmount`：
   * 项目里 `payAmount` 一律是**分**，传错单位会让 5 元变成 5 分。
   * 到账额度仍由后端按配置算——前端只决定「充多少钱」。
   */
  createCustomRechargeOrder(payYuan: number) {
    return request.post<RechargeOrder>('/wallet/recharge/orders/custom', { payYuan })
  },

  /**
   * 支付（虚拟支付）。
   *
   * 服务端幂等由「订单号 + 状态 CAS」保证，重复调用只会加一次额度——
   * 所以这里不需要 Idempotency-Key，也不需要前端做去重。
   */
  payRechargeOrder(orderNo: string) {
    return request.post<RechargeOrder>(`/wallet/recharge/orders/${orderNo}/pay`)
  },
}
