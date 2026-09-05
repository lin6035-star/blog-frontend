<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Add,
  ArrowBack,
  Attach,
  BookmarkOutline,
  Close,
  Contract,
  Expand,
  Send,
  Time,
  TrashOutline,
  CopyOutline,
  CheckmarkOutline,
  RefreshOutline,
  StopCircleOutline,
} from '@vicons/ionicons5'
import { useDialog, useMessage } from 'naive-ui'
import { aiApi } from '@/api/ai'
import type {
  AiMessage,
  AiSession,
  AiConversationSummaryStatus,
  PageContext,
  EditorAction,
  ArticleAction,
  ArticleRagReference,
  AiMemoryCandidate,
  AiMemory,
  AiWorkflowRun,
  AiWorkflowStepLog,
  WorkflowStatus,
  WorkflowStepEvent,
  WorkflowContentDeltaEvent,
  WorkflowStreamResult,
  AgentStepView,
  AgentStepEvent,
  AgentStepHistoryItem,
  AgentWriteProposal,
  WorkflowType,
} from '@/api/ai'
import { emitAiEditorAction } from '@/utils/aiEditorBus'
import { emitAiArticleAction } from '@/utils/aiArticleActionBus'
import { renderMarkdown } from '@/utils/markdown'

import { useAuthStore } from '@/stores/auth'

// ============================================================
// Auth & guest
// ============================================================

const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()

const userAvatar = computed(() => authStore.usersVO?.avatarUrl ?? null)
const isGuest = computed(() => !authStore.isLoggedIn)

// 游客已使用次数（响应式，用于欢迎页判断）
const guestUsedCount = ref(0)

// ============================================================
// 游客 sessionStorage
// ============================================================

const GUEST_AI_MESSAGES_KEY = 'blog_ai_guest_messages'
const GUEST_AI_USED_COUNT_KEY = 'blog_ai_guest_used_count'
const GUEST_MAX = 3

function loadGuestMessages(): AiMessage[] {
  try {
    const raw = sessionStorage.getItem(GUEST_AI_MESSAGES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveGuestMessages(msgs: AiMessage[]) {
  sessionStorage.setItem(GUEST_AI_MESSAGES_KEY, JSON.stringify(msgs))
}

function loadGuestUsedCount(): number {
  const raw = sessionStorage.getItem(GUEST_AI_USED_COUNT_KEY)
  return raw ? Number(raw) : 0
}

function saveGuestUsedCount(count: number) {
  sessionStorage.setItem(GUEST_AI_USED_COUNT_KEY, String(count))
}

function clearGuestData() {
  sessionStorage.removeItem(GUEST_AI_MESSAGES_KEY)
  sessionStorage.removeItem(GUEST_AI_USED_COUNT_KEY)
}

// ============================================================
// Page context
// ============================================================

function buildPageContext(): PageContext {
  const name = String(route.name ?? '')
  const path = route.path
  const pageContext: PageContext = { pageType: name, path }

  if (name === 'article-detail') {
    pageContext.articleId = String(route.params.id ?? '')
    // 从 document.title 提取文章标题
    const t = document.title.replace(/\s*-\s*海林Blog$/, '')
    if (t && t !== '文章详情') pageContext.articleTitle = t
  }
  if (name === 'public-profile') {
    pageContext.userId = String(route.params.id ?? '')
  }
  if (name === 'profile') {
    const myId = authStore.usersVO?.id
    if (myId) pageContext.userId = String(myId)
  }

  return pageContext
}

// ============================================================
// State
// ============================================================

const visible = ref(false)
const isFullscreen = ref(false)
const viewingHistory = ref(false)
const sending = ref(false)
const loadingMessages = ref(false)
const input = ref('')
const messageListRef = ref<HTMLElement | null>(null)
// 滚动跟随状态：用户手动上滑后停止自动滚动，滑到底部后恢复
const shouldAutoScroll = ref(true)
const AUTO_SCROLL_THRESHOLD = 48

const sessions = ref<AiSession[]>([])
const currentSessionId = ref<string | null>(null)
const messages = ref<AiMessage[]>([])

// ============================================================
// 会话压缩提示：compressing=正在压缩 done=已完成（两行提示）
// ============================================================

type CompressionPhase = 'idle' | 'compressing' | 'done'
const compressionPhase = ref<CompressionPhase>('idle')
const compressionCoveredMessageCount = ref(0)
// 上次已知的压缩完成时间：轮询发现 lastCompressedAt 变化即判断"本次压缩已完成"
let compressionBaseline: string | null = null

function resetCompressionHint() {
  compressionPhase.value = 'idle'
  compressionCoveredMessageCount.value = 0
  compressionBaseline = null
}

function showCompressionDone(lastCompressedAt: string, coveredMessageCount?: number) {
  compressionBaseline = lastCompressedAt
  if (typeof coveredMessageCount === 'number') {
    compressionCoveredMessageCount.value = coveredMessageCount
  }
  compressionPhase.value = 'done'
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 压缩轮询序号：连续回复时旧轮询让位，避免旧状态覆盖新状态
let compressionCheckSeq = 0

// 回复结束后轮询压缩状态：
// 后端压缩是异步的（LLM 调用 + 线程池排队，可能延迟数秒才启动），
// 所以只要"上次压缩时间没变"就持续轮询（最多约 40s）：
// compressing=true 显示"正在自动压缩上下文"，lastCompressedAt 变化显示"已自动压缩上下文"
async function checkCompressionAfterReply(sessionId: string) {
  if (isGuest.value || !sessionId) return
  const seq = ++compressionCheckSeq
  const baseline = compressionBaseline

  // 延迟启动给异步压缩线程留启动窗口
  await sleep(800)

  for (let i = 0; i < 20; i++) {
    if (seq !== compressionCheckSeq) return // 已发起新的检查，让位

    let status: AiConversationSummaryStatus | null = null
    try {
      status = (await aiApi.getSummaryStatus(sessionId)).data
    } catch {
      console.warn('查询会话压缩状态失败', sessionId)
      return
    }
    if (!status) return

    if (status.lastCompressedAt && status.lastCompressedAt !== baseline) {
      // 压缩已完成（无论是否抓到"压缩中"阶段）
      showCompressionDone(status.lastCompressedAt, status.coveredMessageCount)
      return
    }
    if (status.compressing) {
      compressionCoveredMessageCount.value = status.coveredMessageCount
      compressionPhase.value = 'compressing'
    }
    await sleep(2000)
  }
  // 超时后保持最后一次可见状态，不自动消失
}

async function syncCompressionHint(sessionId: string) {
  if (isGuest.value || !sessionId) return

  try {
    const status = (await aiApi.getSummaryStatus(sessionId)).data
    if (!status) {
      resetCompressionHint()
      return
    }

    if (status.compressing) {
      compressionBaseline = status.lastCompressedAt
      compressionCoveredMessageCount.value = status.coveredMessageCount
      compressionPhase.value = 'compressing'
      return
    }

    if (status.lastCompressedAt) {
      showCompressionDone(status.lastCompressedAt, status.coveredMessageCount)
      return
    }

    resetCompressionHint()
  } catch {
    // 查询失败时保留当前状态，不强行清空
  }
}

// 用于取消正在进行的流式请求
let abortController: AbortController | null = null

// ============================================================
// Workflow 状态
// ============================================================

const activeWorkflow = ref<AiWorkflowRun | null>(null)
const workflowBusy = ref(false)
const workflowRejectEditing = ref(false)
const workflowFeedback = ref('')

// Workflow 步骤执行日志：按 workflowId 缓存 + 展开态 + 加载态
const workflowStepLogs = ref<Record<string, AiWorkflowStepLog[]>>({})
const workflowStepLogsExpanded = ref<Record<string, boolean>>({})
const workflowStepLogsLoading = ref<Record<string, boolean>>({})

// Workflow 操作幂等 Key：同一 workflow 同一步操作复用同一 Key，
// 网络失败重试不重复执行（后端按 Key 返回上次结果）；成功/业务失败后清除
const WORKFLOW_ACTION_KEY_PREFIX = 'ai_workflow_action_key:'

type PendingWorkflowAction = {
  workflowId: string
  action: 'APPROVE' | 'REJECT' | 'RETRY' | 'CONFIRM_SUGGEST'
  payload: string
  key: string
}

function createWorkflowIdempotencyKey(): string {
  if (
    typeof crypto !== 'undefined'
    && typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function workflowActionStorageKey(
  workflowId: string,
  action: string,
): string {
  return `${WORKFLOW_ACTION_KEY_PREFIX}${workflowId}:${action}`
}

function getWorkflowActionKey(
  workflowId: string,
  action: PendingWorkflowAction['action'],
  payload = '',
): string {
  const storageKey =
    workflowActionStorageKey(workflowId, action)

  try {
    const raw = sessionStorage.getItem(storageKey)

    if (raw) {
      const pending =
        JSON.parse(raw) as PendingWorkflowAction

      if (
        pending.workflowId === workflowId
        && pending.action === action
        && pending.payload === payload
        && pending.key
      ) {
        return pending.key
      }
    }
  } catch {
    // sessionStorage 或 JSON 异常时重新生成
  }

  const pending: PendingWorkflowAction = {
    workflowId,
    action,
    payload,
    key: createWorkflowIdempotencyKey(),
  }

  try {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify(pending),
    )
  } catch {
    // 存储失败时仍使用当前内存 Key
  }

  return pending.key
}

function clearWorkflowActionKey(
  workflowId: string,
  action: PendingWorkflowAction['action'],
): void {
  try {
    sessionStorage.removeItem(
      workflowActionStorageKey(workflowId, action),
    )
  } catch {
    // ignore storage errors
  }
}

// V2.3：Agent 思考面板展开状态（全局：同一时刻通常只有一条 AI 消息在思考）
const thinkingStepsExpanded = ref(false)

// Workflow 流式正文：生成草稿时按 workflowId 累积 delta
const workflowStreamingContent = ref<Record<string, string>>({})
// Workflow 流式大纲：重写大纲时按 workflowId 累积 delta
const workflowStreamingOutline = ref<Record<string, string>>({})

// 本地过渡态：点击按钮后立刻切换面板，解决"卡住"体感
type LocalTransition = 'APPROVING' | 'REJECTING' | 'RETRYING' | 'CANCELLING'
const localTransition = ref<LocalTransition | null>(null)

const isTransitioning = computed(() => localTransition.value !== null)

const transitionLabel = computed(() => {
  const t = localTransition.value
  const status = activeWorkflow.value?.status
  if (t === 'APPROVING') {
    if (status === 'WAITING_OUTLINE_CONFIRM') return '正在根据大纲生成草稿...'
    if (status === 'WAITING_DRAFT_CONFIRM') return '正在校验草稿质量...'
    if (status === 'WAITING_FILL_CONFIRM') return '正在填充到编辑器...'
    return 'AI 正在处理...'
  }
  if (t === 'REJECTING') {
    if (status === 'WAITING_OUTLINE_CONFIRM') return '正在根据意见重新生成大纲...'
    if (status === 'WAITING_DRAFT_CONFIRM') return '正在根据修改意见重写草稿...'
    if (status === 'WAITING_REQUIREMENT_CONFIRM') return '正在分析补充需求...'
    return 'AI 正在处理...'
  }
  if (t === 'RETRYING') return '正在重试失败步骤...'
  if (t === 'CANCELLING') return '正在取消工作流...'
  return ''
})

// 确认卡片：后端停在等待确认态时写入，前端按 type 渲染对应面板
const workflowConfirmation = computed(() => {
  return activeWorkflow.value?.context?.confirmation ?? null
})

const workflowWaitingConfirm = computed(() => {
  const confirmation = workflowConfirmation.value
  if (confirmation === null || confirmation.type === 'REQUIREMENT') return false
  // 只在等待确认态显示确认面板：确认被消费后卡片可能残留（存量 run），
  // WAITING_USER_SAVE 应显示"已保存/发布"面板而不是"同意"按钮
  const status = activeWorkflow.value?.status
  return (
    status === 'WAITING_OUTLINE_CONFIRM' ||
    status === 'WAITING_DRAFT_CONFIRM' ||
    status === 'WAITING_PLAN_CONFIRM' ||
    status === 'WAITING_LEARNING_PLAN_CONFIRM' ||
    status === 'WAITING_FILL_CONFIRM'
  )
})

const workflowNeedRequirement = computed(() => {
  return (
    workflowConfirmation.value?.type === 'REQUIREMENT' &&
    activeWorkflow.value?.status === 'WAITING_REQUIREMENT_CONFIRM'
  )
})

const workflowFailed = computed(() => {
  return activeWorkflow.value?.status === 'FAILED'
})

const workflowQualityCheck = computed(() => {
  const ctx = activeWorkflow.value?.context
  // contentCheck=优化稿检查 / qualityCheck=创作草稿检查；顶层兜底兼容历史 run 数据位置
  return ctx?.stepResults?.contentCheck ?? ctx?.stepResults?.qualityCheck ?? ctx?.qualityCheck ?? null
})

//学习规划 Workflow 生成的结构化计划（确认面板渲染用）
const workflowLearningPlan = computed(() => {
  return activeWorkflow.value?.context?.stepResults?.plan ?? null
})

const workflowHasBlockingIssues = computed(() => {
  const check = workflowQualityCheck.value
  if (!check) return false
  return check.passed === false || (check.issues?.length ?? 0) > 0
})

// 草稿被打回：确认卡片为 DRAFT + 存在阻塞问题 → 直接展开修改意见输入框（重写模式）
const workflowDraftNeedsFix = computed(() => {
  return (
    workflowConfirmation.value?.type === 'DRAFT' &&
    workflowHasBlockingIssues.value
  )
})

function workflowStatusLabel(status?: WorkflowStatus) {
  if (status === 'WAITING_REQUIREMENT_CONFIRM') return '等待补充需求'
  if (status === 'WAITING_OUTLINE_CONFIRM') return '等待确认大纲'
  if (status === 'WAITING_PLAN_CONFIRM') return '等待确认优化方案'
  if (status === 'WAITING_LEARNING_PLAN_CONFIRM') return '等待确认学习计划'
  if (status === 'WAITING_DRAFT_CONFIRM') return '等待确认草稿'
  if (status === 'WAITING_FILL_CONFIRM') return '等待填充编辑器'
  if (status === 'WAITING_USER_SAVE') return '已填充编辑器，等待保存/发布'
  if (status === 'PAUSED') return '已暂停'
  if (status === 'FAILED') return '执行失败'
  if (status === 'COMPLETED') return '已完成'
  if (status === 'CANCELLED') return '已取消'
  return 'Workflow'
}

function workflowStepLabel(step?: string) {
  if (step === 'REQUIREMENT_ANALYZE') return '需求分析'
  if (step === 'MEMORY_RETRIEVE') return '记忆召回'
  if (step === 'RAG_SEARCH') return '知识库检索'
  if (step === 'GENERATE_OUTLINE') return '生成大纲'
  if (step === 'GENERATE_DRAFT') return '生成草稿'
  if (step === 'QUALITY_CHECK') return '质量检查'
  if (step === 'FILL_ARTICLE') return '填充编辑器'
  if (step === 'LOAD_ARTICLE') return '加载文章'
  if (step === 'ANALYZE_ARTICLE') return '分析文章'
  if (step === 'GENERATE_OPTIMIZATION_PLAN') return '生成优化方案'
  if (step === 'REWRITE_ARTICLE') return '重写文章'
  if (step === 'CONTENT_CHECK') return '内容检查'
  if (step === 'ANALYZE_GOAL') return '分析学习目标'
  if (step === 'GENERATE_PLAN') return '生成结构化学习计划'
  if (step === 'SAVE_PLAN') return '保存学习计划'
  if (step === 'LOAD_PLAN') return '加载学习计划'
  if (step === 'ANALYZE_CHANGE') return '分析调整诉求'
  if (step === 'LOCATE_STAGE') return '定位难点阶段'
  if (step === 'GENERATE_TASKS') return '拆解任务点'
  if (step === 'APPEND_TASKS') return '追加任务点'
  // stream 占位日志兜底：后端没推断出 step 时显示 action
  if (step === 'APPROVE') return '确认推进'
  if (step === 'REJECT') return '按反馈重新生成'
  if (step === 'RETRY') return '重试失败步骤'
  return step || '未知'
}

function workflowStepStatusLabel(status?: string) {
  if (status === 'RUNNING') return '执行中'
  if (status === 'SUCCESS') return '成功'
  if (status === 'FAILED') return '失败'
  if (status === 'SKIPPED') return '跳过'
  return status || '未知'
}

function workflowStepStatusClass(status?: string) {
  if (status === 'SUCCESS') return 'ai-workflow-step-log__status--success'
  if (status === 'FAILED') return 'ai-workflow-step-log__status--failed'
  if (status === 'RUNNING') return 'ai-workflow-step-log__status--running'
  if (status === 'SKIPPED') return 'ai-workflow-step-log__status--skipped'
  return ''
}

function formatDuration(ms?: number) {
  if (ms === undefined || ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatWorkflowQualityCheck(check?: {
  passed?: boolean
  issues?: string[]
  suggestions?: string[]
}) {
  // passed 为空时表示质量检查尚未执行（如大纲确认阶段），不展示
  if (!check || check.passed === undefined) return ''

  const lines: string[] = []
  lines.push(`质量检查：${check.passed === false ? '未通过' : '通过'}`)

  if (check.issues?.length) {
    lines.push(`\n问题：\n- ${check.issues.join('\n- ')}`)
  }

  if (check.suggestions?.length) {
    lines.push(`\n建议：\n- ${check.suggestions.join('\n- ')}`)
  }

  return lines.join('\n')
}

function buildWorkflowSnapshotContent(workflow: AiWorkflowRun) {
  // 学习规划 / 学习进度 Workflow：显示计划标题 + 阶段摘要
  if (workflow.workflowType === 'LEARNING_PLAN' || workflow.workflowType === 'LEARNING_PROGRESS') {
    const plan = workflow.context?.stepResults?.plan
    if (plan?.title) {
      const stageCount = plan.stages?.length ?? 0
      const prefix = workflow.workflowType === 'LEARNING_PROGRESS' ? '调整后计划' : '学习计划'
      return `${prefix}：${plan.title}${stageCount ? `（共 ${stageCount} 个阶段）` : ''}`
    }
    return workflow.workflowType === 'LEARNING_PROGRESS' ? '学习进度 Workflow' : '学习规划 Workflow'
  }

  // 难点攻坚 Workflow：显示目标计划 + 阶段 + 新增任务点数
  if (workflow.workflowType === 'LEARNING_ASSIST') {
    const plan = workflow.context?.stepResults?.plan
    const planTitle = workflow.context?.planTitle
    const stageTitle = workflow.context?.targetStageTitle
    const taskCount = plan?.stages?.[0]?.tasks?.length ?? 0
    if (taskCount) {
      return `难点攻坚：${planTitle || ''}「${stageTitle || ''}」新增 ${taskCount} 个任务点`
    }
    return '难点攻坚 Workflow'
  }

  // 文章优化 Workflow：显示优化方案 / 优化稿
  if (workflow.workflowType === 'OPTIMIZE_ARTICLE') {
    const stepResults = workflow.context?.stepResults
    const plan = stepResults?.optimizationPlan?.trim()
    const optimizedContent = stepResults?.optimizedContent?.trim()
    const qualityText = formatWorkflowQualityCheck(stepResults?.contentCheck)

    if (workflow.status === 'WAITING_PLAN_CONFIRM') {
      return plan || '已进入文章优化 Workflow，正在生成优化方案。'
    }

    if (
      workflow.status === 'WAITING_DRAFT_CONFIRM' ||
      workflow.status === 'WAITING_USER_SAVE' ||
      workflow.status === 'COMPLETED'
    ) {
      return [optimizedContent, qualityText].filter(Boolean).join('\n\n') ||
        '已进入文章优化 Workflow，正在重写文章。'
    }

    return `Workflow 状态：${workflow.status}`
  }

  // 文章创作 Workflow：原有逻辑（stepResults 优先，顶层兜底兼容历史 run）
  const requirement = workflow.context?.requirement?.topic?.trim() || '文章'
  const stepResults = workflow.context?.stepResults
  const outline = stepResults?.outline?.trim() || workflow.context?.outline?.trim()
  const draft = stepResults?.draft ?? workflow.context?.draft
  const qualityCheck = stepResults?.qualityCheck ?? workflow.context?.qualityCheck

  if (workflow.status === 'WAITING_OUTLINE_CONFIRM') {
    return outline || `已进入 ${requirement} 工作流，正在生成大纲。`
  }

  if (
    workflow.status === 'WAITING_DRAFT_CONFIRM' ||
    workflow.status === 'WAITING_FILL_CONFIRM' ||
    workflow.status === 'WAITING_USER_SAVE' ||
    workflow.status === 'COMPLETED'
  ) {
    const title = draft?.title?.trim() || requirement
    const summary = draft?.summary?.trim()
    const content = draft?.content?.trim()
    const qualityText = formatWorkflowQualityCheck(qualityCheck)

    return [
      `## ${title}`,
      summary,
      content,
      qualityText,
    ].filter(Boolean).join('\n\n')
  }

  return `Workflow 状态：${workflow.status}`
}

/** 创作 Workflow 卡片渲染数据：stepResults 优先，顶层兜底兼容历史 run（C 批统一数据位置后旧 run 仍可渲染） */
function createCardData(ctx?: AiWorkflowRun['context']) {
  const sr = ctx?.stepResults
  return {
    outline: sr?.outline || ctx?.outline,
    draft: sr?.draft ?? ctx?.draft,
    qualityCheck: sr?.qualityCheck ?? ctx?.qualityCheck,
  }
}

function syncWorkflowSnapshotMessage(workflow: AiWorkflowRun) {
  // 找到消息列表中已有的 workflow 消息，更新其 workflow 字段
  const existingIndex = messages.value.findIndex(
    (msg) => msg.role === 'ai' && msg.workflow?.id === workflow.id,
  )
  if (existingIndex >= 0) {
    messages.value[existingIndex] = {
      ...messages.value[existingIndex],
      workflow,
      // 已有真实落库内容不覆盖（与 attachWorkflowToLatestAiMessage 一致），
      // 否则"请先确认生成方案"等快照消息会被后续状态快照刷掉
      content:
        messages.value[existingIndex].content || buildWorkflowSnapshotContent(workflow),
    }
  }
}

/** 刷新后历史消息没有 workflow 字段，把当前 active workflow 挂回最后一条 AI 消息 */
function attachWorkflowToLatestAiMessage(workflow: AiWorkflowRun) {
  const existingIndex = messages.value.findIndex(
    (msg) => msg.role === 'ai' && msg.workflow?.id === workflow.id,
  )

  if (existingIndex >= 0) {
    messages.value[existingIndex] = {
      ...messages.value[existingIndex],
      workflow,
      // 历史消息落库时已有真实 content，只在为空时用快照兜底，不覆盖
      content:
        messages.value[existingIndex].content || buildWorkflowSnapshotContent(workflow),
    }
    return
  }

  for (let i = messages.value.length - 1; i >= 0; i--) {
    if (messages.value[i].role === 'ai') {
      messages.value[i] = {
        ...messages.value[i],
        workflow,
        content: messages.value[i].content || buildWorkflowSnapshotContent(workflow),
      }
      return
    }
  }
}

function resetWorkflowRejectUI() {
  workflowRejectEditing.value = false
  workflowFeedback.value = ''
}

async function approveWorkflow() {
  if (!activeWorkflow.value || workflowBusy.value) return

  const workflowId = activeWorkflow.value.id
  const idempotencyKey =
    getWorkflowActionKey(workflowId, 'APPROVE')

  workflowBusy.value = true
  localTransition.value = 'APPROVING'

  try {
    await aiApi.streamApproveWorkflow(
      workflowId,
      idempotencyKey,
      {
        onStep: applyWorkflowStepEvent,

        onContentDelta: applyWorkflowContentDelta,

        async onStop(data) {
          await applyWorkflowStreamResult(data)
          clearWorkflowActionKey(workflowId, 'APPROVE')
          resetWorkflowRejectUI()
        },

        async onWorkflowError(data) {
          await applyWorkflowStreamResult(data)

          // 后端已经执行完成，只是业务结果为 FAILED
          if (data.workflow) {
            clearWorkflowActionKey(workflowId, 'APPROVE')
          }

          message.error(
            data.message
              ?? data.workflow?.errorMessage
              ?? 'Workflow 执行失败',
          )
        },

        onError(error) {
          // 网络断开时保留 Key，下一次点击复用
          message.error(
            error?.message ?? 'Workflow 同意失败',
          )
        },
      },
    )
  } catch (error: any) {
    message.error(
      error?.message ?? 'Workflow 同意失败',
    )
  } finally {
    workflowBusy.value = false
    localTransition.value = null
  }
}

async function rejectWorkflow() {
  const feedback = workflowFeedback.value.trim()

  if (!feedback) {
    message.warning('请先填写修改意见')
    return
  }

  if (!activeWorkflow.value || workflowBusy.value) return

  const workflowId = activeWorkflow.value.id
  const idempotencyKey =
    getWorkflowActionKey(
      workflowId,
      'REJECT',
      feedback,
    )

  workflowBusy.value = true
  localTransition.value = 'REJECTING'

  try {
    await aiApi.streamRejectWorkflow(
      workflowId,
      feedback,
      idempotencyKey,
      {
        onStep: applyWorkflowStepEvent,

        onContentDelta: applyWorkflowContentDelta,

        async onStop(data) {
          await applyWorkflowStreamResult(data)
          clearWorkflowActionKey(workflowId, 'REJECT')
          resetWorkflowRejectUI()
        },

        async onWorkflowError(data) {
          await applyWorkflowStreamResult(data)

          if (data.workflow) {
            clearWorkflowActionKey(workflowId, 'REJECT')
          }

          message.error(
            data.message
              ?? data.workflow?.errorMessage
              ?? 'Workflow 修改失败',
          )
        },

        onError(error) {
          // 网络失败保留相同 Key
          message.error(
            error?.message ?? 'Workflow 修改失败',
          )
        },
      },
    )
  } catch (error: any) {
    message.error(
      error?.message ?? 'Workflow 修改失败',
    )
  } finally {
    workflowBusy.value = false
    localTransition.value = null
  }
}

async function retryWorkflow() {
  if (!activeWorkflow.value || workflowBusy.value) return

  const workflowId = activeWorkflow.value.id
  const idempotencyKey =
    getWorkflowActionKey(workflowId, 'RETRY')

  workflowBusy.value = true
  localTransition.value = 'RETRYING'

  try {
    await aiApi.streamRetryWorkflow(
      workflowId,
      idempotencyKey,
      {
        onStep: applyWorkflowStepEvent,

        onContentDelta: applyWorkflowContentDelta,

        async onStop(data) {
          await applyWorkflowStreamResult(data)
          clearWorkflowActionKey(workflowId, 'RETRY')
          resetWorkflowRejectUI()
          message.success('Workflow 已重试')
        },

        async onWorkflowError(data) {
          await applyWorkflowStreamResult(data)

          if (data.workflow) {
            clearWorkflowActionKey(workflowId, 'RETRY')
          }

          message.error(
            data.message
              ?? data.workflow?.errorMessage
              ?? 'Workflow 重试失败',
          )
        },

        onError(error) {
          message.error(
            error?.message ?? 'Workflow 重试失败',
          )
        },
      },
    )
  } catch (error: any) {
    message.error(
      error?.message ?? 'Workflow 重试失败',
    )
  } finally {
    workflowBusy.value = false
    localTransition.value = null
  }
}

async function cancelWorkflow() {
  if (!activeWorkflow.value || workflowBusy.value) return

  const workflowId = activeWorkflow.value.id

  workflowBusy.value = true
  localTransition.value = 'CANCELLING'
  try {
    await aiApi.cancelWorkflow(workflowId)
    clearSessionActiveWorkflow(workflowId)
    activeWorkflow.value = null
    workflowRejectEditing.value = false
    workflowFeedback.value = ''
    message.success('Workflow 已取消')
  } catch (error: any) {
    message.error(error?.message ?? '取消 Workflow 失败')
  } finally {
    workflowBusy.value = false
    localTransition.value = null
  }
}

/** 完成/取消后清掉本地 sessions 缓存里的 activeWorkflowRunId */
function clearSessionActiveWorkflow(workflowId?: string) {
  const session = sessions.value.find((item) => item.id === currentSessionId.value)
  if (session && (!workflowId || session.activeWorkflowRunId === workflowId)) {
    session.activeWorkflowRunId = undefined
  }
}

/** 流式 delta：按 field 分派——创作走 draft.content / outline，优化走 optimizedContent / optimizationPlan */
function applyWorkflowContentDelta(event: WorkflowContentDeltaEvent) {
  if (!event.workflowRunId) return

  if (event.field === 'draft.content' || event.field === 'optimizedContent') {
    const old = workflowStreamingContent.value[event.workflowRunId] ?? ''
    workflowStreamingContent.value[event.workflowRunId] = old + (event.delta ?? '')
    return
  }

  if (event.field === 'outline' || event.field === 'optimizationPlan') {
    const old = workflowStreamingOutline.value[event.workflowRunId] ?? ''
    workflowStreamingOutline.value[event.workflowRunId] = old + (event.delta ?? '')
  }
}

/** V2.3：Agent 思考步骤实时累计到当前 AI 消息（按 stepNo upsert，RUNNING → SUCCESS/FAILED 更新状态） */
function applyAgentStepEvent(event: AgentStepEvent, messageIndex: number) {
  const current = messages.value[messageIndex]
  if (!current || current.role !== 'ai') return

  const steps = [...(current.thinkingSteps ?? [])]
  const idx = steps.findIndex((s) => s.stepNo === event.stepNo)
  const step: AgentStepView = {
    stepNo: event.stepNo,
    actionType: event.actionType,
    status: event.status,
    message: event.message,
  }
  if (idx >= 0) steps[idx] = step
  else steps.push(step)
  steps.sort((a, b) => a.stepNo - b.stepNo)

  messages.value[messageIndex] = { ...current, thinkingSteps: steps }
}

/** V2.3：历史消息按 agentRunId 补拉思考步骤（刷新/切会话恢复思考面板） */
async function hydrateThinkingSteps() {
  // 注意：不排除有 workflow 的消息——confirm 后思考步骤与 Workflow 卡共存
  const ids = Array.from(
    new Set(
      messages.value
        .filter(
          (msg) =>
            msg.role === 'ai' &&
            msg.agentRunId &&
            !msg.thinkingSteps,
        )
        .map((msg) => msg.agentRunId as string),
    ),
  )
  if (!ids.length) return

  const results = await Promise.allSettled(ids.map((id) => aiApi.getAgentRunSteps(id)))
  ids.forEach((id, i) => {
    const steps = results[i].status === 'fulfilled' ? results[i].value?.data : null
    if (!steps?.length) return
    const idx = messages.value.findIndex(
      (msg) => msg.agentRunId === id && !msg.thinkingSteps,
    )
    if (idx >= 0) {
      messages.value[idx] = {
        ...messages.value[idx],
        thinkingSteps: steps
          .map((s: AgentStepHistoryItem) => ({
            stepNo: s.stepNo,
            actionType: s.actionType,
            status: s.status as AgentStepView['status'],
            message: s.message ?? s.summary ?? s.actionType,
          }))
          .sort((a, b) => a.stepNo - b.stepNo),
      }
    }
  })
}

/** 流式 step 事件：展开日志区并插入临时 RUNNING 日志 */
function applyWorkflowStepEvent(event: WorkflowStepEvent) {
  const workflowId = event.workflowRunId
  if (!workflowId) return

  workflowStepLogsExpanded.value[workflowId] = true
  workflowStepLogsLoading.value[workflowId] = false

  const runningLog: AiWorkflowStepLog = {
    id: `stream-${workflowId}-${event.step ?? event.action ?? 'workflow'}`,
    workflowRunId: workflowId,
    logType: 'STEP', // 实时流都来自 runStep（步骤级）
    stepOrder: 0,
    step: event.step ?? event.action ?? 'WORKFLOW',
    status: event.status || 'RUNNING',
    inputSummary: event.message ?? 'Workflow 正在执行...',
    startedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  }

  // upsert：同 id 的实时日志更新状态（RUNNING → SUCCESS），不同 id 插到最前
  const oldList = workflowStepLogs.value[workflowId] ?? []
  const index = oldList.findIndex((log) => log.id === runningLog.id)

  if (index >= 0) {
    oldList[index] = runningLog
    workflowStepLogs.value[workflowId] = [...oldList]
  } else {
    workflowStepLogs.value[workflowId] = [runningLog, ...oldList]
  }
}

/** 初始 Workflow 尚未收到最终 STOP 时，先用步骤事件创建临时卡片。 */
function applyInitialWorkflowStepCard(
  event: WorkflowStepEvent,
  messageIndex: number,
) {
  const workflowId = event.workflowRunId
  if (!workflowId || !event.workflowType) return

  const message = messages.value[messageIndex]
  const existing = message?.workflow?.id === workflowId
    ? message.workflow
    : activeWorkflow.value?.id === workflowId
      ? activeWorkflow.value
      : null

  const workflow: AiWorkflowRun = existing
    ? {
        ...existing,
        currentStep: event.step as AiWorkflowRun['currentStep'],
        status: existing.status === 'FAILED' ? existing.status : 'RUNNING',
      }
    : {
        id: workflowId,
        workflowType: event.workflowType,
        workflowVersion: '1.0',
        status: 'RUNNING',
        currentStep: event.step as AiWorkflowRun['currentStep'],
        context: {
          workflowVersion: '1.0',
          variables: {},
        },
      }

  activeWorkflow.value = workflow

  if (message?.role === 'ai' && message.id === '') {
    messages.value[messageIndex] = {
      ...message,
      workflow,
    }
  }
}

/** 流式结束事件：更新 activeWorkflow / 步骤日志 / editorAction */
async function applyWorkflowStreamResult(data: WorkflowStreamResult) {
  if (!data.workflow) return

  // 结束态（否定反馈取消 / 填充完成）：清空面板和本地 session 缓存，让后续消息走普通聊天
  if (data.workflow.status === 'CANCELLED' || data.workflow.status === 'COMPLETED') {
    // 填充动作随结束态一起返回（approve 填充后直接 COMPLETED）：先跳转填充，再清面板
    if (data.editorAction) {
      await handleEditorAction(data.editorAction)
    }
    activeWorkflow.value = null
    clearSessionActiveWorkflow(data.workflow.id)
    return
  }

  activeWorkflow.value = data.workflow
  syncWorkflowSnapshotMessage(data.workflow)
  // 流式内容已落库到 snapshot，清理累积的 delta
  delete workflowStreamingContent.value[data.workflow.id]
  delete workflowStreamingOutline.value[data.workflow.id]

  if (data.stepLogs) {
    // 保留实时日志（stream- 前缀），拼接数据库 StepLog，避免 STOP 时把执行中的步骤覆盖掉
    const workflowId = data.workflow.id
    const liveLogs = (workflowStepLogs.value[workflowId] ?? []).filter((log) =>
      log.id.startsWith(`stream-${workflowId}-`),
    )

    workflowStepLogs.value[workflowId] = [
      ...liveLogs,
      ...data.stepLogs,
    ]
  }

  if (data.editorAction) {
    await handleEditorAction(data.editorAction)
  }
}

/** 展开时刷新步骤日志（仅当该 workflow 的日志区已展开） */
async function refreshWorkflowStepLogs(workflowId: string) {
  if (!workflowStepLogsExpanded.value[workflowId]) return

  const res = await aiApi.getWorkflowStepLogs(workflowId)
  workflowStepLogs.value[workflowId] = res.data ?? []
}

/** 展开/收起步骤日志，展开时懒加载；展开状态持久化，刷新后恢复 */
async function toggleWorkflowStepLogs(workflowId: string) {
  workflowStepLogsExpanded.value[workflowId] = !workflowStepLogsExpanded.value[workflowId]

  if (!workflowStepLogsExpanded.value[workflowId]) {
    localStorage.removeItem(`ai_wf_logs_expanded_${workflowId}`)
    return
  }
  localStorage.setItem(`ai_wf_logs_expanded_${workflowId}`, '1')
  if (workflowStepLogs.value[workflowId]?.length) return
  if (workflowStepLogsLoading.value[workflowId]) return

  workflowStepLogsLoading.value[workflowId] = true
  try {
    const res = await aiApi.getWorkflowStepLogs(workflowId)
    workflowStepLogs.value[workflowId] = res.data ?? []
  } catch (error: any) {
    message.error(error?.message ?? '加载 Workflow 执行详情失败')
  } finally {
    workflowStepLogsLoading.value[workflowId] = false
  }
}

// ============================================================
// 拖拽移动
// ============================================================

const isDragging = ref(false)
const dragStart = ref({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 })
const panelOffset = ref({ x: 0, y: 0 })

function onHeaderMouseDown(e: MouseEvent) {
  // 不拦截按钮点击
  const target = e.target as HTMLElement
  if (target.closest('button')) return

  isDragging.value = true
  dragStart.value = {
    mouseX: e.clientX,
    mouseY: e.clientY,
    panelX: panelOffset.value.x,
    panelY: panelOffset.value.y,
  }
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

// 面板顶部不得越过 header（header sticky 64px + 安全间距 8px = 72px）
function clampPanelTop(yOffset: number): number {
  // 面板顶部 = 视口高度 - 120(bottom) - 面板高度 + yOffset
  // 约束：面板顶部 >= 72px
  const top = window.innerHeight - 120 - panelH.value + yOffset
  if (top < 72) return yOffset + (72 - top)
  return yOffset
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  const rawY = dragStart.value.panelY + (e.clientY - dragStart.value.mouseY)
  panelOffset.value = {
    x: dragStart.value.panelX + (e.clientX - dragStart.value.mouseX),
    y: clampPanelTop(rawY),
  }
}

function onMouseUp() {
  isDragging.value = false
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
}

const panelStyle = computed(() => {
  const tx = panelOffset.value.x + resizeOffset.value.x
  const ty = panelOffset.value.y + resizeOffset.value.y
  const style: Record<string, string> = {}
  if (tx !== 0 || ty !== 0) style.transform = `translate(${tx}px, ${ty}px)`
  if (panelW.value !== 500) style.width = `${panelW.value}px`
  if (panelH.value !== 560) style.height = `${panelH.value}px`
  return Object.keys(style).length > 0 ? style : undefined
})

// ============================================================
// 边缘缩放
// ============================================================

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const resizing = ref<ResizeDir | null>(null)
const panelW = ref(500)
const panelH = ref(560)
const resizeOffset = ref({ x: 0, y: 0 })
let resizeStart = { mx: 0, my: 0, w: 0, h: 0, ox: 0, oy: 0 }

const MIN_W = 360
const MIN_H = 400

function maxW() { return window.innerWidth - 48 }
function maxH() { return window.innerHeight - 140 }

function onResizeStart(e: MouseEvent, dir: ResizeDir) {
  e.preventDefault()
  e.stopPropagation()
  resizing.value = dir
  resizeStart = {
    mx: e.clientX, my: e.clientY,
    w: panelW.value, h: panelH.value,
    ox: resizeOffset.value.x, oy: resizeOffset.value.y,
  }
  document.addEventListener('mousemove', onResizeMove)
  document.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent) {
  if (!resizing.value) return
  const d = resizing.value
  const dx = e.clientX - resizeStart.mx
  const dy = e.clientY - resizeStart.my

  let newW = resizeStart.w, newH = resizeStart.h
  let ox = resizeStart.ox, oy = resizeStart.oy

  // 东/西：宽度变化以固定对边
  if (d.includes('e')) {
    // 拖右边 → 宽度 = 原始 + dx，左边缘不动 → 面板跟随右移
    const w = resizeStart.w + dx
    if (w >= MIN_W && w <= maxW()) { newW = w; ox = resizeStart.ox + dx }
  }
  if (d.includes('w')) {
    // 拖左边 → 宽度 = 原始 - dx，右边缘不动 → 面板跟随左移
    const w = resizeStart.w - dx
    if (w >= MIN_W && w <= maxW()) { newW = w; ox = resizeStart.ox + dx }
  }

  // 南/北：高度变化以固定对边
  if (d.includes('s')) {
    // 拖下边 → 高度 = 原始 + dy，上边缘不动 → 面板跟随下移
    const h = resizeStart.h + dy
    if (h >= MIN_H && h <= maxH()) { newH = h; oy = resizeStart.oy + dy }
  }
  if (d.includes('n')) {
    // 拖上边 → 高度 = 原始 - dy，下边缘不动 → 面板跟随上移
    // 约束：面板顶部不得越过 header（72px）
    const h = resizeStart.h - dy
    let candidateOy = resizeStart.oy + dy
    // 计算面板顶部位置
    const top = window.innerHeight - 120 - h + candidateOy
    if (top < 72) candidateOy += (72 - top)
    if (h >= MIN_H && h <= maxH()) { newH = h; oy = candidateOy }
  }

  panelW.value = newW
  panelH.value = newH
  resizeOffset.value = { x: ox, y: oy }
}

function onResizeEnd() {
  resizing.value = null
  document.removeEventListener('mousemove', onResizeMove)
  document.removeEventListener('mouseup', onResizeEnd)
}

// ============================================================
// Derived
// ============================================================

const sortedSessions = computed(() =>
  [...sessions.value].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  ),
)

// 记忆候选
const memoryCandidates = ref<AiMemoryCandidate[]>([])
const loadingMemoryCandidates = ref(false)
const handlingMemoryCandidateId = ref<string | null>(null)

const pendingMemoryCount = computed(() => memoryCandidates.value.length)

const memoryManagerVisible = ref(false)
const memoryTab = ref<'candidates' | 'memories'>('candidates')
const formalMemories = ref<AiMemory[]>([])
const loadingFormalMemories = ref(false)
const handlingFormalMemoryId = ref<string | null>(null)

// 行内编辑状态
const editingCandidateId = ref<string | null>(null)
const editingCandidateContent = ref('')
const editingMemoryId = ref<string | null>(null)
const editingMemoryContent = ref('')

const showWelcome = computed(() => messages.value.length === 0)

// ============================================================
// Scroll
// ============================================================

function isNearBottom() {
  const el = messageListRef.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight <= AUTO_SCROLL_THRESHOLD
}

function handleMessageListScroll() {
  shouldAutoScroll.value = isNearBottom()
}

async function scrollToBottom(force = false) {
  await nextTick()
  const el = messageListRef.value
  if (!el) return

  if (force || shouldAutoScroll.value || isNearBottom()) {
    el.scrollTop = el.scrollHeight
    shouldAutoScroll.value = true
  }
}

function isMessageStreaming(index: number, role: string): boolean {
  return sending.value && role === 'ai' && index === messages.value.length - 1
}

function formatMessageTime(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('zh-CN')
}

// ============================================================
// Actions
// ============================================================

async function loadSessions() {
  try {
    const res = await aiApi.getSessions(1, 50)
    if (res.data) {
      sessions.value = res.data.list
    }
  } catch {
    // 静默失败，session 列表为空
  }
}

/** 历史消息只带 workflowRunId，补拉 workflow 数据挂回消息，恢复工作流卡片（含执行详情） */
async function hydrateWorkflowMessages() {
  const ids = Array.from(
    new Set(
      messages.value
        .filter((msg) => msg.role === 'ai' && msg.workflowRunId && !msg.workflow)
        .map((msg) => msg.workflowRunId as string),
    ),
  )
  if (!ids.length) return

  const runs = await Promise.allSettled(ids.map((id) => aiApi.getWorkflowRun(id)))
  ids.forEach((id, i) => {
    const run = runs[i].status === 'fulfilled' ? runs[i].value?.data : null
    if (!run) return

    const idx = messages.value.findIndex((msg) => msg.workflowRunId === id && !msg.workflow)
    if (idx >= 0) {
      messages.value[idx] = {
        ...messages.value[idx],
        workflow: run,
        content: messages.value[idx].content || buildWorkflowSnapshotContent(run),
      }
    }

    // 恢复步骤日志展开状态（刷新前展开过的自动重新展开并拉取）
    if (localStorage.getItem(`ai_wf_logs_expanded_${id}`) === '1') {
      workflowStepLogsExpanded.value[id] = true
      void refreshWorkflowStepLogs(id)
    }
  })
}

/** V2.1：历史消息只带 agentRunId，补拉建议快照恢复建议卡（仅 WAITING_WORKFLOW_CONFIRM 渲染） */
async function hydrateSuggestionMessages() {
  const ids = Array.from(
    new Set(
      messages.value
        .filter(
          (msg) =>
            msg.role === 'ai' &&
            msg.agentRunId &&
            !msg.workflowSuggestion &&
            !msg.workflow,
        )
        .map((msg) => msg.agentRunId as string),
    ),
  )
  if (!ids.length) return

  const views = await Promise.allSettled(ids.map((id) => aiApi.getWorkflowSuggestion(id)))
  ids.forEach((id, i) => {
    const view = views[i].status === 'fulfilled' ? views[i].value?.data : null
    if (!view?.suggestion || view.status !== 'WAITING_WORKFLOW_CONFIRM') return

    const idx = messages.value.findIndex(
      (msg) => msg.agentRunId === id && !msg.workflowSuggestion && !msg.workflow,
    )
    if (idx >= 0) {
      messages.value[idx] = {
        ...messages.value[idx],
        workflowSuggestion: view.suggestion,
        suggestionState: 'pending',
      }
    }
  })
}

/** V2.4：确认写动作提案 → 后端标题匹配 + 执行 → 卡片消失（执行结果由后端返回） */
// V3.1：写动作卡按内层 actionType 渲染——不能按 done 判断（ADD 的 done 恒 false，会错显成「取消任务完成状态」）
// V3.3：重命名任务（UPDATE_LEARNING_TASK）——done 也恒 false，同样不能靠 done 判断
function writeActionTypeLabel(w: AgentWriteProposal): string {
  if (w.actionType === 'ADD_LEARNING_TASK') return '追加学习任务'
  if (w.actionType === 'UPDATE_LEARNING_TASK') return '重命名学习任务'
  return w.done ? '勾选任务为完成' : '取消任务完成状态'
}
function writeActionReason(w: AgentWriteProposal): string {
  if (w.actionType === 'ADD_LEARNING_TASK') {
    const plan = w.planRef ? `「${w.planRef}」` : ''
    const stage = w.stageTitle ? ` · 阶段「${w.stageTitle}」` : ''
    return `向 计划${plan}${stage} 追加任务「${w.taskTitle}」`
  }
  if (w.actionType === 'UPDATE_LEARNING_TASK') {
    // 显式展示 旧名 → 新名，确认动作可审计（newTitle 兜底旧数据 undefined 不崩）
    const stage = w.stageTitle ? `（阶段：${w.stageTitle}）` : ''
    return `将任务「${w.taskTitle}」重命名为「${w.newTitle ?? '—'}」${stage}`
  }
  return `任务「${w.taskTitle}」` + (w.stageTitle ? `（阶段：${w.stageTitle}）` : '')
}

async function confirmWriteAction(msg: AiMessage) {
  if (!msg.agentRunId || !msg.writeAction) return
  setWriteActionState(msg, 'processing')
  try {
    const res = await aiApi.confirmWriteAction(msg.agentRunId)
    message.success(res.data ?? '已执行')
    const idx = messages.value.findIndex((m) => m.id === msg.id)
    if (idx >= 0) {
      messages.value[idx] = {
        ...messages.value[idx],
        writeAction: undefined,
        writeActionState: undefined,
      }
    }
  } catch (e: any) {
    setWriteActionState(msg, 'pending')
    message.error(e?.message ?? '执行失败，请重试')
  }
}

/** V2.4：取消写动作提案（不执行任何修改） */
async function cancelWriteAction(msg: AiMessage) {
  if (!msg.agentRunId) return
  setWriteActionState(msg, 'processing')
  try {
    await aiApi.cancelWriteAction(msg.agentRunId)
    setWriteActionState(msg, 'cancelled')
  } catch (e: any) {
    setWriteActionState(msg, 'pending')
    message.error(e?.message ?? '取消失败，请重试')
  }
}

function setWriteActionState(msg: AiMessage, state: AiMessage['writeActionState']) {
  const idx = messages.value.findIndex((m) => m.id === msg.id)
  if (idx >= 0) {
    messages.value[idx] = { ...messages.value[idx], writeActionState: state }
  }
}

/** V2.4：历史消息按 agentRunId 补拉写动作提案（刷新恢复写动作卡） */
async function hydrateWriteActions() {
  const ids = Array.from(
    new Set(
      messages.value
        .filter(
          (msg) =>
            msg.role === 'ai' &&
            msg.agentRunId &&
            !msg.writeAction &&
            !msg.workflow,
        )
        .map((msg) => msg.agentRunId as string),
    ),
  )
  if (!ids.length) return

  const views = await Promise.allSettled(ids.map((id) => aiApi.getWriteAction(id)))
  ids.forEach((id, i) => {
    const view = views[i].status === 'fulfilled' ? views[i].value?.data : null
    if (!view?.proposal || view.status !== 'WAITING_WRITE_CONFIRM') return
    const idx = messages.value.findIndex(
      (msg) => msg.agentRunId === id && !msg.writeAction && !msg.workflow,
    )
    if (idx >= 0) {
      messages.value[idx] = {
        ...messages.value[idx],
        writeAction: view.proposal,
        writeActionState: 'pending',
      }
    }
  })
}

/** V2.1：确认 Agent 建议 → 后端启动学习类 Workflow → 返回的 Workflow 快照直接挂回消息渲染 Workflow 卡 */
async function confirmSuggestion(msg: AiMessage) {
  if (!msg.agentRunId || !msg.workflowSuggestion) return
  setMessageState(msg, 'processing')

  const key = getWorkflowActionKey(msg.agentRunId, 'CONFIRM_SUGGEST')
  try {
    const res = await aiApi.confirmWorkflowSuggestion(msg.agentRunId, key)
    clearWorkflowActionKey(msg.agentRunId, 'CONFIRM_SUGGEST')
    const workflow = res.data
    const idx = messages.value.findIndex((m) => m.id === msg.id)
    if (idx >= 0) {
      messages.value[idx] = {
        ...messages.value[idx],
        workflow,
        workflowRunId: workflow.id,
        workflowSuggestion: undefined,
        suggestionState: undefined,
      }
    }
    // 激活底部工作流面板（与正常 Workflow 创建一致）
    activeWorkflow.value = workflow
    message.success('已启动 ' + workflowLabel(workflow.workflowType))
  } catch (e: any) {
    setMessageState(msg, 'pending')
    message.error(e?.message ?? '启动失败，请重试')
  }
}

/** V2.1：取消 Agent 建议（不启动 Workflow） */
async function cancelSuggestion(msg: AiMessage) {
  if (!msg.agentRunId) return
  setMessageState(msg, 'processing')
  try {
    await aiApi.cancelWorkflowSuggestion(msg.agentRunId)
    setMessageState(msg, 'cancelled')
  } catch (e: any) {
    setMessageState(msg, 'pending')
    message.error(e?.message ?? '取消失败，请重试')
  }
}

function setMessageState(msg: AiMessage, state: AiMessage['suggestionState']) {
  const idx = messages.value.findIndex((m) => m.id === msg.id)
  if (idx >= 0) {
    messages.value[idx] = { ...messages.value[idx], suggestionState: state }
  }
}

function workflowLabel(type: WorkflowType): string {
  return type === 'OPTIMIZE_ARTICLE' ? '文章优化 Workflow' : type === 'LEARNING_PLAN' ? '学习规划 Workflow' : type === 'LEARNING_PROGRESS' ? '学习进度 Workflow' : type === 'LEARNING_ASSIST' ? '难点攻坚 Workflow' : '文章创作 Workflow'
}

// V3.0：思考中刷新补拉。Agent/流式回复尚未落库时（最后一条是用户消息），
// 立即渲染「思考中」占位 + 每 3 秒静默重拉（最多 6 次），落库后自然替换，
// 避免「刷新后 AI 回复和思考面板丢失」以及「突然整条跳出」的突兀感。
let pendingReplyReloadTimer: number | null = null
let pendingReplyReloadAttempts = 0

async function loadMessages(sid: string, silent = false) {
  if (!silent) loadingMessages.value = true
  try {
    const res = await aiApi.getMessages(sid)
    // 从 localStorage 恢复 references（后端未持久化，刷新会丢失）
    messages.value = (res.data ?? []).map(msg => {
      if (msg.role === 'ai' && (!msg.references || msg.references.length === 0) && msg.id) {
        try {
          const cached = localStorage.getItem(`ai_ref_${msg.id}`)
          if (cached) return { ...msg, references: JSON.parse(cached) }
        } catch { /* ignore parse errors */ }
      }
      return msg
    })
    // 历史 workflow 卡片：后端消息不带 workflow 对象，按 workflowRunId 补拉
    await hydrateWorkflowMessages()
    // V2.1：历史 Agent 建议卡：按 agentRunId 补拉建议快照
    await hydrateSuggestionMessages()
    // V2.3：历史 Agent 思考步骤：按 agentRunId 补拉（刷新恢复思考面板）
    await hydrateThinkingSteps()
    // V2.4：历史 Agent 写动作提案：按 agentRunId 补拉（刷新恢复写动作卡）
    await hydrateWriteActions()
    await scrollToBottom(true)
  } catch {
    message.error('加载消息失败')
  } finally {
    loadingMessages.value = false
    schedulePendingReplyReload(sid)
  }
}

/** V3.0：最后一条是用户消息且无 AI 回复（可能是流式/Agent 落库前刷新）→ 占位 + 轮询补拉 */
function schedulePendingReplyReload(sid: string) {
  const last = messages.value[messages.value.length - 1]
  if (!last || last.role !== 'user') return
  if (pendingReplyReloadAttempts >= 6) return
  pendingReplyReloadAttempts++
  // 确保有「思考中」占位（每次整体替换后重新补）
  if (messages.value[messages.value.length - 1]?.role === 'user') {
    messages.value.push({
      id: '',
      sessionId: sid,
      role: 'ai',
      content: '🤔 正在思考中…',
      createdAt: new Date().toISOString(),
    })
  }
  if (pendingReplyReloadTimer) clearTimeout(pendingReplyReloadTimer)
  pendingReplyReloadTimer = window.setTimeout(async () => {
    // 用户已发起新消息 → 放弃补拉（避免整体替换冲掉正在流式的临时消息）
    if (sending.value) return
    await loadMessages(sid, true)
  }, 3000)
}

/** 刷新/切会话后恢复 active workflow：从 session 的 activeWorkflowRunId 拉取并挂回消息 */
async function restoreActiveWorkflow(session?: AiSession | null) {
  const workflowId = session?.activeWorkflowRunId

  if (!workflowId) {
    activeWorkflow.value = null
    return
  }

  try {
    const res = await aiApi.getWorkflowRun(workflowId)
    if (!res.data) {
      activeWorkflow.value = null
      return
    }

    // 结束态的 workflow 不该恢复为 active（面板无对应操作区），只挂回消息卡片
    if (res.data.status === 'COMPLETED' || res.data.status === 'CANCELLED') {
      activeWorkflow.value = null
      attachWorkflowToLatestAiMessage(res.data)
      return
    }

    activeWorkflow.value = res.data
    attachWorkflowToLatestAiMessage(res.data)

    if (workflowStepLogsExpanded.value[res.data.id]) {
      await refreshWorkflowStepLogs(res.data.id)
    }
  } catch {
    activeWorkflow.value = null
  }
}

async function toggle() {
  if (!visible.value) {
    visible.value = true
    if (isGuest.value) {
      // 游客：从 sessionStorage 恢复消息
      messages.value = loadGuestMessages()
      guestUsedCount.value = loadGuestUsedCount()
    } else {
      await loadSessions()
      if (sortedSessions.value.length > 0) {
        switchSession(sortedSessions.value[0].id)
      }
    }
  } else {
    visible.value = false
  }
}

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
  // 切换全屏时重置拖拽和缩放
  panelOffset.value = { x: 0, y: 0 }
  resizeOffset.value = { x: 0, y: 0 }
  panelW.value = 500
  panelH.value = 560
}

function openHistory() {
  viewingHistory.value = true
}

function closeHistory() {
  viewingHistory.value = false
}

async function switchSession(sid: string) {
  currentSessionId.value = sid
  viewingHistory.value = false
  resetCompressionHint()
  await loadMessages(sid)
  await syncCompressionHint(sid)

  const session = sessions.value.find((item) => item.id === sid)
  await restoreActiveWorkflow(session)
}

/** 创建新会话：游客清空临时消息，登录用户重置为欢迎页 */
function createSession() {
  if (isGuest.value) {
    clearGuestData()
    messages.value = []
    guestUsedCount.value = 0
    activeWorkflow.value = null
    return
  }
  currentSessionId.value = null
  messages.value = []
  activeWorkflow.value = null
  workflowRejectEditing.value = false
  workflowFeedback.value = ''
  viewingHistory.value = false
  input.value = ''
}

async function deleteSession(sid: string) {
  try {
    await aiApi.deleteSession(sid)
    sessions.value = sessions.value.filter((s) => s.id !== sid)
    message.success('已删除会话')
    if (currentSessionId.value === sid) {
      currentSessionId.value = null
      messages.value = []
      resetCompressionHint()
    }
  } catch {
    message.error('删除失败')
  }
}

// 导航路由映射（AI 导航 tool 调用后触发）
const NAV_ROUTES: Record<string, string> = {
  home: '/',
  profile: '/me',
  editor: '/editor',
  drafts: '/drafts',
  hotRank: '/rank/hot',
}

async function handleNavigate(navigate?: { target: string; param?: string }) {
  if (!navigate) return
  const { target, param } = navigate

  let path = ''
  if (target === 'article' && param) {
    path = `/articles/${param}`
  } else if (target === 'userProfile' && param) {
    path = `/users/${param}`
  } else if (NAV_ROUTES[target]) {
    path = NAV_ROUTES[target]
  }

  if (!path) {
    message.warning('AI 已识别跳转意图，但缺少目标参数')
    return
  }

  if (router.currentRoute.value.path === path) {
    message.info('已经在目标页面了')
    return
  }

  try {
    const failure = await router.push(path)
    if (failure) {
      message.warning('跳转失败，请检查是否需要登录')
    }
  } catch {
    message.warning('跳转失败，请检查是否需要登录')
  }
}

async function openReferenceArticle(reference: ArticleRagReference) {
  if (!reference.articleId) {
    message.warning('缺少文章 ID，无法打开来源')
    return
  }

  const path = `/articles/${reference.articleId}`

  if (router.currentRoute.value.path === path) {
    message.info('已经在这篇文章了')
    return
  }

  try {
    const failure = await router.push(path)
    if (failure) {
      message.warning('打开来源文章失败')
    }
  } catch {
    message.warning('打开来源文章失败')
  }
}

async function handleEditorAction(action: EditorAction) {
  const routeName = String(router.currentRoute.value.name ?? '')
  const inEditor = routeName === 'editor-new' || routeName === 'editor-edit'

  if (action.type === 'fillArticle') {
    const targetArticleId = action.articleId ? String(action.articleId) : ''

    if (targetArticleId) {
      const alreadyEditingTarget =
        routeName === 'editor-edit' &&
        String(router.currentRoute.value.params.id ?? '') === targetArticleId

      if (!alreadyEditingTarget) {
        await router.push({ name: 'editor-edit', params: { id: targetArticleId } })
        await nextTick()
      }
    } else if (!inEditor) {
      await router.push('/editor')
      await nextTick()
    }

    emitAiEditorAction(action)
    message.success(targetArticleId ? '已填入原文章编辑器' : '已填入编辑器')
    return
  }

  if (action.type === 'saveDraft' || action.type === 'publish') {
    if (!inEditor) {
      message.warning('请先进入写文章页面，再让 AI 保存或发布')
      return
    }

    emitAiEditorAction(action)
  }
}

async function handleArticleAction(action: ArticleAction) {
  if (router.currentRoute.value.name !== 'article-detail') {
    message.warning('请先打开具体文章，再让 AI 点赞')
    return
  }

  emitAiArticleAction(action)
}

function extractLegacyNavigate(content: string): { cleanContent: string; navigate?: { target: string; param?: string } } {
  const match = content.match(/\[BLOGNAV:([a-zA-Z]+)(?::(\d+))?\]/)
  if (!match) {
    return { cleanContent: content }
  }

  const legacyTargetMap: Record<string, string> = {
    goToHome: 'home',
    goToProfile: 'profile',
    goToEditor: 'editor',
    goToDrafts: 'drafts',
    goToHotRank: 'hotRank',
    goToArticle: 'article',
    goToUserProfile: 'userProfile',
  }

  const rawTarget = match[1]
  const target = legacyTargetMap[rawTarget] ?? rawTarget
  return {
    cleanContent: content.replace(match[0], '').trim(),
    navigate: {
      target,
      param: match[2],
    },
  }
}

async function send(text?: string, skipUserMessage = false) {
  const content = (text ?? input.value).trim()
  if (!content || sending.value) return

  // 游客次数检查
  if (isGuest.value && loadGuestUsedCount() >= GUEST_MAX) {
    message.warning('游客最多体验 3 次，登录后可继续使用')
    return
  }

  if (!skipUserMessage) {
    input.value = ''

    // 先在前端展示用户消息
    const tempUserMsg: AiMessage = {
      id: '',
      sessionId: currentSessionId.value ?? '',
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    }
    messages.value.push(tempUserMsg)
  }

  await scrollToBottom(true)
  sending.value = true

  // 空 AI 占位气泡（后续 onData 逐 chunk 填充）
  const aiPlaceholder: AiMessage = {
    id: '',
    sessionId: '',
    role: 'ai',
    content: '',
    createdAt: new Date().toISOString(),
  }
  const aiPlaceholderIndex = messages.value.length
  messages.value.push(aiPlaceholder)

  // 旧的未完成请求先取消
  if (abortController) abortController.abort()
  abortController = new AbortController()

  aiApi.streamChat(
    isGuest.value ? null : currentSessionId.value,
    content,
    buildPageContext(),
    {
      onParam(_session, userMessage) {
        // 用后端返回的正式数据替换临时用户消息
        let idx = -1
        for (let i = messages.value.length - 1; i >= 0; i--) {
          if (messages.value[i].role === 'user' && messages.value[i].id === '') {
            idx = i
            break
          }
        }
        if (idx >= 0) messages.value[idx] = userMessage
      },
      async onData(chunk) {
        // 逐 chunk 追加到 AI 气泡
        const currentAiMessage = messages.value[aiPlaceholderIndex]
        if (currentAiMessage) {
          messages.value[aiPlaceholderIndex] = {
            ...currentAiMessage,
            content: currentAiMessage.content + chunk,
          }
        }
        await scrollToBottom()
      },
      async onWorkflowStep(event) {
        applyWorkflowStepEvent(event)
        applyInitialWorkflowStepCard(event, aiPlaceholderIndex)
        await scrollToBottom()
      },
      async onWorkflowContentDelta(event) {
        applyWorkflowContentDelta(event)
        await scrollToBottom()
      },
      async onAgentStep(event) {
        applyAgentStepEvent(event, aiPlaceholderIndex)
        await scrollToBottom()
      },
      async onStop(session, assistantMessage, navigate, editorAction, articleAction, references, workflow, workflowSuggestion, writeAction) {
        abortController = null

        const legacyNavigate = extractLegacyNavigate(assistantMessage.content)
        assistantMessage = {
          ...assistantMessage,
          content: legacyNavigate.cleanContent,
          references: references ?? assistantMessage.references ?? [],
          workflow: workflow ?? (assistantMessage as any).workflow,
          workflowSuggestion: workflowSuggestion ?? (assistantMessage as any).workflowSuggestion,
          suggestionState: workflowSuggestion ? 'pending' : undefined,
          writeAction: writeAction ?? (assistantMessage as any).writeAction,
          writeActionState: writeAction ? 'pending' : undefined,
        }
        navigate = navigate ?? legacyNavigate.navigate

        // 后端判定为 Workflow：激活底部面板
        if (workflow) {
          activeWorkflow.value = workflow
        }

        // 用后端返回的完整数据替换 AI 占位（保留实时累计的思考步骤 V2.3）
        let idx = -1
        for (let i = messages.value.length - 1; i >= 0; i--) {
          if (messages.value[i].role === 'ai' && messages.value[i].id === '') {
            idx = i
            break
          }
        }
        if (idx >= 0) {
          messages.value[idx] = {
            ...assistantMessage,
            thinkingSteps: messages.value[idx].thinkingSteps,
          }
        }

        // 持久化 references 到 localStorage，防止刷新丢失（后端未存 references）
        const refs = assistantMessage.references
        if (refs && refs.length > 0 && assistantMessage.id) {
          try { localStorage.setItem(`ai_ref_${assistantMessage.id}`, JSON.stringify(refs)) } catch { /* quota exceeded, ignore */ }
        }

        if (isGuest.value) {
          saveGuestMessages(messages.value)
          const newCount = loadGuestUsedCount() + 1
          saveGuestUsedCount(newCount)
          guestUsedCount.value = newCount
        } else {
          currentSessionId.value = session.id
          const existing = sessions.value.findIndex((s) => s.id === session.id)
          if (existing >= 0) {
            sessions.value[existing] = session
          } else {
            sessions.value.unshift(session)
          }
        }

        sending.value = false
        scrollToBottom()
        handleNavigate(navigate)
        if (editorAction) {
          await handleEditorAction(editorAction)
        }
        if (articleAction) {
          await handleArticleAction(articleAction)
        }

        scheduleMemoryCandidateRefresh()
        // 回复结束后检查后端异步压缩状态，显示"正在自动压缩上下文 / 已自动压缩上下文"
        checkCompressionAfterReply(session.id)
      },
      onError(error) {
        abortController = null
        // 移除空 AI 占位气泡
        messages.value.pop()
        message.error(error?.message ?? '发送失败')
        sending.value = false
      },
      onAbort() {
        abortController = null
        // 保留已流式输出的内容，末尾追加停止标记
        const aiMsg = messages.value[aiPlaceholderIndex]
        if (aiMsg && aiMsg.role === 'ai') {
          messages.value[aiPlaceholderIndex] = {
            ...aiMsg,
            content: (aiMsg.content || '') + '\n\n*（已停止生成）*',
          }
        }
        sending.value = false
        if (isGuest.value) {
          saveGuestMessages(messages.value)
          const newCount = loadGuestUsedCount() + 1
          saveGuestUsedCount(newCount)
          guestUsedCount.value = newCount
        }
        scrollToBottom()
      },
    },
    abortController.signal,
  )
}

async function copyMessage(msg: AiMessage) {
  try {
    await navigator.clipboard.writeText(msg.content)
    msg.copied = true
    setTimeout(() => {
      msg.copied = false
    }, 1500)
    message.success('已复制')
  } catch {
    message.error('复制失败')
  }
}

async function deleteMessage(index: number) {
  const msg = messages.value[index]
  if (!msg?.id) return

  const removed = messages.value.splice(index, 1)[0]

  if (isGuest.value) {
    saveGuestMessages(messages.value)
    return
  }

  try {
    await aiApi.deleteMessage(msg.sessionId, msg.id)
  } catch (error: any) {
    messages.value.splice(index, 0, removed)
    message.error(error?.response?.data?.message ?? '删除失败')
  }
}

// ============================================================
// Memory candidates
// ============================================================

async function loadMemoryCandidates() {
  if (isGuest.value) {
    memoryCandidates.value = []
    return
  }

  loadingMemoryCandidates.value = true
  try {
    const res = await aiApi.getMemoryCandidates()
    memoryCandidates.value = res.data ?? []
  } catch {
    // 候选记忆不是聊天主流程，失败不打断用户
  } finally {
    loadingMemoryCandidates.value = false
  }
}

function scheduleMemoryCandidateRefresh() {
  if (isGuest.value) return

  window.setTimeout(() => {
    loadMemoryCandidates()
  }, 1500)
}

async function confirmMemoryCandidate(id: string) {
  handlingMemoryCandidateId.value = id
  try {
    // 如果正在编辑该候选，把编辑内容传过去
    const editedContent =
      editingCandidateId.value === id ? editingCandidateContent.value.trim() || undefined : undefined
    await aiApi.confirmMemoryCandidate(id, editedContent)
    editingCandidateId.value = null
    editingCandidateContent.value = ''
    memoryCandidates.value = memoryCandidates.value.filter((item) => item.id !== id)
    // 如果记忆管理弹窗开着，同步刷新长期记忆列表
    if (memoryManagerVisible.value) {
      loadFormalMemories()
    }
    message.success('已保存到长期记忆')
  } catch {
    message.error('保存记忆失败')
  } finally {
    handlingMemoryCandidateId.value = null
  }
}

async function rejectMemoryCandidate(id: string) {
  handlingMemoryCandidateId.value = id
  try {
    await aiApi.rejectMemoryCandidate(id)
    memoryCandidates.value = memoryCandidates.value.filter((item) => item.id !== id)
    message.success('已忽略')
  } catch {
    message.error('忽略失败')
  } finally {
    handlingMemoryCandidateId.value = null
  }
}

function memoryTypeLabel(type: AiMemoryCandidate['memoryType']) {
  if (type === 'PROFILE') return '画像'
  if (type === 'PREFERENCE') return '偏好'
  if (type === 'PROJECT_STATE') return '项目'
  return type
}

function memoryActionLabel(action: AiMemoryCandidate['candidateAction']) {
  if (action === 'CREATE') return '新增'
  if (action === 'UPDATE') return '更新'
  if (action === 'MERGE') return '合并'
  if (action === 'IGNORE') return '忽略'
  return action
}

function confirmMemoryCandidateLabel(action: AiMemoryCandidate['candidateAction']) {
  return action === 'IGNORE' ? '确认忽略' : '保存'
}

async function openMemoryManager() {
  memoryManagerVisible.value = true
  memoryTab.value = pendingMemoryCount.value > 0 ? 'candidates' : 'memories'
  await Promise.all([loadMemoryCandidates(), loadFormalMemories()])
}

async function loadFormalMemories() {
  if (isGuest.value) {
    formalMemories.value = []
    return
  }

  loadingFormalMemories.value = true
  try {
    const res = await aiApi.getMemories()
    formalMemories.value = res.data ?? []
  } catch {
    message.error('加载长期记忆失败')
  } finally {
    loadingFormalMemories.value = false
  }
}

function promptDeleteMemory(id: string) {
  dialog.warning({
    title: '确认删除',
    content: '删除后 AI 不会再使用这条记忆',
    positiveText: '确认删除',
    negativeText: '取消',
    onPositiveClick: () => {
      deleteFormalMemory(id)
    },
  })
}

async function deleteFormalMemory(id: string) {
  handlingFormalMemoryId.value = id
  try {
    await aiApi.deleteMemory(id)
    formalMemories.value = formalMemories.value.filter((item) => item.id !== id)
    message.success('已删除长期记忆')
  } catch {
    message.error('删除长期记忆失败')
  } finally {
    handlingFormalMemoryId.value = null
  }
}

// ============================================================
// 行内编辑
// ============================================================

function startEditCandidate(candidate: AiMemoryCandidate) {
  editingCandidateId.value = candidate.id
  editingCandidateContent.value = candidate.content
}

function cancelEditCandidate() {
  editingCandidateId.value = null
  editingCandidateContent.value = ''
}

function startEditMemory(mem: AiMemory) {
  editingMemoryId.value = mem.id
  editingMemoryContent.value = mem.content
}

function cancelEditMemory() {
  editingMemoryId.value = null
  editingMemoryContent.value = ''
}

async function saveEditMemory(mem: AiMemory) {
  const newContent = editingMemoryContent.value.trim()
  if (!newContent) {
    message.warning('内容不能为空')
    return
  }
  handlingFormalMemoryId.value = mem.id
  try {
    await aiApi.updateMemory(mem.id, {
      memoryType: mem.memoryType,
      memoryKey: mem.memoryKey,
      content: newContent,
    })
    // 更新本地列表
    const found = formalMemories.value.find((item) => item.id === mem.id)
    if (found) {
      found.content = newContent
      found.updatedAt = new Date().toISOString()
    }
    editingMemoryId.value = null
    editingMemoryContent.value = ''
    message.success('已更新')
  } catch {
    message.error('更新失败')
  } finally {
    handlingFormalMemoryId.value = null
  }
}

function stopGeneration() {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
}

async function regenerate(aiMsgIndex: number) {
  // 确保前一条是用户消息
  if (aiMsgIndex < 1) return
  const prevMsg = messages.value[aiMsgIndex - 1]
  if (prevMsg.role !== 'user') return

  const content = prevMsg.content
  if (!content) return

  // 删掉旧的 AI 消息，用 send() 重新生成（跳过用户消息推送）
  messages.value.splice(aiMsgIndex, 1)
  await send(content, true)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function clickSuggestion(text: string) {
  send(text)
}

const suggestions = [
  { icon: '🔍', text: '有没有关于Redis的文章？' },
  { icon: '📚', text: '这篇文章主要讲什么？' },
  { icon: '💡', text: '如何设计一个AI Agent？' },
]

// ============================================================
// Watch
// ============================================================

watch(visible, async (v) => {
  if (v && !isGuest.value) {
    loadMemoryCandidates()
  }
})
</script>

<template>
  <div
    class="ai-assistant"
    :class="{ open: visible, fullscreen: isFullscreen }"
  >
    <!-- ============================================================ -->
    <!-- 悬浮按钮 -->
    <!-- ============================================================ -->
    <button
      v-if="!visible"
      class="ai-fab"
      type="button"
      title="海林BlogAI助手"
      @click="toggle"
    >
      <span class="ai-fab-emoji">🤖</span>
    </button>

    <!-- ============================================================ -->
    <!-- 聊天面板 -->
    <!-- ============================================================ -->
    <div v-if="visible" class="ai-panel" :class="{ 'is-dragging': isDragging }" :style="panelStyle">
      <!-- 顶部栏（可拖拽） -->
      <header
        class="ai-panel-header"
        :class="{ dragging: isDragging }"
        @mousedown="onHeaderMouseDown"
      >
        <div class="ai-panel-title">
          <span class="ai-panel-emoji">🤖</span>
          <span>海林BlogAI助手</span>
        </div>
        <div class="ai-panel-actions">
          <n-button size="tiny" quaternary @click="createSession">
            <template #icon>
              <n-icon :component="Add" size="16" />
            </template>
            创建会话
          </n-button>
          <n-badge :value="pendingMemoryCount" :show="pendingMemoryCount > 0" :max="99">
            <n-button v-if="!isGuest" size="tiny" quaternary @click="openMemoryManager">
              <template #icon>
                <n-icon :component="BookmarkOutline" size="16" />
              </template>
              记忆
            </n-button>
          </n-badge>
          <n-button v-if="!isGuest" size="tiny" quaternary @click="openHistory">
            <template #icon>
              <n-icon :component="Time" size="16" />
            </template>
            历史记录
          </n-button>
          <n-button size="tiny" quaternary @click="toggleFullscreen">
            <template #icon>
              <n-icon :component="isFullscreen ? Contract : Expand" size="16" />
            </template>
          </n-button>
          <n-button size="tiny" quaternary @click="toggle">
            <template #icon>
              <n-icon :component="Close" size="18" />
            </template>
          </n-button>
        </div>
      </header>

      <!-- ============================================================ -->
      <!-- 历史记录视图 -->
      <!-- ============================================================ -->
      <div v-if="viewingHistory" class="ai-history-view">
        <div class="ai-history-header">
          <n-button size="tiny" quaternary @click="closeHistory">
            <template #icon>
              <n-icon :component="ArrowBack" size="16" />
            </template>
            返回
          </n-button>
          <span class="ai-history-title">历史会话</span>
          <span class="ai-history-spacer" />
        </div>
        <div class="ai-history-list">
          <div
            v-for="s in sortedSessions"
            :key="s.id"
            class="ai-history-item"
            @click="switchSession(s.id)"
          >
            <div class="ai-history-item-left">
              <span class="ai-history-item-icon">💬</span>
              <div class="ai-history-item-info">
                <span class="ai-history-item-title">{{ s.title }}</span>
                <span class="ai-history-item-date">{{
                  new Date(s.createdAt).toLocaleDateString('zh-CN')
                }}</span>
              </div>
            </div>
            <n-button
              size="tiny"
              quaternary
              type="error"
              @click.stop="deleteSession(s.id)"
            >
              <template #icon>
                <n-icon :component="Close" size="14" />
              </template>
            </n-button>
          </div>
          <div v-if="sortedSessions.length === 0" class="ai-history-empty">
            暂无历史会话
          </div>
        </div>
      </div>

      <!-- ============================================================ -->
      <!-- 聊天 / 欢迎视图 -->
      <!-- ============================================================ -->
      <template v-else>
        <div ref="messageListRef" class="ai-body" @scroll="handleMessageListScroll">
          <!-- 消息加载中 -->
          <div v-if="loadingMessages" class="ai-loading">
            <n-spin size="small" />
          </div>

          <!-- 欢迎页 -->
          <div v-else-if="showWelcome" class="ai-welcome">
            <!-- 游客次数用完引导 -->
            <div v-if="isGuest && guestUsedCount >= 3" class="ai-guest-limit-card">
              <span class="ai-guest-limit-icon">🎉</span>
              <p class="ai-guest-limit-text">你已用完 3 次免费体验</p>
              <p class="ai-guest-limit-sub">登录后即可无限使用 AI 助手</p>
              <router-link to="/login" class="ai-guest-limit-login">去登录 →</router-link>
            </div>
            <div class="ai-welcome-card">
              <span class="ai-welcome-icon">🤖</span>
              <h3 class="ai-welcome-title">你好，我是海林BlogAI助手</h3>
              <p class="ai-welcome-subtitle">我可以帮助你：</p>
              <ul class="ai-welcome-list">
                <li>查找博客文章</li>
                <li>解答技术问题</li>
                <li>分析当前页面内容</li>
                <li>辅助学习编程知识</li>
              </ul>
            </div>

            <div class="ai-suggestions">
              <p class="ai-suggestions-label">推荐提问：</p>
              <button
                v-for="(item, i) in suggestions"
                :key="i"
                class="ai-suggestion-chip"
                type="button"
                @click="clickSuggestion(item.text)"
              >
                <span>{{ item.icon }}</span>
                <span>{{ item.text }}</span>
              </button>
            </div>
          </div>

          <!-- 消息列表 -->
          <div v-else class="ai-messages">
            <template v-for="(msg, i) in messages" :key="msg.id || i">
                <div
                  class="ai-msg"
                  :class="[msg.role, { 'has-workflow': msg.workflow }]"
                >
                <span class="ai-msg-avatar">
                  <template v-if="msg.role === 'ai'">🤖</template>
                  <img
                    v-else-if="userAvatar"
                    :src="userAvatar"
                    class="ai-user-avatar-img"
                  />
                  <template v-else>👤</template>
                </span>
                <div class="ai-msg-bubble-wrapper">
                <div v-if="msg.role === 'ai'" class="ai-msg-bubble markdown-body">
                  <span v-html="renderMarkdown(msg.content)" />
                  <span v-if="isMessageStreaming(i, msg.role)" class="ai-typing-dots"><i class="dot" /><i class="dot" /><i class="dot" /></span>
                </div>

                <!-- Agent 思考过程（V2.3）：折叠条 + 步骤列表，实时推流 -->
                <div
                  v-if="msg.role === 'ai' && msg.thinkingSteps?.length"
                  class="ai-thinking"
                >
                  <button
                    class="ai-thinking__toggle"
                    type="button"
                    @click="thinkingStepsExpanded = !thinkingStepsExpanded"
                  >
                    <span class="ai-thinking__icon">🤔</span>
                    <span class="ai-thinking__title">
                      思考过程（{{ msg.thinkingSteps.length }} 步）
                    </span>
                    <span class="ai-thinking__arrow">{{ thinkingStepsExpanded ? '▾' : '▸' }}</span>
                  </button>
                  <div v-if="thinkingStepsExpanded" class="ai-thinking__list">
                    <div
                      v-for="step in msg.thinkingSteps"
                      :key="step.stepNo"
                      class="ai-thinking__step"
                    >
                      <span class="ai-thinking__step-no">{{ step.stepNo }}</span>
                      <span
                        class="ai-thinking__step-status"
                        :class="`ai-thinking__step-status--${step.status.toLowerCase()}`"
                      >
                        {{ step.status === 'RUNNING' ? '⏳' : step.status === 'SUCCESS' ? '✓' : '✗' }}
                      </span>
                      <span class="ai-thinking__step-message">{{ step.message }}</span>
                    </div>
                  </div>
                </div>

                <div
                  v-if="msg.role === 'ai' && msg.references?.length"
                  class="ai-rag-references"
                >
                  <div class="ai-rag-title">参考来源</div>
                  <button
                    v-for="(reference, referenceIndex) in msg.references"
                    :key="`${reference.articleId}-${reference.chunkIndex}`"
                    class="ai-rag-item"
                    type="button"
                    @click="openReferenceArticle(reference)"
                  >
                    <span class="ai-rag-item-title">
                      <span class="ai-rag-item-index">[{{ referenceIndex + 1 }}]</span>
                      {{ reference.title || `文章 ${reference.articleId}` }}
                    </span>
                    <span class="ai-rag-item-snippet">{{ reference.snippet }}</span>
                    <span class="ai-rag-item-meta">片段 {{ reference.chunkIndex + 1 }}</span>
                  </button>
                </div>

                <!-- Agent Workflow 建议卡（V2.1）：Agent 基于观察建议启动学习类 Workflow，需用户确认 -->
                <div
                  v-if="msg.role === 'ai' && msg.workflowSuggestion && msg.suggestionState !== 'cancelled' && msg.suggestionState !== 'expired'"
                  class="ai-suggestion-card"
                >
                  <div class="ai-suggestion-card__head">
                    <span class="ai-suggestion-card__badge">Agent 建议</span>
                    <span class="ai-suggestion-card__type">
                      {{ msg.workflowSuggestion.workflowType === 'LEARNING_PLAN' ? '制定学习计划' : msg.workflowSuggestion.workflowType === 'LEARNING_PROGRESS' ? '调整学习进度' : msg.workflowSuggestion.workflowType === 'OPTIMIZE_ARTICLE' ? '文章优化' : '难点攻坚' }}
                    </span>
                  </div>
                  <div class="ai-suggestion-card__reason">{{ msg.workflowSuggestion.reason }}</div>
                  <div class="ai-suggestion-card__actions">
                    <n-button
                      size="small"
                      type="primary"
                      :loading="msg.suggestionState === 'processing'"
                      :disabled="msg.suggestionState === 'processing'"
                      @click="confirmSuggestion(msg)"
                    >
                      继续
                    </n-button>
                    <n-button
                      size="small"
                      :disabled="msg.suggestionState === 'processing'"
                      @click="cancelSuggestion(msg)"
                    >
                      取消
                    </n-button>
                  </div>
                </div>

                <!-- Agent 写动作确认卡（V2.4 / V3.1 / V3.3）：勾选 / 追加 / 重命名任务，需用户确认 -->
                <div
                  v-if="msg.role === 'ai' && msg.writeAction && msg.writeActionState !== 'cancelled' && msg.writeActionState !== 'expired'"
                  class="ai-write-card"
                >
                  <div class="ai-write-card__head">
                    <span class="ai-write-card__badge">写动作提案</span>
                    <span class="ai-write-card__type">
                      {{ writeActionTypeLabel(msg.writeAction) }}
                    </span>
                  </div>
                  <div class="ai-write-card__reason">
                    {{ writeActionReason(msg.writeAction) }}
                  </div>
                  <div class="ai-write-card__actions">
                    <n-button
                      size="small"
                      type="primary"
                      :loading="msg.writeActionState === 'processing'"
                      :disabled="msg.writeActionState === 'processing'"
                      @click="confirmWriteAction(msg)"
                    >
                      继续
                    </n-button>
                    <n-button
                      size="small"
                      :disabled="msg.writeActionState === 'processing'"
                      @click="cancelWriteAction(msg)"
                    >
                      取消
                    </n-button>
                  </div>
                </div>

                <!-- Workflow 卡片 -->
                <div v-if="msg.role === 'ai' && msg.workflow" class="ai-workflow-card">
                  <div class="ai-workflow-card__head">
                    <span class="ai-workflow-card__badge">
                      {{ msg.workflow.workflowType === 'OPTIMIZE_ARTICLE' ? '文章优化 Workflow' : msg.workflow.workflowType === 'LEARNING_PLAN' ? '学习规划 Workflow' : msg.workflow.workflowType === 'LEARNING_PROGRESS' ? '学习进度 Workflow' : msg.workflow.workflowType === 'LEARNING_ASSIST' ? '难点攻坚 Workflow' : '文章创作 Workflow' }}
                    </span>
                    <span
                      v-if="msg.workflow.id === activeWorkflow?.id && isTransitioning"
                      class="ai-workflow-card__status ai-workflow-card__status--loading"
                    >
                      <n-spin :size="14" />
                      <span>{{ transitionLabel }}</span>
                    </span>
                    <span v-else class="ai-workflow-card__status">
                      {{ workflowStatusLabel(msg.workflow.status) }}
                    </span>
                  </div>
                  <div class="ai-workflow-card__body">
                    <div class="ai-workflow-card__step">
                      <span class="ai-workflow-card__label">当前步骤</span>
                      <span>{{ workflowStepLabel(msg.workflow.currentStep) }}</span>
                    </div>
                    <!-- ===== 学习规划 / 学习进度 Workflow：结构化计划渲染（阶段/任务列表） ===== -->
                    <template v-if="msg.workflow.workflowType === 'LEARNING_PLAN' || msg.workflow.workflowType === 'LEARNING_PROGRESS' || msg.workflow.workflowType === 'LEARNING_ASSIST'">
                      <div
                        v-if="msg.workflow.context?.stepResults?.plan"
                        class="ai-learning-plan"
                      >
                        <h4 class="ai-learning-plan-title">
                          {{ msg.workflow.context.stepResults.plan.title || '学习计划' }}
                        </h4>
                        <div
                          v-for="(stage, si) in msg.workflow.context.stepResults.plan.stages"
                          :key="si"
                          class="ai-learning-plan-stage"
                        >
                          <p class="ai-learning-plan-stage-title">阶段 {{ si + 1 }}：{{ stage.title }}</p>
                          <ul class="ai-learning-plan-tasks">
                            <li v-for="(task, ti) in stage.tasks" :key="ti">
                              {{ typeof task === 'string' ? task : task.title }}
                            </li>
                          </ul>
                        </div>
                      </div>
                    </template>
                    <!-- ===== 创作 Workflow ===== -->
                    <template v-else-if="msg.workflow.workflowType !== 'OPTIMIZE_ARTICLE'">
                    <div v-if="msg.workflow.context?.requirement?.topic" class="ai-workflow-card__topic">
                      <span class="ai-workflow-card__label">主题</span>
                      <span>{{ msg.workflow.context.requirement.topic }}</span>
                    </div>
                    <div
                      v-if="workflowStreamingOutline[msg.workflow.id] || createCardData(msg.workflow.context).outline"
                      class="ai-workflow-card__section-title"
                    >
                      大纲：
                    </div>
                    <pre
                      v-if="workflowStreamingOutline[msg.workflow.id]"
                      class="ai-workflow-card__outline"
                    >{{ workflowStreamingOutline[msg.workflow.id] }}</pre>
                    <pre
                      v-else-if="createCardData(msg.workflow.context).outline"
                      class="ai-workflow-card__outline"
                    >{{ createCardData(msg.workflow.context).outline }}</pre>
                    <div v-else-if="createCardData(msg.workflow.context).draft?.summary" class="ai-workflow-card__summary">
                      <span class="ai-workflow-card__label">草稿摘要</span>
                      <p>{{ createCardData(msg.workflow.context).draft?.summary }}</p>
                    </div>
                    <div
                      v-if="workflowStreamingContent[msg.workflow.id] || createCardData(msg.workflow.context).draft?.content"
                      class="ai-workflow-card__section-title"
                    >
                      草稿：
                    </div>
                    <pre
                      v-if="workflowStreamingContent[msg.workflow.id]"
                      class="ai-workflow-card__stream-content"
                    >{{ workflowStreamingContent[msg.workflow.id] }}</pre>
                    <pre
                      v-else-if="createCardData(msg.workflow.context).draft?.content"
                      class="ai-workflow-card__stream-content"
                    >{{ createCardData(msg.workflow.context).draft?.content }}</pre>
                    <div v-if="createCardData(msg.workflow.context).qualityCheck?.passed !== undefined" class="ai-workflow-card__quality">
                      <span class="ai-workflow-card__label">质量检查</span>
                      <span :class="createCardData(msg.workflow.context).qualityCheck?.passed === false ? 'ai-workflow-card__quality--bad' : 'ai-workflow-card__quality--good'">
                        {{ createCardData(msg.workflow.context).qualityCheck?.passed === false ? '未通过' : '通过' }}
                      </span>

                      <div v-if="createCardData(msg.workflow.context).qualityCheck?.issues?.length" class="ai-workflow-card__quality-block">
                        <div class="ai-workflow-card__quality-title">问题</div>
                        <ul class="ai-workflow-card__quality-list">
                          <li v-for="(item, index) in createCardData(msg.workflow.context).qualityCheck?.issues" :key="index">
                            {{ item }}
                          </li>
                        </ul>
                      </div>

                      <div v-if="createCardData(msg.workflow.context).qualityCheck?.suggestions?.length" class="ai-workflow-card__quality-block">
                        <div class="ai-workflow-card__quality-title">建议</div>
                        <ul class="ai-workflow-card__quality-list">
                          <li v-for="(item, index) in createCardData(msg.workflow.context).qualityCheck?.suggestions" :key="index">
                            {{ item }}
                          </li>
                        </ul>
                      </div>
                    </div>
                    </template>

                    <!-- ===== 优化 Workflow ===== -->
                    <template v-else>
                    <div v-if="msg.workflow.context?.stepResults?.article?.title" class="ai-workflow-card__topic">
                      <span class="ai-workflow-card__label">优化文章</span>
                      <span>{{ msg.workflow.context.stepResults.article.title }}</span>
                    </div>
                    <div
                      v-if="workflowStreamingOutline[msg.workflow.id] || msg.workflow.context?.stepResults?.optimizationPlan"
                      class="ai-workflow-card__section-title"
                    >
                      优化方案：
                    </div>
                    <pre
                      v-if="workflowStreamingOutline[msg.workflow.id]"
                      class="ai-workflow-card__outline"
                    >{{ workflowStreamingOutline[msg.workflow.id] }}</pre>
                    <pre
                      v-else-if="msg.workflow.context?.stepResults?.optimizationPlan"
                      class="ai-workflow-card__outline"
                    >{{ msg.workflow.context.stepResults.optimizationPlan }}</pre>
                    <div
                      v-if="workflowStreamingContent[msg.workflow.id] || msg.workflow.context?.stepResults?.optimizedContent"
                      class="ai-workflow-card__section-title"
                    >
                      优化草稿：
                    </div>
                    <pre
                      v-if="workflowStreamingContent[msg.workflow.id]"
                      class="ai-workflow-card__stream-content"
                    >{{ workflowStreamingContent[msg.workflow.id] }}</pre>
                    <pre
                      v-else-if="msg.workflow.context?.stepResults?.optimizedContent"
                      class="ai-workflow-card__stream-content"
                    >{{ msg.workflow.context.stepResults.optimizedContent }}</pre>
                    <div v-if="msg.workflow.context?.stepResults?.contentCheck && msg.workflow.context.stepResults.contentCheck.passed !== undefined" class="ai-workflow-card__quality">
                      <span class="ai-workflow-card__label">内容检查</span>
                      <span :class="msg.workflow.context.stepResults.contentCheck.passed === false ? 'ai-workflow-card__quality--bad' : 'ai-workflow-card__quality--good'">
                        {{ msg.workflow.context.stepResults.contentCheck.passed === false ? '未通过' : '通过' }}
                      </span>

                      <div v-if="msg.workflow.context.stepResults.contentCheck.issues?.length" class="ai-workflow-card__quality-block">
                        <div class="ai-workflow-card__quality-title">问题</div>
                        <ul class="ai-workflow-card__quality-list">
                          <li v-for="(item, index) in msg.workflow.context.stepResults.contentCheck.issues" :key="index">
                            {{ item }}
                          </li>
                        </ul>
                      </div>

                      <div v-if="msg.workflow.context.stepResults.contentCheck.suggestions?.length" class="ai-workflow-card__quality-block">
                        <div class="ai-workflow-card__quality-title">建议</div>
                        <ul class="ai-workflow-card__quality-list">
                          <li v-for="(item, index) in msg.workflow.context.stepResults.contentCheck.suggestions" :key="index">
                            {{ item }}
                          </li>
                        </ul>
                      </div>
                    </div>
                    </template>

                    <!-- 执行详情（步骤日志，点开才加载） -->
                    <div class="ai-workflow-step-log">
                      <button
                        class="ai-workflow-step-log__toggle"
                        type="button"
                        @click="toggleWorkflowStepLogs(msg.workflow.id)"
                      >
                        <span>执行详情</span>
                        <span>{{ workflowStepLogsExpanded[msg.workflow.id] ? '收起' : '展开' }}</span>
                      </button>

                      <div v-if="workflowStepLogsExpanded[msg.workflow.id]" class="ai-workflow-step-log__body">
                        <div
                          v-if="workflowStepLogsLoading[msg.workflow.id]"
                          class="ai-workflow-step-log__empty"
                        >
                          加载中...
                        </div>

                        <div
                          v-else-if="!workflowStepLogs[msg.workflow.id]?.length"
                          class="ai-workflow-step-log__empty"
                        >
                          暂无执行日志
                        </div>

                        <div
                          v-else
                          v-for="log in workflowStepLogs[msg.workflow.id]"
                          :key="log.id"
                          class="ai-workflow-step-log__item"
                        >
                          <div class="ai-workflow-step-log__head">
                            <span class="ai-workflow-step-log__step">
                              {{ log.stepOrder ? `第 ${log.stepOrder} 步 · ` : '' }}{{ workflowStepLabel(log.step) }}
                            </span>
                            <span
                              v-if="log.logType"
                              class="ai-workflow-step-log__type"
                              :class="log.logType === 'STEP' ? 'is-step' : 'is-operation'"
                            >
                              {{ log.logType === 'STEP' ? '步骤' : '操作' }}
                            </span>
                            <span
                              class="ai-workflow-step-log__status"
                              :class="workflowStepStatusClass(log.status)"
                            >
                              {{ workflowStepStatusLabel(log.status) }}
                            </span>
                          </div>

                          <div class="ai-workflow-step-log__meta">
                            <span>耗时 {{ formatDuration(log.durationMs) }}</span>
                            <span v-if="log.retryCount">重试 {{ log.retryCount }}</span>
                            <span v-if="log.inputTokens || log.outputTokens">
                              token {{ log.inputTokens ?? 0 }} / {{ log.outputTokens ?? 0 }}
                            </span>
                          </div>

                          <div v-if="log.inputSummary" class="ai-workflow-step-log__summary">
                            <strong>输入：</strong>{{ log.inputSummary }}
                          </div>

                          <div v-if="log.outputSummary" class="ai-workflow-step-log__summary">
                            <strong>输出：</strong>{{ log.outputSummary }}
                          </div>

                          <div v-if="log.errorMessage" class="ai-workflow-step-log__error">
                            {{ log.errorMessage }}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div v-else-if="msg.role !== 'ai'" class="ai-msg-bubble">{{ msg.content }}</div>
                <div class="ai-msg-meta">
                  <div v-if="msg.role === 'ai'" class="ai-msg-actions">
                    <button
                      class="ai-msg-action-btn"
                      :class="{ 'is-copied': msg.copied }"
                      title="复制"
                      @click="copyMessage(msg)"
                    >
                      <n-icon :component="msg.copied ? CheckmarkOutline : CopyOutline" size="15" />
                    </button>
                    <button class="ai-msg-action-btn" title="重新生成" @click="regenerate(i)">
                      <n-icon :component="RefreshOutline" size="15" />
                    </button>
                    <button class="ai-msg-action-btn" title="删除" @click="deleteMessage(i)">
                      <n-icon :component="TrashOutline" size="15" />
                    </button>
                  </div>
                  <div v-else class="ai-msg-actions">
                    <button
                      class="ai-msg-action-btn"
                      :class="{ 'is-copied': msg.copied }"
                      title="复制"
                      @click="copyMessage(msg)"
                    >
                      <n-icon :component="msg.copied ? CheckmarkOutline : CopyOutline" size="15" />
                    </button>
                    <button class="ai-msg-action-btn" title="删除" @click="deleteMessage(i)">
                      <n-icon :component="TrashOutline" size="15" />
                    </button>
                  </div>
                  <span class="ai-msg-time">{{ formatMessageTime(msg.createdAt) }}</span>
                </div>
              </div>
              </div>

              <!-- 会话压缩状态：固定插在已压缩消息之后，后续新消息显示在提示下面 -->
              <div
                v-if="compressionPhase !== 'idle' && i + 1 === compressionCoveredMessageCount"
                class="ai-compression-note"
              >
                <div
                  v-if="compressionPhase === 'compressing' || compressionPhase === 'done'"
                  class="ai-compression-note-line is-muted"
                >
                  正在自动压缩上下文
                </div>
                <div v-if="compressionPhase === 'done'" class="ai-compression-note-line">
                  已完成上下文压缩
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Workflow 过渡面板（点击同意/拒绝/完成/取消后，后端处理中） -->
        <footer v-if="isTransitioning" class="ai-input-area">
          <div class="ai-workflow-panel ai-workflow-panel--transition">
            <n-spin size="small" />
            <span class="ai-workflow-transition-label">{{ transitionLabel }}</span>
          </div>
        </footer>

        <!-- Workflow 需求确认面板（无同意/不同意，直接输入） -->
        <footer v-else-if="workflowNeedRequirement" class="ai-input-area">
          <div class="ai-workflow-panel">
            <div class="ai-workflow-head">
              <span class="ai-workflow-badge">
                {{ activeWorkflow?.workflowType === 'OPTIMIZE_ARTICLE' ? '文章优化 Workflow' : activeWorkflow?.workflowType === 'LEARNING_PLAN' ? '学习规划 Workflow' : activeWorkflow?.workflowType === 'LEARNING_PROGRESS' ? '学习进度 Workflow' : activeWorkflow?.workflowType === 'LEARNING_ASSIST' ? '难点攻坚 Workflow' : '文章创作 Workflow' }}
              </span>
              <span class="ai-workflow-status">{{ workflowStatusLabel(activeWorkflow?.status) }}</span>
            </div>

            <div class="ai-workflow-reject">
              <textarea
                v-model="workflowFeedback"
                class="ai-workflow-feedback"
                rows="2"
                :placeholder="activeWorkflow?.context?.confirmation?.question ?? '请补充写作主题'"
                :disabled="workflowBusy"
              />
              <div class="ai-workflow-reject-actions">
                <button
                  class="ai-workflow-btn ai-workflow-btn--ghost"
                  type="button"
                  :disabled="workflowBusy"
                  @click="cancelWorkflow"
                >
                  取消工作流
                </button>
                <button
                  class="ai-workflow-btn ai-workflow-btn--primary"
                  type="button"
                  :disabled="workflowBusy || !workflowFeedback.trim()"
                  @click="rejectWorkflow"
                >
                  发送
                </button>
              </div>
            </div>
          </div>
        </footer>

        <!-- Workflow 确认面板（同意/不同意） -->
        <footer v-else-if="workflowWaitingConfirm" class="ai-input-area">
          <div class="ai-workflow-panel">
            <div class="ai-workflow-head">
              <span class="ai-workflow-badge">
                {{ activeWorkflow?.workflowType === 'OPTIMIZE_ARTICLE' ? '文章优化 Workflow' : activeWorkflow?.workflowType === 'LEARNING_PLAN' ? '学习规划 Workflow' : activeWorkflow?.workflowType === 'LEARNING_PROGRESS' ? '学习进度 Workflow' : activeWorkflow?.workflowType === 'LEARNING_ASSIST' ? '难点攻坚 Workflow' : '文章创作 Workflow' }}
              </span>
              <span
                v-if="workflowDraftNeedsFix"
                class="ai-workflow-status ai-workflow-status--bad"
              >{{ activeWorkflow?.workflowType === 'OPTIMIZE_ARTICLE' ? '优化结果未通过检查，请提修改意见' : '草稿未通过检查，请提修改意见' }}</span>
              <span v-else class="ai-workflow-status">{{ workflowStatusLabel(activeWorkflow?.status) }}</span>
            </div>

            <!-- 学习规划：确认卡片 type 为 LEARNING_PLAN 时按结构化计划渲染 -->
            <div
              v-if="workflowConfirmation?.type === 'LEARNING_PLAN' && workflowLearningPlan"
              class="ai-learning-plan"
            >
              <h4 class="ai-learning-plan-title">{{ workflowLearningPlan.title || '学习计划' }}</h4>
              <div
                v-for="(stage, si) in workflowLearningPlan.stages"
                :key="si"
                class="ai-learning-plan-stage"
              >
                <p class="ai-learning-plan-stage-title">阶段 {{ si + 1 }}：{{ stage.title }}</p>
                <ul class="ai-learning-plan-tasks">
                  <li v-for="(task, ti) in stage.tasks" :key="ti">
                    {{ typeof task === 'string' ? task : task.title }}
                  </li>
                </ul>
              </div>
            </div>

            <div v-if="workflowDraftNeedsFix || workflowRejectEditing" class="ai-workflow-reject">
              <textarea
                v-model="workflowFeedback"
                class="ai-workflow-feedback"
                rows="2"
                :placeholder="workflowDraftNeedsFix
                  ? (activeWorkflow?.workflowType === 'OPTIMIZE_ARTICLE'
                    ? '优化结果未通过检查，请输入修改意见后重写'
                    : '草稿未通过质量检查，请输入修改意见后重写')
                  : '请输入修改意见...'"
                :disabled="workflowBusy"
              />
              <div class="ai-workflow-reject-actions">
                <button
                  v-if="!workflowDraftNeedsFix"
                  class="ai-workflow-btn ai-workflow-btn--ghost"
                  type="button"
                  :disabled="workflowBusy"
                  @click="resetWorkflowRejectUI"
                >
                  取消
                </button>
                <button
                  class="ai-workflow-btn ai-workflow-btn--no"
                  type="button"
                  :disabled="workflowBusy"
                  @click="cancelWorkflow"
                >
                  取消工作流
                </button>
                <button
                  class="ai-workflow-btn ai-workflow-btn--primary"
                  type="button"
                  :disabled="workflowBusy || !workflowFeedback.trim()"
                  @click="rejectWorkflow"
                >
                  {{ workflowDraftNeedsFix ? '发送修改意见' : '发送' }}
                </button>
              </div>
            </div>

            <div v-else class="ai-workflow-actions">
              <button
                class="ai-workflow-btn ai-workflow-btn--ok"
                type="button"
                :disabled="workflowBusy || workflowHasBlockingIssues"
                @click="approveWorkflow"
              >
                同意
              </button>
              <button
                class="ai-workflow-btn ai-workflow-btn--no"
                type="button"
                :disabled="workflowBusy"
                @click="workflowRejectEditing = true"
              >
                不同意
              </button>
              <button
                class="ai-workflow-btn ai-workflow-btn--ghost"
                type="button"
                :disabled="workflowBusy"
                @click="cancelWorkflow"
              >
                取消
              </button>
            </div>
          </div>
        </footer>

        <!-- Workflow 失败面板（可重试或取消） -->
        <footer v-else-if="workflowFailed" class="ai-input-area">
          <div class="ai-workflow-panel">
            <div class="ai-workflow-head">
              <span class="ai-workflow-badge">
                {{ activeWorkflow?.workflowType === 'OPTIMIZE_ARTICLE' ? '文章优化 Workflow' : activeWorkflow?.workflowType === 'LEARNING_PLAN' ? '学习规划 Workflow' : activeWorkflow?.workflowType === 'LEARNING_PROGRESS' ? '学习进度 Workflow' : activeWorkflow?.workflowType === 'LEARNING_ASSIST' ? '难点攻坚 Workflow' : '文章创作 Workflow' }}
              </span>
              <span class="ai-workflow-status ai-workflow-status--bad">
                {{ workflowStatusLabel(activeWorkflow?.status) }}
              </span>
            </div>

            <div v-if="activeWorkflow?.errorMessage" class="ai-workflow-error">
              {{ activeWorkflow.errorMessage }}
            </div>

            <div class="ai-workflow-actions">
              <button
                class="ai-workflow-btn ai-workflow-btn--ok"
                type="button"
                :disabled="workflowBusy"
                @click="retryWorkflow"
              >
                重试
              </button>
              <button
                class="ai-workflow-btn ai-workflow-btn--no"
                type="button"
                :disabled="workflowBusy"
                @click="cancelWorkflow"
              >
                取消
              </button>
            </div>
          </div>
        </footer>

        <!-- 普通输入区 -->
        <footer v-else class="ai-input-area">
          <n-button
            size="small"
            quaternary
            title="附加页面上下文（即将上线）"
            disabled
          >
            <template #icon>
              <n-icon :component="Attach" size="18" />
            </template>
          </n-button>
          <textarea
            v-model="input"
            class="ai-input"
            placeholder="输入你的问题…"
            :disabled="sending"
            rows="1"
            @keydown="onKeydown"
          />
          <button
            v-if="sending"
            class="ai-stop-btn"
            type="button"
            @click="stopGeneration()"
          >
            <n-icon :component="StopCircleOutline" size="18" />
          </button>
          <button
            v-else
            class="ai-send-btn"
            type="button"
            :disabled="!input.trim()"
            @click="send()"
          >
            <n-icon :component="Send" size="18" />
          </button>
        </footer>
      </template>

      <!-- 边缘缩放手柄 -->
      <div class="ai-resize-h resize-n" @mousedown="onResizeStart($event, 'n')" />
      <div class="ai-resize-h resize-s" @mousedown="onResizeStart($event, 's')" />
      <div class="ai-resize-h resize-e" @mousedown="onResizeStart($event, 'e')" />
      <div class="ai-resize-h resize-w" @mousedown="onResizeStart($event, 'w')" />
      <div class="ai-resize-h resize-ne" @mousedown="onResizeStart($event, 'ne')" />
      <div class="ai-resize-h resize-nw" @mousedown="onResizeStart($event, 'nw')" />
      <div class="ai-resize-h resize-se" @mousedown="onResizeStart($event, 'se')" />
      <div class="ai-resize-h resize-sw" @mousedown="onResizeStart($event, 'sw')" />
    </div>

    <!-- 记忆管理模态框 -->
    <n-modal
      v-model:show="memoryManagerVisible"
      preset="card"
      title="记忆管理"
      size="small"
      closable
      :bordered="false"
      :mask-closable="false"
      class="ai-memory-modal"
      style="width: min(640px, calc(100vw - 32px));"
    >
      <template #header-extra>
        <n-tabs
          :value="memoryTab"
          size="small"
          class="ai-memory-tabs"
          @update:value="(v: string) => memoryTab = v as 'candidates' | 'memories'"
        >
          <n-tab-pane name="candidates" tab="待确认" />
          <n-tab-pane name="memories" tab="长期记忆" />
        </n-tabs>
      </template>

      <!-- 待确认记忆 -->
      <div v-if="memoryTab === 'candidates'" class="ai-memory-tab-body">
        <div v-if="loadingMemoryCandidates" class="ai-memory-empty">
          加载中...
        </div>

        <div v-else-if="memoryCandidates.length === 0" class="ai-memory-empty">
          暂无待确认记忆
        </div>

        <div v-else class="ai-memory-list">
          <div
            v-for="candidate in memoryCandidates"
            :key="candidate.id"
            class="ai-memory-item"
          >
            <div class="ai-memory-item-head">
              <span class="ai-memory-type">
                {{ memoryTypeLabel(candidate.memoryType) }}
                <span class="ai-memory-key">{{ candidate.memoryKey }}</span>
              </span>
              <span class="ai-memory-importance">重要性 {{ candidate.importance ?? 5 }}</span>
            </div>

            <div class="ai-memory-meta-row">
              <span class="ai-memory-action" :class="`ai-memory-action--${candidate.candidateAction.toLowerCase()}`">
                {{ memoryActionLabel(candidate.candidateAction) }}
              </span>
              <span v-if="candidate.targetMemoryId" class="ai-memory-target">
                目标 #{{ candidate.targetMemoryId }}
              </span>
            </div>

            <!-- 编辑模式 -->
            <textarea
              v-if="editingCandidateId === candidate.id"
              v-model="editingCandidateContent"
              class="ai-memory-edit-input"
              rows="3"
            />
            <div v-else class="ai-memory-content">{{ candidate.content }}</div>

            <div v-if="candidate.mergedContent" class="ai-memory-merged">
              合并后：{{ candidate.mergedContent }}
            </div>

            <div v-if="candidate.reason" class="ai-memory-reason">
              {{ candidate.reason }}
            </div>

            <div v-if="candidate.decisionReason" class="ai-memory-reason">
              决策：{{ candidate.decisionReason }}
            </div>

            <div class="ai-memory-actions">
              <!-- 编辑模式操作 -->
              <template v-if="editingCandidateId === candidate.id">
                <n-button size="tiny" quaternary @click="cancelEditCandidate">
                  取消
                </n-button>
                <n-button
                  size="tiny"
                  type="primary"
                  :loading="handlingMemoryCandidateId === candidate.id"
                  @click="confirmMemoryCandidate(candidate.id)"
                >
                  保存
                </n-button>
                <n-button
                  size="tiny"
                  quaternary
                  :loading="handlingMemoryCandidateId === candidate.id"
                  @click="rejectMemoryCandidate(candidate.id)"
                >
                  忽略
                </n-button>
              </template>
              <!-- 普通模式操作 -->
              <template v-else>
                <n-button size="tiny" quaternary @click="startEditCandidate(candidate)">
                  编辑
                </n-button>
                <n-button
                  size="tiny"
                  type="primary"
                  :loading="handlingMemoryCandidateId === candidate.id"
                  @click="confirmMemoryCandidate(candidate.id)"
                >
                  {{ confirmMemoryCandidateLabel(candidate.candidateAction) }}
                </n-button>
                <n-button
                  size="tiny"
                  quaternary
                  :loading="handlingMemoryCandidateId === candidate.id"
                  @click="rejectMemoryCandidate(candidate.id)"
                >
                  忽略
                </n-button>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- 长期记忆 -->
      <div v-else class="ai-memory-tab-body">
        <div v-if="loadingFormalMemories" class="ai-memory-empty">
          加载中...
        </div>

        <div v-else-if="formalMemories.length === 0" class="ai-memory-empty">
          暂无长期记忆
        </div>

        <div v-else class="ai-memory-list">
          <div
            v-for="mem in formalMemories"
            :key="mem.id"
            class="ai-memory-item"
          >
            <div class="ai-memory-item-head">
              <span class="ai-memory-type">
                {{ memoryTypeLabel(mem.memoryType) }}
                <span class="ai-memory-key">{{ mem.memoryKey }}</span>
              </span>
              <span class="ai-memory-importance">重要性 {{ mem.importance ?? 5 }}</span>
            </div>

            <!-- 编辑模式 -->
            <textarea
              v-if="editingMemoryId === mem.id"
              v-model="editingMemoryContent"
              class="ai-memory-edit-input"
              rows="3"
            />
            <div v-else class="ai-memory-content">{{ mem.content }}</div>

            <div v-if="mem.source" class="ai-memory-source">
              来源：{{ mem.source }}
            </div>

            <div class="ai-memory-actions">
              <span class="ai-memory-date">{{ new Date(mem.updatedAt).toLocaleDateString('zh-CN') }}</span>
              <!-- 编辑模式操作 -->
              <template v-if="editingMemoryId === mem.id">
                <n-button size="tiny" quaternary @click="cancelEditMemory">
                  取消
                </n-button>
                <n-button
                  size="tiny"
                  type="primary"
                  :loading="handlingFormalMemoryId === mem.id"
                  @click="saveEditMemory(mem)"
                >
                  保存
                </n-button>
              </template>
              <!-- 普通模式操作 -->
              <template v-else>
                <n-button size="tiny" quaternary @click="startEditMemory(mem)">
                  编辑
                </n-button>
                <n-button
                  size="tiny"
                  quaternary
                  type="error"
                  :loading="handlingFormalMemoryId === mem.id"
                  @click="promptDeleteMemory(mem.id)"
                >
                  删除
                </n-button>
              </template>
            </div>
          </div>
        </div>
      </div>
    </n-modal>
  </div>
</template>

<style scoped>
/* ============================================================
   Container
   ============================================================ */

.ai-assistant {
  position: fixed;
  right: 24px;
  bottom: 120px;
  z-index: 1000;
  pointer-events: none;
}

/* ============================================================
   FAB
   ============================================================ */

.ai-fab {
  width: 56px;
  height: 56px;
  border: 0;
  border-radius: 50%;
  background: #2f6f73;
  box-shadow: 0 4px 16px rgba(47, 111, 115, 0.36);
  cursor: pointer;
  pointer-events: auto;
  display: grid;
  place-items: center;
  transition: transform 0.2s, box-shadow 0.2s;
}

.ai-fab:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 24px rgba(47, 111, 115, 0.48);
}

.ai-fab-emoji {
  font-size: 26px;
  line-height: 1;
}

/* ============================================================
   Panel
   ============================================================ */

.ai-panel {
  width: 500px;
  height: 560px;
  min-width: 360px;
  min-height: 400px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 140px); /* 120px(bottom) + 20px 保险，避免盖住顶部 header */
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  pointer-events: auto;
  animation: ai-panel-in 0.24s ease-out;
  transition: width 0.3s, height 0.3s;
}

/* 拖拽中禁用动画 */
.ai-panel.is-dragging {
  transition: none;
}

/* 全屏：容器铺满视口，面板 100% 填充 */
.ai-assistant.fullscreen {
  top: 24px;
  left: 24px;
  right: 24px;
  bottom: 24px;
}

.ai-assistant.fullscreen .ai-panel {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  max-width: none;
  max-height: none;
}

/* 全屏隐藏缩放手柄 */
.ai-assistant.fullscreen .ai-resize-h {
  display: none;
}

@keyframes ai-panel-in {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

/* ============================================================
   Header
   ============================================================ */

.ai-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid #eef0f2;
  background: #fbfdfc;
  flex-shrink: 0;
  gap: 8px;
  cursor: grab;
  user-select: none;
}

.ai-panel-header.dragging {
  cursor: grabbing;
}

.ai-panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: #1f2937;
  white-space: nowrap;
}

.ai-panel-emoji {
  font-size: 22px;
}

.ai-panel-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

/* ============================================================
   Body
   ============================================================ */

.ai-body {
  position: relative;
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* 加载态 */
.ai-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ---- 欢迎页 ---- */

.ai-welcome {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 20px;
  gap: 20px;
  overflow-y: auto;
}

.ai-welcome-card {
  width: 100%;
  background: #f8fafa;
  border: 1px solid #e6eded;
  border-radius: 12px;
  padding: 24px 20px;
  text-align: center;
}

.ai-welcome-icon {
  font-size: 48px;
  display: block;
  margin-bottom: 12px;
}

.ai-welcome-title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 700;
  color: #1f2937;
}

.ai-welcome-subtitle {
  margin: 0 0 10px;
  font-size: 14px;
  color: #6b7280;
}

.ai-welcome-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ai-welcome-list li {
  font-size: 14px;
  color: #374151;
}

.ai-welcome-list li::before {
  content: '• ';
  color: #2f6f73;
  font-weight: 700;
}

/* ---- 推荐提问 ---- */

.ai-suggestions {
  width: 100%;
}

.ai-suggestions-label {
  margin: 0 0 10px;
  font-size: 13px;
  color: #9ca3af;
  font-weight: 500;
}

.ai-suggestion-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 10px 14px;
  margin-bottom: 8px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
  font-size: 13px;
  color: #374151;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  text-align: left;
}

.ai-suggestion-chip:hover {
  border-color: #2f6f73;
  background: #f0f7f7;
}

/* ---- 消息列表 ---- */

.ai-messages {
  flex: 1;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ai-msg {
  display: flex;
  gap: 8px;
  max-width: 88%;
}

.ai-msg.user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.ai-msg.ai {
  align-self: flex-start;
}

.ai-msg.ai.has-workflow {
  width: 88%;
}

.ai-msg.ai.has-workflow .ai-msg-bubble-wrapper {
  flex: 1 1 0;
}

.ai-msg.ai.has-workflow .ai-msg-bubble {
  display: table;
  max-width: 100%;
}

.ai-msg-avatar {
  font-size: 20px;
  line-height: 1;
  flex-shrink: 0;
  margin-top: 2px;
}

.ai-user-avatar-img {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
}

.ai-msg-bubble {
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

.ai-msg.user .ai-msg-bubble {
  background: #2f6f73;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.ai-msg.ai .ai-msg-bubble {
  background: #f3f4f6;
  color: #1f2937;
  border-bottom-left-radius: 4px;
}

.ai-compression-note {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px 0 0;
  margin-top: 2px;
  pointer-events: none;
}

.ai-compression-note-line {
  font-size: 12px;
  line-height: 1.4;
  color: rgba(120, 130, 145, 0.72);
}

.ai-compression-note-line.is-muted {
  color: rgba(120, 130, 145, 0.5);
}

/* ---- RAG 引用列表 ---- */

.ai-rag-references {
  margin-top: 8px;
  padding: 9px;
  border: 1px solid #d8e7e5;
  border-radius: 8px;
  background: #f7fbfa;
}

.ai-rag-title {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #2f6f73;
}

.ai-rag-item {
  display: block;
  width: 100%;
  padding: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.ai-rag-item:hover {
  background: #eef7f6;
}

.ai-rag-item + .ai-rag-item {
  margin-top: 4px;
}

.ai-rag-item-title {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: #1f2937;
  line-height: 1.4;
}

.ai-rag-item-index {
  margin-right: 6px;
  color: #2f6f73;
}

.ai-rag-item-snippet {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.45;
  color: #4b5563;
}

.ai-rag-item-meta {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: #7c8f8d;
}

/* ---- 消息操作按钮与时间戳 ---- */

.ai-msg-bubble-wrapper {
  position: relative;
  min-width: 0;
}

.ai-msg-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
}

.ai-msg-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}

.ai-msg-bubble-wrapper:hover .ai-msg-actions {
  opacity: 1;
}

.ai-msg-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid #e5e7eb;
  border-radius: 5px;
  background: #fff;
  color: #888;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.ai-msg-action-btn:hover {
  color: #2f6f73;
  border-color: #2f6f73;
  background: #f0f9f9;
}

.ai-msg-action-btn.is-copied,
.ai-msg-action-btn.is-copied:hover {
  color: #18a058;
  border-color: #18a058;
  background: #f0faf4;
}

.ai-msg-time {
  font-size: 11px;
  color: #bbb;
  flex-shrink: 0;
}

/* 打字动画 */
.typing {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 14px 18px;
}

.typing .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #9ca3af;
  animation: typing-bounce 1.4s infinite ease-in-out both;
}

.typing .dot:nth-child(1) {
  animation-delay: 0s;
}
.typing .dot:nth-child(2) {
  animation-delay: 0.16s;
}
.typing .dot:nth-child(3) {
  animation-delay: 0.32s;
}

@keyframes typing-bounce {
  0%,
  80%,
  100% {
    transform: scale(0.6);
    opacity: 0.4;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

/* ============================================================
   Input
   ============================================================ */

.ai-input-area {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid #eef0f2;
  flex-shrink: 0;
}

.ai-input {
  flex: 1;
  padding: 9px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
  background: #f9fafb;
  font-family: inherit;
  line-height: 1.5;
  resize: none;
  max-height: 120px;
}

.ai-input:focus {
  border-color: #2f6f73;
  background: #fff;
}

.ai-input::placeholder {
  color: #9ca3af;
}

.ai-send-btn {
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 8px;
  background: #2f6f73;
  color: #fff;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background 0.15s, opacity 0.15s;
  flex-shrink: 0;
}

.ai-send-btn:hover:not(:disabled) {
  background: #25595d;
}

.ai-send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ai-stop-btn {
  width: 38px;
  height: 38px;
  border: 0;
  border-radius: 8px;
  background: #e74c3c;
  color: #fff;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background 0.15s;
  flex-shrink: 0;
}

.ai-stop-btn:hover {
  background: #c0392b;
}

/* ============================================================
   History View
   ============================================================ */

.ai-history-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ai-history-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid #eef0f2;
  flex-shrink: 0;
}

.ai-history-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
}

.ai-history-spacer {
  flex: 1;
}

.ai-history-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.ai-history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.ai-history-item:hover {
  background: #f3f4f6;
}

.ai-history-item-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.ai-history-item-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.ai-history-item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ai-history-item-title {
  font-size: 14px;
  font-weight: 500;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-history-item-date {
  font-size: 12px;
  color: #9ca3af;
}

.ai-history-empty {
  text-align: center;
  color: #9ca3af;
  font-size: 14px;
  padding: 40px 0;
}

/* ============================================================
   Markdown 渲染样式
   ============================================================ */

.markdown-body :deep(p) {
  margin: 0 0 8px;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  margin: 12px 0 6px;
  font-weight: 600;
  color: #1f2937;
}

.markdown-body :deep(h1) { font-size: 1.25em; }
.markdown-body :deep(h2) { font-size: 1.15em; }
.markdown-body :deep(h3) { font-size: 1.05em; }

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 4px 0 8px;
  padding-left: 18px;
}

.markdown-body :deep(li) {
  margin-bottom: 2px;
}

.markdown-body :deep(a) {
  color: #2f6f73;
}

.markdown-body :deep(blockquote) {
  margin: 8px 0;
  padding: 4px 12px;
  border-left: 3px solid #2f6f73;
  background: #f0f7f7;
  border-radius: 0 4px 4px 0;
  color: #555;
}

.markdown-body :deep(table) {
  width: 100%;
  margin: 8px 0;
  border-collapse: collapse;
  font-size: 13px;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 6px 10px;
  border: 1px solid #e5e7eb;
  text-align: left;
}

.markdown-body :deep(th) {
  background: #f3f4f6;
  font-weight: 600;
}

/* 行内代码 */
.markdown-body :deep(code:not(pre code)) {
  padding: 1px 5px;
  border-radius: 3px;
  background: #f0f0f0;
  color: #d63384;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 0.88em;
}

/* 代码块 */
.markdown-body :deep(pre) {
  margin: 8px 0;
  padding: 12px;
  border-radius: 6px;
  background: #1e1e1e;
  overflow-x: auto;
  line-height: 1.5;
}

.markdown-body :deep(pre code) {
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 13px;
  color: #d4d4d4;
  background: none;
  padding: 0;
}

.markdown-body :deep(hr) {
  margin: 12px 0;
  border: 0;
  border-top: 1px solid #e5e7eb;
}

/* 图片 */
.markdown-body :deep(img) {
  max-width: 100%;
  border-radius: 4px;
}

/* ============================================================
   打字省略号动画
   ============================================================ */

.ai-typing-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 2px;
  vertical-align: middle;
}

.ai-typing-dots .dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #9ca3af;
  animation: typing-dot-bounce 1.4s infinite ease-in-out both;
}

.ai-typing-dots .dot:nth-child(1) { animation-delay: 0s; }
.ai-typing-dots .dot:nth-child(2) { animation-delay: 0.2s; }
.ai-typing-dots .dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing-dot-bounce {
  0%, 80%, 100% { transform: scale(0.4); opacity: 0.3; }
  40% { transform: scale(1); opacity: 1; }
}

/* ============================================================
   游客次数用完引导卡片
   ============================================================ */

.ai-guest-limit-card {
  width: 100%;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 10px;
  padding: 18px 16px;
  text-align: center;
  margin-bottom: 16px;
}

.ai-guest-limit-icon {
  font-size: 32px;
  display: block;
  margin-bottom: 6px;
}

.ai-guest-limit-text {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: #92400e;
}

.ai-guest-limit-sub {
  margin: 0 0 12px;
  font-size: 13px;
  color: #a16207;
}

.ai-guest-limit-login {
  display: inline-block;
  padding: 5px 16px;
  border-radius: 6px;
  background: #2f6f73;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  transition: background 0.15s;
}

.ai-guest-limit-login:hover {
  background: #25595d;
}

/* ============================================================
   Resize handles（边缘缩放）
   ============================================================ */

.ai-resize-h {
  position: absolute;
  z-index: 10;
}

/* 四边 */
.resize-n { top: 0; left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.resize-s { bottom: 0; left: 8px; right: 8px; height: 6px; cursor: ns-resize; }
.resize-e { right: 0; top: 8px; bottom: 8px; width: 6px; cursor: ew-resize; }
.resize-w { left: 0; top: 8px; bottom: 8px; width: 6px; cursor: ew-resize; }

/* 四角 */
.resize-ne { top: 0; right: 0; width: 14px; height: 14px; cursor: nesw-resize; }
.resize-nw { top: 0; left: 0; width: 14px; height: 14px; cursor: nwse-resize; }
.resize-se { bottom: 0; right: 0; width: 14px; height: 14px; cursor: nwse-resize; }
.resize-sw { bottom: 0; left: 0; width: 14px; height: 14px; cursor: nesw-resize; }

/* ============================================================
   Memory popover
   ============================================================ */

:global(.ai-memory-modal) {
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 18px 56px rgba(15, 23, 42, 0.18);
}

:global(.ai-memory-modal .n-card-header) {
  align-items: center;
  padding: 14px 18px 10px;
  border-bottom: 1px solid #eef0f2;
}

:global(.ai-memory-modal .n-card-header__main) {
  font-size: 15px;
  font-weight: 700;
  color: #1f2937;
}

:global(.ai-memory-modal .n-card-header__extra) {
  min-width: 0;
}

:global(.ai-memory-modal .n-card__content) {
  padding: 0 18px 18px;
}

.ai-memory-tabs {
  width: 168px;
}

:global(.ai-memory-tabs .n-tabs-nav) {
  line-height: 1;
}

.ai-memory-popover {
  max-height: 360px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.ai-memory-title {
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 700;
  color: #1f2937;
}

.ai-memory-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  padding: 16px 4px;
  font-size: 13px;
  color: #6b7280;
  text-align: center;
}

.ai-memory-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ai-memory-item {
  padding: 11px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

.ai-memory-item-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.ai-memory-type {
  font-size: 12px;
  font-weight: 700;
  color: #2f6f73;
}

.ai-memory-key {
  margin-left: 6px;
  font-weight: 500;
  color: #7c8a95;
}

.ai-memory-importance {
  font-size: 12px;
  color: #6b7280;
}

.ai-memory-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
  font-size: 12px;
}

.ai-memory-action {
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid #d1d5db;
  color: #4b5563;
  background: #fff;
}

.ai-memory-action--create {
  border-color: #bfdbfe;
  color: #1d4ed8;
}

.ai-memory-action--update {
  border-color: #fde68a;
  color: #92400e;
}

.ai-memory-action--merge {
  border-color: #bbf7d0;
  color: #166534;
}

.ai-memory-action--ignore {
  border-color: #e5e7eb;
  color: #6b7280;
}

.ai-memory-target {
  color: #7c8a95;
}

.ai-memory-content {
  font-size: 13px;
  line-height: 1.5;
  color: #1f2937;
  word-break: break-word;
}

.ai-memory-edit-input {
  width: 100%;
  padding: 7px 8px;
  font-size: 13px;
  line-height: 1.5;
  color: #1f2937;
  border: 1.5px solid #3b82f6;
  border-radius: 6px;
  outline: none;
  resize: vertical;
  font-family: inherit;
  background: #fff;
}

.ai-memory-edit-input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}

.ai-memory-merged {
  margin-top: 6px;
  padding: 7px 8px;
  border-left: 3px solid #86efac;
  background: #f0fdf4;
  font-size: 12px;
  line-height: 1.45;
  color: #166534;
  word-break: break-word;
}

.ai-memory-reason {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.4;
  color: #6b7280;
}

.ai-memory-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.ai-memory-tab-body {
  max-height: min(430px, calc(100vh - 220px));
  min-height: 180px;
  padding-top: 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.ai-memory-source {
  margin-top: 4px;
  font-size: 12px;
  color: #6b7280;
}

.ai-memory-date {
  font-size: 12px;
  color: #bbb;
  margin-right: auto;
}

/* ============================================================
   Workflow 面板
   ============================================================ */

.ai-workflow-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.ai-workflow-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

/* 学习规划 Workflow：结构化计划渲染 */
.ai-learning-plan {
  max-height: 220px;
  overflow-y: auto;
  padding: 10px 12px;
  border: 1px solid var(--ai-border, #e5e7eb);
  border-radius: 8px;
  background: var(--ai-bg-soft, #f8fafc);
}

.ai-learning-plan-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
}

.ai-learning-plan-stage-title {
  margin: 8px 0 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ai-text, #374151);
}

.ai-learning-plan-tasks {
  margin: 0;
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--ai-text-secondary, #6b7280);
}

.ai-learning-plan-tasks li {
  margin: 2px 0;
}

.ai-workflow-badge {
  font-size: 12px;
  font-weight: 700;
  color: #2563eb;
}

.ai-workflow-status {
  font-size: 12px;
  color: #6b7280;
}

.ai-workflow-status--bad {
  color: #dc2626;
  font-weight: 600;
}

.ai-workflow-error {
  padding: 8px 10px;
  border: 1px solid #fecaca;
  border-radius: 6px;
  background: #fef2f2;
  color: #991b1b;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}

.ai-workflow-actions,
.ai-workflow-reject-actions {
  display: flex;
  gap: 8px;
}

.ai-workflow-btn {
  min-width: 72px;
  height: 34px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid transparent;
  font-size: 13px;
  cursor: pointer;
}

.ai-workflow-btn--ok {
  background: #2563eb;
  color: #fff;
}

.ai-workflow-btn--no {
  background: #f3f4f6;
  color: #111827;
  border-color: #d1d5db;
}

.ai-workflow-btn--ghost {
  background: #fff;
  border-color: #d1d5db;
  color: #374151;
}

.ai-workflow-btn--primary {
  background: #dc2626;
  color: #fff;
}

.ai-workflow-feedback {
  width: 100%;
  min-height: 64px;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  resize: vertical;
  font: inherit;
}

/* ---- 过渡面板 ---- */

.ai-workflow-panel--transition {
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 44px;
  padding: 12px 0;
}

.ai-workflow-panel--transition :deep(.n-spin-container) {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
}

.ai-workflow-transition-label {
  font-size: 14px;
  line-height: 20px;
  color: #4b5563;
}

/* ============================================================
   Workflow 消息卡片
   ============================================================ */

/* Agent 思考过程（V2.3）：折叠条 + 步骤列表，与建议卡同风格 */
.ai-thinking {
  width: 100%;
  box-sizing: border-box;
  margin-top: 6px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fafafa;
  overflow: hidden;
}

.ai-thinking__toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: #6b7280;
}

.ai-thinking__toggle:hover {
  background: #f3f4f6;
}

.ai-thinking__icon {
  font-size: 13px;
}

.ai-thinking__title {
  flex: 1;
  text-align: left;
}

.ai-thinking__arrow {
  font-size: 10px;
  color: #9ca3af;
}

.ai-thinking__list {
  display: flex;
  flex-direction: column;
  border-top: 1px solid #f0f0f0;
  padding: 4px 0;
}

.ai-thinking__step {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 12px;
  font-size: 12px;
  line-height: 1.6;
}

.ai-thinking__step-no {
  color: #9ca3af;
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}

.ai-thinking__step-status {
  flex: 0 0 auto;
  font-size: 11px;
}

.ai-thinking__step-status--running {
  color: #2563eb;
}

.ai-thinking__step-status--success {
  color: #16a34a;
}

.ai-thinking__step-status--failed {
  color: #dc2626;
}

.ai-thinking__step-message {
  color: #4b5563;
  word-break: break-all;
}

/* Agent 写动作确认卡（V2.4）：与建议卡同风格 */
.ai-write-card {
  width: 100%;
  box-sizing: border-box;
  margin-top: 8px;
  border: 1px dashed #fcd34d;
  border-radius: 10px;
  background: #fffbeb;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-write-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ai-write-card__badge {
  font-size: 13px;
  font-weight: 700;
  color: #b45309;
}

.ai-write-card__type {
  font-size: 12px;
  color: #b45309;
  background: #fef3c7;
  border-radius: 4px;
  padding: 1px 8px;
}

.ai-write-card__reason {
  font-size: 13px;
  color: #374151;
  line-height: 1.6;
}

.ai-write-card__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* Agent Workflow 建议卡（V2.1）：Agent 建议 + 用户确认，与 Workflow 卡同风格 */
.ai-suggestion-card {
  width: 100%;
  box-sizing: border-box;
  margin-top: 8px;
  border: 1px dashed #93c5fd;
  border-radius: 10px;
  background: #f5f9ff;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-suggestion-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ai-suggestion-card__badge {
  font-size: 13px;
  font-weight: 700;
  color: #1d4ed8;
}

.ai-suggestion-card__type {
  font-size: 12px;
  color: #2563eb;
  background: #dbeafe;
  border-radius: 4px;
  padding: 1px 8px;
}

.ai-suggestion-card__reason {
  font-size: 13px;
  color: #374151;
  line-height: 1.6;
}

.ai-suggestion-card__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.ai-workflow-card {
  width: 100%;
  box-sizing: border-box;
  margin-top: 8px;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  background: #f0f7ff;
  overflow: hidden;
}

.ai-workflow-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #bfdbfe;
  background: #e8f2fe;
}

.ai-workflow-card__badge {
  font-size: 13px;
  font-weight: 700;
  color: #1d4ed8;
}

.ai-workflow-card__status {
  font-size: 12px;
  color: #4b5563;
}

.ai-workflow-card__status--loading {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-height: 18px;
  white-space: nowrap;
  line-height: 1.4;
}

.ai-workflow-card__status--loading :deep(.n-spin-container) {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
}

.ai-workflow-card__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
}

.ai-workflow-card__label {
  display: inline-block;
  min-width: 56px;
  margin-right: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
}

.ai-workflow-card__step,
.ai-workflow-card__topic {
  font-size: 13px;
  color: #1f2937;
}

.ai-workflow-card__section-title {
  margin: 6px 0 -2px;
  padding-left: 8px;
  border-left: 3px solid #2563eb;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
  color: #2563eb;
}

.ai-workflow-card__outline {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: #fff;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: #374151;
  white-space: pre-wrap;
  word-break: break-word;
  /* 流式增长时在内部滚动，避免撑高外层消息列表把滚动条推到底部 */
  max-height: 260px;
  overflow: auto;
}

.ai-workflow-card__stream-content {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: #fff;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: #374151;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 260px;
  overflow: auto;
}

.ai-workflow-card__summary p {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: #374151;
}

.ai-workflow-card__quality {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid #bfdbfe;
  background: #fff;
}

.ai-workflow-card__quality--good {
  color: #059669;
  font-size: 13px;
  font-weight: 600;
}

.ai-workflow-card__quality--bad {
  color: #dc2626;
  font-size: 13px;
  font-weight: 600;
}

.ai-workflow-card__quality-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ai-workflow-card__quality-title {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
}

.ai-workflow-card__quality-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.5;
  color: #374151;
}

/* ---- Workflow 步骤日志折叠区 ---- */

.ai-workflow-step-log {
  border-top: 1px solid #bfdbfe;
  background: #fff;
}

.ai-workflow-step-log__toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 9px 12px;
  border: 0;
  background: transparent;
  color: #1d4ed8;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.ai-workflow-step-log__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px 12px;
}

.ai-workflow-step-log__empty {
  padding: 8px 0;
  color: #6b7280;
  font-size: 12px;
}

.ai-workflow-step-log__item {
  padding: 8px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #f9fafb;
}

.ai-workflow-step-log__head,
.ai-workflow-step-log__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ai-workflow-step-log__step {
  font-size: 12px;
  font-weight: 700;
  color: #111827;
}

.ai-workflow-step-log__type {
  padding: 0 6px;
  font-size: 11px;
  line-height: 16px;
  border-radius: 3px;
}

.ai-workflow-step-log__type.is-step {
  color: #2563eb;
  background: #eff6ff;
}

.ai-workflow-step-log__type.is-operation {
  color: #7c3aed;
  background: #f5f3ff;
}

.ai-workflow-step-log__status {
  font-size: 12px;
  font-weight: 600;
}

.ai-workflow-step-log__status--success {
  color: #059669;
}

.ai-workflow-step-log__status--failed {
  color: #dc2626;
}

.ai-workflow-step-log__status--running {
  color: #2563eb;
}

.ai-workflow-step-log__status--skipped {
  color: #6b7280;
}

.ai-workflow-step-log__meta {
  margin-top: 4px;
  justify-content: flex-start;
  flex-wrap: wrap;
  color: #6b7280;
  font-size: 11px;
}

.ai-workflow-step-log__summary {
  margin-top: 6px;
  color: #374151;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

.ai-workflow-step-log__error {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 5px;
  background: #fef2f2;
  color: #991b1b;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

/* ============================================================
   Responsive
   ============================================================ */

@media (max-width: 480px) {
  .ai-panel {
    width: calc(100vw - 24px);
    height: 480px;
    right: 0;
  }

  .ai-assistant {
    right: 12px;
    bottom: 80px;
  }

  .ai-assistant.fullscreen .ai-panel {
    width: 100vw;
    height: 100vh;
    border-radius: 0;
  }
}
</style>
