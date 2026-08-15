import request from '@/utils/request'

/** 学习计划（Workflow 生成，用户长期拥有） */
export interface LearningPlan {
  id: string
  userId: string
  title: string
  goal?: string
  status: 'ACTIVE' | 'COMPLETED' | 'ARCHIVED'
  sourceWorkflowRunId?: string
  createdAt: string
  updatedAt: string
}

export interface LearningTask {
  title: string
  done: boolean
}

export interface LearningStageProgress {
  id: string
  orderNum: number
  title: string
  tasks: LearningTask[]
}

export interface LearningPlanDetail {
  plan: LearningPlan
  stages: LearningStageProgress[]
  doneTasks: number
  totalTasks: number
}

export const learningPlanApi = {
  /** 我的学习计划列表 */
  listMine() {
    return request.get<LearningPlan[]>('/learning-plans')
  },

  /** 计划详情（含阶段/任务/聚合进度） */
  detail(id: string) {
    return request.get<LearningPlanDetail>(`/learning-plans/${id}`)
  },
}
