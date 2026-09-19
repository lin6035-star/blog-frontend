import request from '@/utils/request'

/** 站点活跃统计（后端基于 Bitmap 位图，见 UserActivityTracker） */
export interface ActivityStats {
  todayActive: number
  yesterdayActive: number
  /** 近 7 天活跃人数，**已去重**（不是 7 天相加） */
  weekActive: number
  retainedFromYesterday: number
  /** 昨日留存率；后端在"昨日无人活跃"时返回 null —— 是"算不出来"，不是 0% */
  yesterdayRetentionRate: number | null
}

export const statsApi = {
  getActivity() {
    return request.get<ActivityStats>('/stats/activity')
  },
}
