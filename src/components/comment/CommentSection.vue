<script setup lang="ts">
import { computed, onMounted, ref, type Ref } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import { ChatbubbleOutline, FlameOutline, TimeOutline } from '@vicons/ionicons5'
import { commentApi } from '@/api/comment'
import { useAuthStore } from '@/stores/auth'
import type { Comment, CommentSort } from '@/types/comment'
import CommentEditor from './CommentEditor.vue'
import CommentItem from './CommentItem.vue'

const props = defineProps<{
  articleId: number
  articleAuthorId: number
  commentCount?: number
}>()

const pageSize = 20
const replyPageSize = 10
const dialog = useDialog()
const message = useMessage()
const authStore = useAuthStore()
const editorRef = ref<InstanceType<typeof CommentEditor> | null>(null)
const comments = ref<Comment[]>([])
const total = ref(0)
const displayCommentCount = ref(props.commentCount ?? 0)
const page = ref(1)
const selectedSort = ref<CommentSort>('hot')
const loading = ref(false)
const loadingMore = ref(false)
const mainSubmitting = ref(false)
const activeReplyId = ref<number | null>(null)
const replySubmittingId = ref<number | null>(null)
const replyPages = ref<Record<number, number>>({})
const likingCommentIds = ref<number[]>([])
const deletingCommentIds = ref<number[]>([])
const loadingReplyIds = ref<number[]>([])

const hasMore = computed(() => comments.value.length < total.value)

const sortTabs: Array<{
  label: string
  value: CommentSort
  icon: typeof TimeOutline
  disabled?: boolean
}> = [
  { label: '最热', value: 'hot', icon: FlameOutline },
  { label: '最新', value: 'time', icon: TimeOutline },
]

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function addPending(target: Ref<number[]>, commentId: number) {
  if (!target.value.includes(commentId)) {
    target.value = [...target.value, commentId]
  }
}

function removePending(target: Ref<number[]>, commentId: number) {
  target.value = target.value.filter((id) => id !== commentId)
}

async function loadComments(nextPage = 1) {
  const isFirstPage = nextPage === 1

  if (isFirstPage) {
    loading.value = true
  } else {
    loadingMore.value = true
  }

  try {
    const result = await commentApi.getList(props.articleId, {
      page: nextPage,
      pageSize,
      sort: selectedSort.value,
    })

    total.value = result.data.total
    page.value = result.data.page
    if (isFirstPage) {
      comments.value = result.data.list
      replyPages.value = {}
    } else {
      comments.value = [...comments.value, ...result.data.list]
    }
  } catch (error) {
    message.error(errorMessage(error, '评论加载失败'))
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function loadMoreComments() {
  if (loadingMore.value || !hasMore.value) {
    return
  }

  void loadComments(page.value + 1)
}

function changeSort(sort: CommentSort) {
  selectedSort.value = sort
  page.value = 1
  comments.value = []
  void loadComments(1)
}

function showLoginTip() {
  message.warning('请先登录后再操作亲')
}

async function handleMainSubmit(content: string) {
  if (mainSubmitting.value) {
    return
  }

  mainSubmitting.value = true

  try {
    await commentApi.create(props.articleId, {
      content,
      parentId: null,
    })
    editorRef.value?.clear()
    displayCommentCount.value++
    message.success('评论已发布')
    await loadComments(1)
  } catch (error) {
    message.error(errorMessage(error, '评论发布失败'))
  } finally {
    mainSubmitting.value = false
  }
}

function toggleReply(comment: Comment) {
  if (!authStore.isLoggedIn) {
    showLoginTip()
    return
  }

  activeReplyId.value = activeReplyId.value === comment.id ? null : comment.id
}

async function handleReplySubmit(comment: Comment, content: string) {
  if (replySubmittingId.value !== null) {
    return
  }

  replySubmittingId.value = comment.id

  try {
    await commentApi.create(props.articleId, {
      content,
      parentId: comment.id,
    })
    activeReplyId.value = null
    displayCommentCount.value++
    message.success('回复已发布')
    await loadComments(1)
  } catch (error) {
    message.error(errorMessage(error, '回复发布失败'))
  } finally {
    replySubmittingId.value = null
  }
}

async function handleLike(comment: Comment) {
  if (!authStore.isLoggedIn) {
    showLoginTip()
    return
  }
  if (likingCommentIds.value.includes(comment.id)) {
    return
  }

  addPending(likingCommentIds, comment.id)
  const wasLiked = comment.liked

  try {
    if (wasLiked) {
      await commentApi.unlike(comment.id)
    } else {
      await commentApi.like(comment.id)
    }

    comment.liked = !wasLiked
    comment.likeCount = Math.max(0, (comment.likeCount || 0) + (wasLiked ? -1 : 1))
  } catch (error) {
    message.error(errorMessage(error, wasLiked ? '取消点赞失败' : '点赞失败'))
  } finally {
    removePending(likingCommentIds, comment.id)
  }
}

function handleDelete(comment: Comment) {
  if (!authStore.isLoggedIn) {
    showLoginTip()
    return
  }

  dialog.error({
    title: '确认删除评论',
    content: '删除后无法恢复，父评论下的回复也会一并删除。',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      addPending(deletingCommentIds, comment.id)
      try {
        await commentApi.delete(comment.id)
        activeReplyId.value = null
        message.success('评论已删除')
        await loadComments(1)
      } catch (error) {
        message.error(errorMessage(error, '评论删除失败'))
      } finally {
        removePending(deletingCommentIds, comment.id)
      }
    },
  })
}

async function loadMoreReplies(comment: Comment) {
  if (
    loadingReplyIds.value.includes(comment.id) ||
    comment.replies.length >= comment.replyCount
  ) {
    return
  }

  addPending(loadingReplyIds, comment.id)
  const nextPage = (replyPages.value[comment.id] ?? 0) + 1

  try {
    const result = await commentApi.getReplies(comment.id, {
      page: nextPage,
      pageSize: replyPageSize,
    })
    const existingIds = new Set(comment.replies.map((reply) => reply.id))
    const newReplies = result.data.list.filter((reply) => !existingIds.has(reply.id))

    comment.replies = [...comment.replies, ...newReplies]
    comment.replyCount = result.data.total
    replyPages.value[comment.id] = result.data.page
  } catch (error) {
    message.error(errorMessage(error, '回复加载失败'))
  } finally {
    removePending(loadingReplyIds, comment.id)
  }
}

onMounted(() => {
  void loadComments()
})
</script>

<template>
  <section class="comment-section" aria-labelledby="comment-section-title">
    <div class="comment-section-header">
      <div>
        <p class="eyebrow">DISCUSSION</p>
        <h2 id="comment-section-title">
          <n-icon><ChatbubbleOutline /></n-icon>
          评论
          <span>{{ displayCommentCount }}</span>
        </h2>
      </div>
      <div class="comment-sort-tabs" aria-label="评论排序">
        <button
          v-for="tab in sortTabs"
          :key="tab.value"
          type="button"
          :class="{ active: selectedSort === tab.value, disabled: tab.disabled }"
          @click="changeSort(tab.value)"
        >
          <n-icon><component :is="tab.icon" /></n-icon>
          {{ tab.label }}
        </button>
      </div>
    </div>

    <CommentEditor
      ref="editorRef"
      :logged-in="authStore.isLoggedIn"
      :submitting="mainSubmitting"
      @login="showLoginTip"
      @submit="handleMainSubmit"
    />

    <n-spin :show="loading">
      <div v-if="comments.length" class="comment-list">
        <CommentItem
          v-for="comment in comments"
          :key="comment.id"
          :comment="comment"
          :current-user-id="authStore.usersVO?.id"
          :article-author-id="articleAuthorId"
          :liking-comment-ids="likingCommentIds"
          :deleting-comment-ids="deletingCommentIds"
          :loading-reply-ids="loadingReplyIds"
          :active-reply-id="activeReplyId"
          :reply-submitting-id="replySubmittingId"
          @toggle-reply="toggleReply"
          @submit-reply="handleReplySubmit"
          @like="handleLike"
          @delete="handleDelete"
          @load-replies="loadMoreReplies"
        />
      </div>
      <div v-else-if="!loading" class="comment-empty">
        <strong>还没有评论</strong>
        <span>写下第一条评论，开启讨论。</span>
      </div>
    </n-spin>

    <div v-if="comments.length" class="comment-load-more">
      <n-button
        v-if="hasMore"
        :loading="loadingMore"
        :disabled="loadingMore"
        @click="loadMoreComments"
      >
        加载更多
      </n-button>
      <span v-else>已经到底了</span>
    </div>
  </section>
</template>
