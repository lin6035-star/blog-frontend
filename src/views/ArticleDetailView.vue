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
import { articleApi } from '@/api/article'
import { publicUserApi } from '@/api/publicUser'
import { useLoginGuard } from '@/composables/useLoginGuard'
import CommentSection from '@/components/comment/CommentSection.vue'
import MainLayout from '@/layouts/MainLayout.vue'
import type { Article } from '@/types/article'
import type { PublicUserInfo } from '@/types/publicUser'
import { formatArticleDateTime } from '@/utils/format'
import { renderArticleWithOutline } from '@/utils/articleOutline'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const { check: requireLogin } = useLoginGuard()
const article = ref<Article | null>(null)
const loading = ref(false)
const liked = ref(false)
const favorited = ref(false)
const likeCount = ref(0)
const favoriteCount = ref(0)
const liking = ref(false)
const favoriting = ref(false)
const authorProfile = ref<PublicUserInfo | null>(null)
const followBusy = ref(false)
const detailBackBarRef = ref<HTMLElement | null>(null)
const isDetailBackBarStuck = ref(false)

const renderedArticle = computed(() => {
  if (!article.value?.content) return null
  return renderArticleWithOutline(article.value.content)
})

const renderedContent = computed(() => {
  if (!renderedArticle.value) return ''
  return renderedArticle.value.html
})

const outlineItems = computed(() => {
  if (!renderedArticle.value) return []
  return renderedArticle.value.outline
})

const authorDisplayName = computed(() =>
  article.value?.authorName?.trim() || `#${article.value?.authorId}`,
)

const authorInitial = computed(() => authorDisplayName.value.slice(0, 1).toUpperCase())

async function loadAuthorProfile() {
  if (!article.value?.authorId) return
  try {
    const result = await publicUserApi.getInfo(article.value.authorId)
    authorProfile.value = result.data
  } catch {
    // 作者信息加载失败不阻塞页面
  }
}

async function loadArticle() {
  loading.value = true

  try {
    const result = await articleApi.getDetail(String(route.params.id))
    article.value = result.data
    liked.value = result.data.liked === 1
    favorited.value = result.data.favorited === 1
    likeCount.value = result.data.likeCount || 0
    favoriteCount.value = result.data.favoriteCount || 0
    loadAuthorProfile()
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

function scrollToOutlineItem(id: string) {
  document.getElementById(id)?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  })
}

function showComingSoon(feature: string) {
  message.info(`${feature}功能后面接入，先占个位置`)
}

function goToAuthorProfile(tab?: string) {
  if (!article.value?.authorId) {
    return
  }

  router.push({ path: `/users/${article.value.authorId}`, query: tab ? { tab } : {} })
}

async function handleLike() {
  if (liking.value) return
  if (!requireLogin()) return

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
  if (!requireLogin()) return

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

async function handleAuthorFollow() {
  if (!authorProfile.value || authorProfile.value.self || followBusy.value) return
  if (!requireLogin()) return

  followBusy.value = true
  const wasFollowed = authorProfile.value.followed
  try {
    if (wasFollowed) {
      await publicUserApi.cancelFollow(authorProfile.value.id)
      authorProfile.value.followed = false
      authorProfile.value.followersCount = Math.max(0, (authorProfile.value.followersCount || 0) - 1)
      message.success('已取消关注')
    } else {
      await publicUserApi.follow(authorProfile.value.id)
      authorProfile.value.followed = true
      authorProfile.value.followersCount = (authorProfile.value.followersCount || 0) + 1
      message.success('关注成功')
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    followBusy.value = false
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
                <button class="article-author-link" type="button" @click="goToAuthorProfile()">作者：{{ authorDisplayName }}</button>
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

      <aside v-if="article" class="detail-right-rail">
        <section class="detail-author-card">
          <div class="detail-author-profile">
            <div class="detail-author-avatar" @click="goToAuthorProfile()">
              <img v-if="authorProfile?.avatarUrl" :src="authorProfile.avatarUrl" class="detail-author-avatar-img" alt="" />
              <template v-else>{{ authorInitial }}</template>
            </div>
            <div class="detail-author-info">
              <p class="detail-author-label">本文作者</p>
              <h3>{{ authorDisplayName }}</h3>
            </div>
          </div>

          <div class="detail-author-stats">
            <div class="detail-author-stat-item" @click="goToAuthorProfile('articles')">
              <strong>{{ authorProfile?.articlesCount ?? '--' }}</strong>
              <span>文章</span>
            </div>
            <div class="detail-author-stat-item" @click="goToAuthorProfile('following')">
              <strong>{{ authorProfile?.followingCount ?? '--' }}</strong>
              <span>关注</span>
            </div>
            <div class="detail-author-stat-item" @click="goToAuthorProfile('followers')">
              <strong>{{ authorProfile?.followersCount ?? '--' }}</strong>
              <span>关注者</span>
            </div>
          </div>

          <div class="detail-author-actions">
            <button v-if="!authorProfile?.self" type="button" :disabled="followBusy || !authorProfile" @click="handleAuthorFollow">
              {{ followBusy ? '…' : authorProfile?.followed ? '已关注' : '关注' }}
            </button>
            <button type="button" @click="showComingSoon('私信')">私信</button>
          </div>
        </section>

        <section class="detail-outline-card">
          <div class="detail-outline-header">
            <h3>内容纲要</h3>
            <span>{{ outlineItems.length }} 节</span>
          </div>

          <nav v-if="outlineItems.length" class="detail-outline-list">
            <button
              v-for="item in outlineItems"
              :key="item.id"
              class="detail-outline-item"
              :class="`level-${item.level}`"
              type="button"
              @click="scrollToOutlineItem(item.id)"
            >
              {{ item.text }}
            </button>
          </nav>

          <p v-else class="detail-outline-empty">这篇文章暂时没有可生成目录的二级标题。</p>
        </section>
      </aside>
    </div>
  </MainLayout>
</template>
