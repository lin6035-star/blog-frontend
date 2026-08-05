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
  RefreshOutline,
  StopCircleOutline,
} from '@vicons/ionicons5'
import { useDialog, useMessage } from 'naive-ui'
import { aiApi } from '@/api/ai'
import type {
  AiMessage,
  AiSession,
  PageContext,
  EditorAction,
  ArticleAction,
  ArticleRagReference,
  AiMemoryCandidate,
  AiMemory,
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

  if (name === 'profile') {
    pageContext.userId = String(authStore.usersVO?.id ?? '')
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

const sessions = ref<AiSession[]>([])
const currentSessionId = ref<string | null>(null)
const messages = ref<AiMessage[]>([])

// 用于取消正在进行的流式请求
let abortController: AbortController | null = null

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

async function scrollToBottom() {
  await nextTick()
  if (messageListRef.value) {
    messageListRef.value.scrollTop = messageListRef.value.scrollHeight
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

async function loadMessages(sid: string) {
  loadingMessages.value = true
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
    await scrollToBottom()
  } catch {
    message.error('加载消息失败')
  } finally {
    loadingMessages.value = false
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
  await loadMessages(sid)
}

/** 创建新会话：游客清空临时消息，登录用户重置为欢迎页 */
function createSession() {
  if (isGuest.value) {
    clearGuestData()
    messages.value = []
    input.value = ''
    return
  }
  currentSessionId.value = null
  messages.value = []
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
    if (!inEditor) {
      await router.push('/editor')
      await nextTick()
    }
    emitAiEditorAction(action)
    message.success('已填入编辑器')
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

  await scrollToBottom()
  sending.value = true

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
        await nextTick()
        scrollToBottom()
      },
      async onStop(session, assistantMessage, navigate, editorAction, articleAction, references) {
        abortController = null
        const legacyNavigate = extractLegacyNavigate(assistantMessage.content)
        assistantMessage = {
          ...assistantMessage,
          content: legacyNavigate.cleanContent,
          references: references ?? assistantMessage.references ?? [],
        }
        navigate = navigate ?? legacyNavigate.navigate

        // 用后端返回的完整数据替换 AI 占位
        let idx = -1
        for (let i = messages.value.length - 1; i >= 0; i--) {
          if (messages.value[i].role === 'ai' && messages.value[i].id === '') {
            idx = i
            break
          }
        }
        if (idx >= 0) messages.value[idx] = assistantMessage

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
    message.success('已复制')
  } catch {
    message.error('复制失败')
  }
}

async function deleteMessage(index: number) {
  const msg = messages.value[index]
  if (!msg?.id) return

  messages.value.splice(index, 1)

  if (isGuest.value) {
    saveGuestMessages(messages.value)
    return
  }

  try {
    await aiApi.deleteMessage(msg.sessionId, msg.id)
  } catch {
    message.error('删除失败')
    // 回滚：API 失败时前端已经删了，简单提示即可
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
        <div ref="messageListRef" class="ai-body">
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
            <div
              v-for="(msg, i) in messages"
              :key="i"
              class="ai-msg"
              :class="msg.role"
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

                <div v-else-if="msg.role !== 'ai'" class="ai-msg-bubble">{{ msg.content }}</div>
                <div class="ai-msg-meta">
                  <div v-if="msg.role === 'ai'" class="ai-msg-actions">
                    <button class="ai-msg-action-btn" title="复制" @click="copyMessage(msg)">
                      <n-icon :component="CopyOutline" size="15" />
                    </button>
                    <button class="ai-msg-action-btn" title="重新生成" @click="regenerate(i)">
                      <n-icon :component="RefreshOutline" size="15" />
                    </button>
                    <button class="ai-msg-action-btn" title="删除" @click="deleteMessage(i)">
                      <n-icon :component="TrashOutline" size="15" />
                    </button>
                  </div>
                  <div v-else class="ai-msg-actions">
                    <button class="ai-msg-action-btn" title="删除" @click="deleteMessage(i)">
                      <n-icon :component="TrashOutline" size="15" />
                    </button>
                  </div>
                  <span class="ai-msg-time">{{ formatMessageTime(msg.createdAt) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 输入区 -->
        <footer class="ai-input-area">
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
