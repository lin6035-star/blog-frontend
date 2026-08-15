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
  /** 前端临时状态：该消息刚被复制过（按钮短暂显示 ✔） */
  copied?: boolean
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

export type WorkflowType = 'CREATE_ARTICLE' | 'OPTIMIZE_ARTICLE' | 'LEARNING_PLAN'

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

export interface WorkflowFeedbackItem {
  time: string
  step: WorkflowStep
  status: WorkflowStatus
  userFeedback: string
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
  clarification?: {
    required?: boolean
    question?: string
  }
  memoryContext?: string
  ragReferences?: ArticleRagReference[]
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
  feedbackHistory?: WorkflowFeedbackItem[]
}

export interface OptimizeArticleWorkflowContext {
  workflowVersion: string
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
  input?: {
    goal?: string
  }
  stepResults?: {
    plan?: {
      title?: string
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
  onStop: (
    session: AiSession,
    assistantMessage: AiMessage,
    navigate?: NavigateCommand,
    editorAction?: EditorAction,
    articleAction?: ArticleAction,
    references?: ArticleRagReference[],
    workflow?: AiWorkflowRun,
  ) => void
  onError: (error: Error) => void
  /** 用户主动停止生成，前端自行处理（保留已输出内容） */
  onAbort?: () => void
}

// ============================================================
// Workflow 流式事件
// ============================================================

export interface WorkflowStepEvent {
  workflowRunId: string
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
}

// ============================================================
// role 映射
// ============================================================

function mapMessage(m: AiMessageRaw): AiMessage {
  return {
    ...m,
    role: m.role === 'assistant' ? 'ai' : m.role,
    workflowRunId: m.workflowRunId,
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

  /** 查询 Workflow 步骤执行日志 */
  getWorkflowStepLogs(id: string) {
    return request.get<AiWorkflowStepLog[]>(`/ai/workflows/${id}/steps`)
  },

  /** 同意 Workflow 当前步骤 */
  approveWorkflow(id: string) {
    return request.post<AiWorkflowRun>(`/ai/workflows/${id}/approve`)
  },

  /** 拒绝 Workflow 当前步骤并反馈 */
  rejectWorkflow(id: string, feedback: string) {
    return request.post<AiWorkflowRun>(`/ai/workflows/${id}/reject`, { feedback })
  },

  /** 重试失败的 Workflow 当前步骤 */
  retryWorkflow(id: string) {
    return request.post<AiWorkflowRun>(`/ai/workflows/${id}/retry`)
  },

  /** 同意 Workflow 当前步骤（SSE） */
  streamApproveWorkflow(id: string, callbacks: WorkflowStreamCallbacks, signal?: AbortSignal) {
    return streamWorkflowAction(`/api/ai/workflows/${id}/approve/stream`, undefined, callbacks, signal)
  },

  /** 拒绝 Workflow 当前步骤并反馈（SSE） */
  streamRejectWorkflow(id: string, feedback: string, callbacks: WorkflowStreamCallbacks, signal?: AbortSignal) {
    return streamWorkflowAction(`/api/ai/workflows/${id}/reject/stream`, { feedback }, callbacks, signal)
  },

  /** 重试失败的 Workflow 当前步骤（SSE） */
  streamRetryWorkflow(id: string, callbacks: WorkflowStreamCallbacks, signal?: AbortSignal) {
    return streamWorkflowAction(`/api/ai/workflows/${id}/retry/stream`, undefined, callbacks, signal)
  },

  /** 完成 Workflow（编辑器已保存/发布后收口） */
  completeWorkflow(id: string) {
    return request.post<AiWorkflowRun>(`/ai/workflows/${id}/complete`)
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
