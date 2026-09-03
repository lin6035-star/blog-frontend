import request from '@/utils/request'
import type { PageData } from '@/types/result'

// ============================================================
// 前端统一类型（role 用 'ai' 而不是后端的 'assistant'）
// ============================================================

export interface ArticleRagReference {
  articleId: number
  title: string
  chunkIndex: number
  snippet: string
}

export interface AiMemoryCandidate {
  id: string
  memoryType: 'PROFILE' | 'PREFERENCE' | 'PROJECT_STATE'
  memoryKey: string
  content: string
  candidateAction: 'CREATE' | 'UPDATE' | 'MERGE' | 'IGNORE'
  reason?: string
  decisionReason?: string
  mergedContent?: string
  targetMemoryId?: string
  confidence?: number
  importance?: number
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED'
  createdAt: string
}

export interface AiMemory {
  id: string
  memoryType: 'PROFILE' | 'PREFERENCE' | 'PROJECT_STATE'
  memoryKey: string
  content: string
  source: string
  confidence?: number
  importance?: number
  enabled: number
  createdAt: string
  updatedAt: string
}

export interface AiEpisodicMemory {
  id: string
  projectKey: string
  memoryType: 'DECISION' | 'EVENT' | 'MILESTONE' | 'PLAN'
  title: string
  content: string
  importance?: number
  confidence?: number
  sessionId?: string
  occurredAt?: string
  createdAt: string
  updatedAt: string
}

export interface AiConversationSummaryStatus {
  compressing: boolean
  lastCompressedAt: string | null
  coveredMessageCount: number
}

export interface AiSession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  activeWorkflowRunId?: string
}

export interface AiMessage {
  id: string
  sessionId: string
  role: 'user' | 'ai'
  content: string
  pageContext?: string
  createdAt: string
  references?: ArticleRagReference[]
  workflowRunId?: string
  workflow?: AiWorkflowRun
  /** V2.1：关联的 Agent Run（建议卡快照恢复用） */
  agentRunId?: string
  /** V2.3：Agent 思考步骤（实时 AGENT_STEP 事件累计 / 历史补拉挂回） */
  thinkingSteps?: AgentStepView[]
  /** V2.1：Agent 待确认的 Workflow 建议（STOP event 透出 / 历史补拉挂回） */
  workflowSuggestion?: WorkflowSuggestion
  /** V2.4：Agent 待确认的写动作提案（STOP event 透出 / 历史补拉挂回） */
  writeAction?: AgentWriteProposal
  /** V2.4 前端临时状态：写动作卡交互态（pending/processing/confirmed/cancelled/expired） */
  writeActionState?: 'pending' | 'processing' | 'confirmed' | 'cancelled' | 'expired'
  /** V2.1 前端临时状态：suggestion 卡片交互态（pending/processing/confirmed/cancelled/expired） */
  suggestionState?: 'pending' | 'processing' | 'confirmed' | 'cancelled' | 'expired'
  /** 前端临时状态：该消息刚被复制过（按钮短暂显示 ✔） */
  copied?: boolean
}

/** Agent 写动作提案（V2.4 / V3.1）：LLM 只给标题类信息，索引由后端匹配 */
export interface AgentWriteProposal {
  /** 写动作类型：UPDATE_TASK_DONE=勾选/取消勾选已有任务（done 生效）；ADD_LEARNING_TASK=追加新任务（done 忽略） */
  actionType: 'UPDATE_TASK_DONE' | 'ADD_LEARNING_TASK'
  planRef?: string
  stageTitle?: string
  taskTitle: string
  done: boolean
}

/** Agent 思考步骤（V2.3）：status = RUNNING / SUCCESS / FAILED */
export interface AgentStepView {
  stepNo: number
  actionType: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  message: string
}

/** V2.2 后端 AgentStepVO 结构（历史恢复时映射为 AgentStepView） */
export interface AgentStepHistoryItem {
  stepNo: number
  actionType: string
  status: string
  /** 展示文案（与实时 AGENT_STEP 事件一致，刷新前后不串味） */
  message?: string | null
  summary?: string | null
  errorMessage?: string | null
  durationMs?: number | null
  createdAt?: string
}

/** Agent 建议的 Workflow（V2.1）：确认后才由后端启动，Agent 无法直接启动 */
export interface WorkflowSuggestion {
  workflowType: WorkflowType
  reason: string
  initialMessage?: string
  risk?: 'LOW' | 'MEDIUM' | 'HIGH'
  /** V2.5 文章侧建议：目标文章 ID（仅 OPTIMIZE_ARTICLE 建议携带，前端只透传不渲染） */
  articleId?: string
}

export interface NavigateCommand {
  target: string
  param?: string
}

export interface EditorAction {
  type: 'fillArticle' | 'saveDraft' | 'publish'
  title?: string
  categoryName?: string
  summary?: string
  content?: string
  articleId?: number
}

export interface ArticleAction {
  type:
    | 'likeArticle'
    | 'unlikeArticle'
    | 'favoriteArticle'
    | 'unfavoriteArticle'
    | 'commentArticle'
    | 'scrollToComments'
    | 'copyArticleLink'
    | 'followAuthor'
    | 'unfollowAuthor'
    | 'scrollToTop'
  articleId?: string
  content?: string
}

// ============================================================
// Workflow 类型
// ============================================================

export type WorkflowStatus =
  | 'RUNNING'
  | 'WAITING_REQUIREMENT_CONFIRM'
  | 'WAITING_OUTLINE_CONFIRM'
  | 'WAITING_DRAFT_CONFIRM'
  | 'WAITING_PLAN_CONFIRM'
  | 'WAITING_LEARNING_PLAN_CONFIRM'
  | 'WAITING_FILL_CONFIRM'
  | 'WAITING_USER_SAVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'

export type WorkflowType = 'CREATE_ARTICLE' | 'OPTIMIZE_ARTICLE' | 'LEARNING_PLAN' | 'LEARNING_PROGRESS' | 'LEARNING_ASSIST'

export type WorkflowStep =
  | 'REQUIREMENT_ANALYZE'
  | 'MEMORY_RETRIEVE'
  | 'RAG_SEARCH'
  | 'GENERATE_OUTLINE'
  | 'GENERATE_DRAFT'
  | 'QUALITY_CHECK'
  | 'FILL_ARTICLE'
  | 'LOAD_ARTICLE'
  | 'ANALYZE_ARTICLE'
  | 'GENERATE_OPTIMIZATION_PLAN'
  | 'REWRITE_ARTICLE'
  | 'CONTENT_CHECK'
  | 'ANALYZE_GOAL'
  | 'GENERATE_PLAN'
  | 'SAVE_PLAN'
  | 'LOAD_PLAN'
  | 'ANALYZE_CHANGE'
  | 'LOCATE_STAGE'
  | 'GENERATE_TASKS'
  | 'APPEND_TASKS'

export interface WorkflowFeedbackItem {
  time: string
  step: WorkflowStep
  status: WorkflowStatus
  userFeedback: string
}

/**
 * 确认卡片：Workflow 停在等待确认态时由后端写入。
 * type 决定渲染哪种确认面板（与 status 解耦，前端只按 type 渲染）。
 */
export interface WorkflowConfirmation {
  type: 'REQUIREMENT' | 'OUTLINE' | 'DRAFT' | 'PLAN' | 'LEARNING_PLAN' | 'FILL'
  step?: WorkflowStep
  question?: string
}

export interface CreateArticleWorkflowContext {
  workflowVersion: string
  variables: {
    articleType?: string
    language?: string
  }
  requirement?: {
    topic?: string
    type?: string
    keywords?: string[]
  }
  confirmation?: WorkflowConfirmation
  memoryContext?: string
  ragReferences?: ArticleRagReference[]
  // 以下三个字段为历史数据位置（早期版本放 context 顶层），新数据统一在 stepResults
  outline?: string
  draft?: {
    title?: string
    summary?: string
    content?: string
    tags?: string[]
  }
  qualityCheck?: {
    passed?: boolean
    issues?: string[]
    suggestions?: string[]
  }
  stepResults?: {
    outline?: string
    draft?: {
      title?: string
      summary?: string
      content?: string
      tags?: string[]
    }
    qualityCheck?: {
      passed?: boolean
      issues?: string[]
      suggestions?: string[]
    }
  }
  feedbackHistory?: WorkflowFeedbackItem[]
}

export interface OptimizeArticleWorkflowContext {
  workflowVersion: string
  confirmation?: WorkflowConfirmation
  input?: {
    articleId?: number
    instruction?: string
  }
  memoryContext?: string
  ragContext?: {
    references?: ArticleRagReference[]
  }
  stepResults?: {
    article?: {
      id?: number
      title?: string
      summary?: string
      content?: string
      categoryId?: number
      status?: number
    }
    analysis?: {
      contentLength?: number
      paragraphCount?: number
      codeBlockCount?: number
      imageCount?: number
      issues?: string[]
    }
    optimizationPlan?: string
    optimizedContent?: string
    contentCheck?: {
      passed?: boolean
      issues?: string[]
      suggestions?: string[]
    }
  }
  feedbackHistory?: WorkflowFeedbackItem[]
}

export interface AiWorkflowRun {
  id: string
  workflowType: WorkflowType
  workflowVersion: string
  status: WorkflowStatus
  currentStep?: WorkflowStep
  context: CreateArticleWorkflowContext & OptimizeArticleWorkflowContext & LearningPlanWorkflowContext
  editorAction?: EditorAction
  pauseReason?: string
  errorMessage?: string
}

export interface LearningPlanWorkflowContext {
  confirmation?: WorkflowConfirmation
  planTitle?: string  //难点攻坚：目标计划标题
  targetStageTitle?: string  //难点攻坚：定位到的阶段标题
  input?: {
    goal?: string
  }
  stepResults?: {
    plan?: {
      title?: string
      explanation?: string  //难点攻坚：难点讲解文本
      stages?: Array<{
        title?: string
        tasks?: Array<string | { title?: string }>
      }>
    }
    qualityCheck?: {
      passed?: boolean
      issues?: string[]
      suggestions?: string[]
    }
  }
}

export interface AiWorkflowStepLog {
  id: string
  workflowRunId: string
  /** 日志类型：OPERATION=操作级（确认/反馈/重试）/ STEP=步骤级（runStep 每步） */
  logType?: 'OPERATION' | 'STEP' | string
  stepOrder: number
  step: WorkflowStep | string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | string
  retryCount?: number
  inputSummary?: string
  outputSummary?: string
  errorMessage?: string
  metadataJson?: string
  startedAt: string
  endedAt?: string
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  createdAt: string
}

export interface CreateArticleWorkflowRequest {
  conversationId?: number | null
  requirement: string
  pageContext?: PageContext
}

export interface OptimizeArticleWorkflowRequest {
  conversationId?: number | null
  articleId: number
  instruction?: string
  pageContext?: PageContext
}

export interface AiChatResult {
  session: AiSession
  userMessage: AiMessage
  assistantMessage: AiMessage
  navigate?: NavigateCommand
  editorAction?: EditorAction
  articleAction?: ArticleAction
}

export interface PageContext {
  pageType?: string
  path?: string
  articleId?: string
  articleTitle?: string
  userId?: string
}

export interface StreamCallbacks {
  onParam: (session: AiSession, userMessage: AiMessage) => void
  onData: (chunk: string) => Promise<void> | void
  onWorkflowStep?: (event: WorkflowStepEvent) => Promise<void> | void
  onWorkflowContentDelta?: (event: WorkflowContentDeltaEvent) => Promise<void> | void
  /** V2.3：Agent 思考步骤事件（实时） */
  onAgentStep?: (event: AgentStepEvent) => Promise<void> | void
  onStop: (
    session: AiSession,
    assistantMessage: AiMessage,
    navigate?: NavigateCommand,
    editorAction?: EditorAction,
    articleAction?: ArticleAction,
    references?: ArticleRagReference[],
    workflow?: AiWorkflowRun,
    workflowSuggestion?: WorkflowSuggestion,
    writeAction?: AgentWriteProposal,
  ) => void
  onError: (error: Error) => void
  /** 用户主动停止生成，前端自行处理（保留已输出内容） */
  onAbort?: () => void
}

// ============================================================
// Workflow 流式事件
// ============================================================

/** Agent 思考步骤事件（V2.3，SSE 实时推送） */
export interface AgentStepEvent {
  stepNo: number
  actionType: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  message: string
}

export interface WorkflowStepEvent {
  workflowRunId: string
  workflowType?: WorkflowType
  action?: string
  step?: string
  status: string
  message?: string
}

export interface WorkflowContentDeltaEvent {
  workflowRunId: string
  step: string
  field: string
  delta: string
}

export interface WorkflowStreamResult {
  workflow?: AiWorkflowRun
  stepLogs?: AiWorkflowStepLog[]
  editorAction?: EditorAction
  message?: string
}

export interface WorkflowStreamCallbacks {
  onStep?: (event: WorkflowStepEvent) => Promise<void> | void
  onContentDelta?: (event: WorkflowContentDeltaEvent) => Promise<void> | void
  onStop?: (data: WorkflowStreamResult) => Promise<void> | void
  onWorkflowError?: (data: WorkflowStreamResult) => Promise<void> | void
  onError: (error: Error) => void
  onAbort?: () => void
}

// ============================================================
// 后端原始类型（role: 'assistant'）
// ============================================================

interface AiSessionRaw {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  activeWorkflowRunId?: string
}

interface AiMessageRaw {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  pageContext?: string
  createdAt: string
  references?: ArticleRagReference[]
  workflowRunId?: string
  agentRunId?: string
}

// ============================================================
// role 映射
// ============================================================

function mapMessage(m: AiMessageRaw): AiMessage {
  return {
    ...m,
    role: m.role === 'assistant' ? 'ai' : m.role,
    workflowRunId: m.workflowRunId,
    agentRunId: m.agentRunId,
  }
}

// ============================================================
// SSE 流式 chat（fetch + ReadableStream，不走 axios）
// ============================================================

interface AiChatEventRaw {
  eventType: number
  eventData: unknown
}

const EVENT_PARAM = 1003
const EVENT_DATA = 1001
const EVENT_STOP = 1002
const EVENT_WORKFLOW_STEP = 2001
const EVENT_WORKFLOW_STOP = 2002
const EVENT_WORKFLOW_ERROR = 2003
const EVENT_WORKFLOW_CONTENT_DELTA = 2004
const EVENT_AGENT_STEP = 3001

async function streamChat(
  sessionId: string | null,
  message: string,
  pageContext: PageContext | undefined,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const token = localStorage.getItem('blog_token') ?? ''

  const body: Record<string, unknown> = { message }
  if (sessionId) body.sessionId = sessionId
  if (pageContext) body.pageContext = pageContext

  let response: Response
  try {
    response = await fetch('/api/ai/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      callbacks.onAbort?.()
      return
    }
    callbacks.onError(e instanceof Error ? e : new Error('网络请求失败'))
    return
  }

  if (!response.ok) {
    let errorMsg = `请求失败 (${response.status})`
    try {
      const text = await response.text()
      if (text) {
        const parsed = JSON.parse(text)
        errorMsg = parsed.message || errorMsg
      }
    } catch {
      // 不是 JSON，用默认错误信息
    }
    callbacks.onError(new Error(errorMsg))
    return
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let stopped = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue

        const jsonStr = trimmed.slice(5).trim()
        if (!jsonStr) continue

        try {
          const event: AiChatEventRaw = JSON.parse(jsonStr)

          if (event.eventType === EVENT_PARAM) {
            const data = event.eventData as {
              session: AiSessionRaw
              userMessage: AiMessageRaw
            }
            callbacks.onParam(data.session, mapMessage(data.userMessage))
          } else if (event.eventType === EVENT_DATA) {
            await callbacks.onData(String(event.eventData ?? ''))
            // 让出事件循环，给 Vue 一次渲染机会，避免所有 chunk 积压到同一帧
            await new Promise((resolve) => setTimeout(resolve, 0))
          } else if (event.eventType === EVENT_WORKFLOW_STEP) {
            await callbacks.onWorkflowStep?.(event.eventData as WorkflowStepEvent)
          } else if (event.eventType === EVENT_WORKFLOW_CONTENT_DELTA) {
            await callbacks.onWorkflowContentDelta?.(event.eventData as WorkflowContentDeltaEvent)
          } else if (event.eventType === EVENT_AGENT_STEP) {
            await callbacks.onAgentStep?.(event.eventData as AgentStepEvent)
          } else if (event.eventType === EVENT_STOP) {
            stopped = true
            const data = event.eventData as {
              session: AiSessionRaw
              assistantMessage: AiMessageRaw
              navigate?: NavigateCommand
              editorAction?: EditorAction
              articleAction?: ArticleAction
              references?: ArticleRagReference[]
              workflow?: AiWorkflowRun
              workflowSuggestion?: WorkflowSuggestion
              writeAction?: AgentWriteProposal
            }

            const assistantMessage = {
              ...mapMessage(data.assistantMessage),
              references: data.references ?? [],
            }

            callbacks.onStop(
              data.session,
              assistantMessage,
              data.navigate,
              data.editorAction,
              data.articleAction,
              data.references,
              data.workflow,
              data.workflowSuggestion,
              data.writeAction,
            )
          }
        } catch {
          // 跳过解析失败的 JSON 行
        }
      }
    }

    if (!stopped) {
      callbacks.onError(new Error('连接意外中断'))
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      callbacks.onAbort?.()
      return
    }
    callbacks.onError(e instanceof Error ? e : new Error(String(e)))
  } finally {
    reader.cancel()
  }
}

// ============================================================
// SSE 流式 Workflow 操作（fetch + ReadableStream）
// ============================================================

async function streamWorkflowAction(
  url: string,
  body: Record<string, unknown> | undefined,
  idempotencyKey: string,
  callbacks: WorkflowStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const token = localStorage.getItem('blog_token') ?? ''

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      callbacks.onAbort?.()
      return
    }
    callbacks.onError(e instanceof Error ? e : new Error('网络请求失败'))
    return
  }

  if (!response.ok) {
    callbacks.onError(new Error(`请求失败 (${response.status})`))
    return
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let stopped = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue

        const jsonStr = trimmed.slice(5).trim()
        if (!jsonStr) continue

        try {
          const event: AiChatEventRaw = JSON.parse(jsonStr)

          if (event.eventType === EVENT_WORKFLOW_STEP) {
            await callbacks.onStep?.(event.eventData as WorkflowStepEvent)
          } else if (event.eventType === EVENT_WORKFLOW_CONTENT_DELTA) {
            await callbacks.onContentDelta?.(event.eventData as WorkflowContentDeltaEvent)
          } else if (event.eventType === EVENT_WORKFLOW_STOP) {
            stopped = true
            await callbacks.onStop?.(event.eventData as WorkflowStreamResult)
          } else if (event.eventType === EVENT_WORKFLOW_ERROR) {
            stopped = true
            await callbacks.onWorkflowError?.(event.eventData as WorkflowStreamResult)
          }
        } catch {
          // 跳过解析失败的事件
        }
      }
    }

    if (!stopped) {
      callbacks.onError(new Error('Workflow 连接意外中断'))
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      callbacks.onAbort?.()
      return
    }
    callbacks.onError(e instanceof Error ? e : new Error(String(e)))
  } finally {
    reader.cancel()
  }
}

// ============================================================
// API
// ============================================================

export const aiApi = {
  /** 创建会话 */
  createSession(title?: string) {
    return request.post<AiSession>('/ai/conversations', title ? { title } : {})
  },

  /** 历史会话分页 */
  getSessions(page = 1, pageSize = 20) {
    return request.get<PageData<AiSessionRaw>>('/ai/conversations', {
      params: { page, pageSize },
    })
  },

  /** 删除会话 */
  deleteSession(id: string) {
    return request.delete(`/ai/conversations/${id}`)
  },

  /** 查询会话的消息列表 */
  async getMessages(sessionId: string) {
    const res = await request.get<AiMessageRaw[]>(`/ai/conversations/${sessionId}/messages`)
    if (res.data) {
      return { ...res, data: res.data.map(mapMessage) }
    }
    return res as unknown as typeof res & { data: AiMessage[] }
  },

  /** 删除单条消息 */
  deleteMessage(sessionId: string, messageId: string) {
    return request.delete(`/ai/conversations/${sessionId}/messages/${messageId}`)
  },

  /** 会话压缩状态：压缩中标记 / 最近压缩时间 / 已压缩消息数 */
  getSummaryStatus(sessionId: string) {
    return request.get<AiConversationSummaryStatus>(`/ai/conversations/${sessionId}/summary-status`)
  },

  /** 查询待确认记忆 */
  getMemoryCandidates() {
    return request.get<AiMemoryCandidate[]>('/ai/memory-candidates')
  },

  /** 确认候选记忆，可传编辑后的 content 覆盖原内容 */
  confirmMemoryCandidate(id: string, content?: string) {
    return request.post<void>(`/ai/memory-candidates/${id}/confirm`, content ? { content } : undefined)
  },

  /** 忽略候选记忆 */
  rejectMemoryCandidate(id: string) {
    return request.post<void>(`/ai/memory-candidates/${id}/reject`)
  },

  /** 查询正式长期记忆 */
  getMemories() {
    return request.get<AiMemory[]>('/ai/memories')
  },

  /** 删除正式长期记忆：后端实际是 enabled = 0 */
  deleteMemory(id: string) {
    return request.delete<void>(`/ai/memories/${id}`)
  },

  /** 查询情景记忆 */
  getEpisodicMemories() {
    return request.get<AiEpisodicMemory[]>('/ai/episodic-memories')
  },

  /** 物理删除情景记忆 */
  deleteEpisodicMemory(id: string) {
    return request.delete<void>(`/ai/episodic-memories/${id}`)
  },

  /** 编辑长期记忆内容 */
  updateMemory(id: string, data: { memoryType: string; memoryKey: string; content: string }) {
    return request.put<void>(`/ai/memories/${id}`, data)
  },

  /** 发送消息（SSE 流式） */
  streamChat,

  /** 创建文章 Workflow */
  createArticleWorkflow(data: CreateArticleWorkflowRequest) {
    return request.post<AiWorkflowRun>('/ai/workflows/article/create', data)
  },

  /** 创建文章优化 Workflow */
  createArticleOptimizeWorkflow(data: OptimizeArticleWorkflowRequest) {
    return request.post<AiWorkflowRun>('/ai/workflows/article/optimize', data)
  },

  /** 查询 Workflow 运行状态 */
  getWorkflowRun(id: string) {
    return request.get<AiWorkflowRun>(`/ai/workflows/${id}`)
  },

  /** 查询 Agent Run 建议快照（历史消息恢复建议卡，仅 WAITING_WORKFLOW_CONFIRM 返回 suggestion） */
  getWorkflowSuggestion(agentRunId: string) {
    return request.get<{ status: string; suggestion: WorkflowSuggestion | null }>(
      `/ai/agent-runs/${agentRunId}/workflow-suggestion`,
    )
  },

  /** V2.2：Agent Run 步骤列表（历史消息恢复思考面板；后端 VO 字段为 summary） */
  getAgentRunSteps(agentRunId: string) {
    return request.get<AgentStepHistoryItem[]>(`/ai/agent-runs/${agentRunId}/steps`)
  },

  /** 确认 Agent 建议：启动学习类 Workflow，返回 Workflow 快照（Idempotency-Key 防双击重复创建） */
  confirmWorkflowSuggestion(agentRunId: string, idempotencyKey: string) {
    return request.post<AiWorkflowRun>(
      `/ai/agent-runs/${agentRunId}/workflow-suggestion/confirm`,
      undefined,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
  },

  /** 取消 Agent 建议：不启动任何 Workflow */
  cancelWorkflowSuggestion(agentRunId: string) {
    return request.post<string>(`/ai/agent-runs/${agentRunId}/workflow-suggestion/cancel`)
  },

  /** V2.4：确认写动作提案（标题匹配 → 执行），返回执行结果文案 */
  confirmWriteAction(agentRunId: string) {
    return request.post<string>(`/ai/agent-runs/${agentRunId}/write-action/confirm`)
  },

  /** V2.4：取消写动作提案（不执行任何修改） */
  cancelWriteAction(agentRunId: string) {
    return request.post<string>(`/ai/agent-runs/${agentRunId}/write-action/cancel`)
  },

  /** V2.4：写动作提案快照（历史消息恢复写动作卡） */
  getWriteAction(agentRunId: string) {
    return request.get<{ status: string; proposal: AgentWriteProposal | null }>(
      `/ai/agent-runs/${agentRunId}/write-action`,
    )
  },

  /** 查询 Workflow 步骤执行日志 */
  getWorkflowStepLogs(id: string) {
    return request.get<AiWorkflowStepLog[]>(`/ai/workflows/${id}/steps`)
  },

  /** 同意 Workflow 当前步骤 */
  approveWorkflow(id: string, idempotencyKey: string) {
    return request.post<AiWorkflowRun>(
      `/ai/workflows/${id}/approve`,
      undefined,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
  },

  /** 拒绝 Workflow 当前步骤并反馈 */
  rejectWorkflow(
    id: string,
    feedback: string,
    idempotencyKey: string,
  ) {
    return request.post<AiWorkflowRun>(
      `/ai/workflows/${id}/reject`,
      { feedback },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
  },

  /** 重试失败的 Workflow 当前步骤 */
  retryWorkflow(id: string, idempotencyKey: string) {
    return request.post<AiWorkflowRun>(
      `/ai/workflows/${id}/retry`,
      undefined,
      { headers: { 'Idempotency-Key': idempotencyKey } },
    )
  },

  /** 同意 Workflow 当前步骤（SSE） */
  streamApproveWorkflow(
    id: string,
    idempotencyKey: string,
    callbacks: WorkflowStreamCallbacks,
    signal?: AbortSignal,
  ) {
    return streamWorkflowAction(
      `/api/ai/workflows/${id}/approve/stream`,
      undefined,
      idempotencyKey,
      callbacks,
      signal,
    )
  },

  /** 拒绝 Workflow 当前步骤并反馈（SSE） */
  streamRejectWorkflow(
    id: string,
    feedback: string,
    idempotencyKey: string,
    callbacks: WorkflowStreamCallbacks,
    signal?: AbortSignal,
  ) {
    return streamWorkflowAction(
      `/api/ai/workflows/${id}/reject/stream`,
      { feedback },
      idempotencyKey,
      callbacks,
      signal,
    )
  },

  /** 重试失败的 Workflow 当前步骤（SSE） */
  streamRetryWorkflow(
    id: string,
    idempotencyKey: string,
    callbacks: WorkflowStreamCallbacks,
    signal?: AbortSignal,
  ) {
    return streamWorkflowAction(
      `/api/ai/workflows/${id}/retry/stream`,
      undefined,
      idempotencyKey,
      callbacks,
      signal,
    )
  },

  /** 取消 Workflow */
  cancelWorkflow(id: string) {
    return request.post<void>(`/ai/workflows/${id}/cancel`)
  },

  // 【已废弃】非流式接口，前端已全面切到流式，暂时注释，后续删除
  // async chat(sessionId: string | null, message: string, pageContext?: PageContext) {
  //   const body: { sessionId?: string; message: string; pageContext?: PageContext } = {
  //     message,
  //   }
  //   if (sessionId) body.sessionId = sessionId
  //   if (pageContext) body.pageContext = pageContext
  //
  //   const res = await request.post<any>('/ai/chat', body)
  //   if (res.data) {
  //     return { ...res, data: mapChatResult(res.data) }
  //   }
  //   return res as unknown as typeof res & { data: AiChatResult }
  // },
}
