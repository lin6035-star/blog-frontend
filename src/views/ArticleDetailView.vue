<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import {
  ArrowBack,
  Eye,
  Heart,
  HeartOutline,
  Star,
  StarOutline,
} from '@vicons/ionicons5'
import { Marked } from 'marked'
import { articleApi } from '@/api/article'
import { useAuthStore } from '@/stores/auth'
import CommentSection from '@/components/comment/CommentSection.vue'
import MainLayout from '@/layouts/MainLayout.vue'
import type { Article } from '@/types/article'
import { formatArticleDateTime } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const authStore = useAuthStore()
const article = ref<Article | null>(null)
const loading = ref(false)
const liked = ref(false)
const favorited = ref(false)
const likeCount = ref(0)
const favoriteCount = ref(0)
const liking = ref(false)
const favoriting = ref(false)
const detailBackBarRef = ref<HTMLElement | null>(null)
const isDetailBackBarStuck = ref(false)

const marked = new Marked()

const renderedContent = computed(() => {
  if (!article.value?.content) return ''
  return marked.parse(article.value.content) as string
})

const authorDisplayName = computed(() =>
  article.value?.authorName?.trim() || `#${article.value?.authorId}`,
)

async function loadArticle() {
  loading.value = true

  try {
    const result = await articleApi.getDetail(String(route.params.id))
    article.value = result.data
    liked.value = result.data.liked === 1
    favorited.value = result.data.favorited === 1
    likeCount.value = result.data.likeCount || 0
    favoriteCount.value = result.data.favoriteCount || 0
  } catch (error) {
    const msg = error instanceof Error ? error.message : '文章加载失败'
    message.error(msg)
  } finally {
    loading.value = false
  }
}

function goBack() {
  if (window.history.state?.back) {
    router.back()
    return
  }

  router.push({ path: '/', query: { refresh: String(Date.now()) } })
}

function updateDetailBackBarStuck() {
  const bar = detailBackBarRef.value
  if (!bar) {
    isDetailBackBarStuck.value = false
    return
  }

  isDetailBackBarStuck.value = window.scrollY > 0 && bar.getBoundingClientRect().top <= 64
}

async function handleLike() {
  if (liking.value) return
  if (!authStore.isLoggedIn) {
    message.warning('请先登录后再操作亲')
    return
  }

  liking.value = true
  const wasLiked = liked.value
  try {
    if (wasLiked) {
      await articleApi.unlike(article.value!.id)
      liked.value = false
      likeCount.value = Math.max(0, likeCount.value - 1)
    } else {
      await articleApi.like(article.value!.id)
      liked.value = true
      likeCount.value = likeCount.value + 1
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    liking.value = false
  }
}

async function handleFavorite() {
  if (favoriting.value) return
  if (!authStore.isLoggedIn) {
    message.warning('请先登录后再操作亲')
    return
  }

  favoriting.value = true
  const wasFavorited = favorited.value
  try {
    if (wasFavorited) {
      await articleApi.unfavorite(article.value!.id)
      favorited.value = false
      favoriteCount.value = Math.max(0, favoriteCount.value - 1)
    } else {
      await articleApi.favorite(article.value!.id)
      favorited.value = true
      favoriteCount.value = favoriteCount.value + 1
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    favoriting.value = false
  }
}

onMounted(() => {
  loadArticle()
  nextTick(updateDetailBackBarStuck)
  window.addEventListener('scroll', updateDetailBackBarStuck, { passive: true })
  window.addEventListener('resize', updateDetailBackBarStuck)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', updateDetailBackBarStuck)
  window.removeEventListener('resize', updateDetailBackBarStuck)
})
</script>

<template>
  <MainLayout>
    <div
      ref="detailBackBarRef"
      class="detail-back-bar"
      :class="{ stuck: isDetailBackBarStuck }"
    >
      <button class="back-link" type="button" @click="goBack">
        <n-icon><ArrowBack /></n-icon>
        返回
      </button>
    </div>

    <div class="detail-layout">
      <aside class="detail-sidebar">
        <button
          class="detail-action-btn"
          :class="{ active: liked }"
          type="button"
          :disabled="liking"
          @click="handleLike"
        >
          <n-icon size="22">
            <Heart v-if="liked" />
            <HeartOutline v-else />
          </n-icon>
          <span>{{ likeCount || 0 }}</span>
        </button>
        <button
          class="detail-action-btn"
          :class="{ active: favorited }"
          type="button"
          :disabled="favoriting"
          @click="handleFavorite"
        >
          <n-icon size="22">
            <Star v-if="favorited" />
            <StarOutline v-else />
          </n-icon>
          <span>{{ favoriteCount || 0 }}</span>
        </button>
      </aside>

      <div class="detail-main">
        <n-spin :show="loading">
          <article class="detail-panel">
            <template v-if="article">
              <p class="eyebrow">ARTICLE</p>
              <h1>{{ article.title }}</h1>
              <div class="detail-meta">
                <span>作者：{{ authorDisplayName }}</span>
                <span>{{ formatArticleDateTime(article.publishedAt, '未发布') }}</span>
                <span v-if="article.categoryName" class="article-category-tag">
                  #{{ article.categoryName }}
                </span>
                <span>
                  <n-icon><Eye /></n-icon>
                  {{ article.viewCount || 0 }}
                </span>
              </div>
              <div class="article-content" v-html="renderedContent" />
              <CommentSection
                v-if="article"
                :article-id="article.id"
                :article-author-id="article.authorId"
                :comment-count="article.commentCount"
              />
            </template>
            <template v-else-if="!loading">
              <h1>文章不存在</h1>
              <p class="detail-summary">请返回首页查看其他公开文章。</p>
            </template>
          </article>
        </n-spin>
      </div>
    </div>
  </MainLayout>
</template>
