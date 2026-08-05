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
}

export interface AiMessage {
  id: string
  sessionId: string
  role: 'user' | 'ai'
  content: string
  pageContext?: string
  createdAt: string
  references?: ArticleRagReference[]
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
  ) => void
  onError: (error: Error) => void
  /** 用户主动停止生成，前端自行处理（保留已输出内容） */
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
}

interface AiMessageRaw {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  content: string
  pageContext?: string
  createdAt: string
  references?: ArticleRagReference[]
}

// ============================================================
// role 映射
// ============================================================

function mapMessage(m: AiMessageRaw): AiMessage {
  return {
    ...m,
    role: m.role === 'assistant' ? 'ai' : m.role,
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
