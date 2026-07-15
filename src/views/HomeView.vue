<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { articleApi } from '@/api/article'
import { categoryApi } from '@/api/category'
import ArticleFeed from '@/components/article/ArticleFeed.vue'
import MainLayout from '@/layouts/MainLayout.vue'
import { useAuthStore } from '@/stores/auth'
import type { Article } from '@/types/article'
import type { Category } from '@/types/category'
import type { PageData } from '@/types/result'
import type { ArticleSort } from '@/api/article'

defineOptions({ name: 'HomeView' })

const route = useRoute()
const router = useRouter()
const message = useMessage()
const authStore = useAuthStore()
const articles = ref<Article[]>([])
const categories = ref<Category[]>([])
const loading = ref(false)
const selectedCategoryId = ref(0)
const selectedSort = ref<ArticleSort>('recommend')
const articleActionKeys = ref(new Set<string>())

/* ---- 分页 ---- */
const currentPage = ref(1)
const pageSize = 10
const totalArticles = ref(0)

const searchKeyword = computed(() => (route.query.keyword as string) ?? '')
const isHomeRoute = computed(() => route.name === 'home')
const authSignature = computed(() =>
  authStore.isLoggedIn && authStore.usersVO ? `user:${authStore.usersVO.id}` : 'guest',
)
const loadedAuthSignature = ref('')

const allCategory: Category = { id: 0, name: '综合', code: 'all', description: '全部内容' }

const fallbackCategories: Category[] = [
  { id: 1, name: 'AI / Agent', code: 'ai-agent', description: 'AI、Agent、coding agent 相关内容' },
  { id: 2, name: 'Java 后端', code: 'java-backend', description: 'Java、Spring Boot、后端开发相关内容' },
  { id: 3, name: '项目实战', code: 'project-practice', description: '项目开发、部署、踩坑记录' },
  { id: 4, name: '随笔', code: 'notes', description: '临时想法、学习记录、杂谈' },
]

const categoryItems = computed(() =>
  [allCategory, ...(categories.value.length ? categories.value : fallbackCategories)],
)

async function loadArticles() {
  loading.value = true

  try {
    const result = await articleApi.getList({
      page: currentPage.value,
      pageSize,
      keyword: searchKeyword.value || undefined,
      categoryId: selectedCategoryId.value === allCategory.id ? undefined : selectedCategoryId.value,
      sort: selectedSort.value,
    })
    const data = result.data as PageData<Article>
    articles.value = data.list ?? []
    totalArticles.value = data.total ?? 0
  } catch (error) {
    const msg = error instanceof Error ? error.message : '文章加载失败'
    message.error(msg)
  } finally {
    loading.value = false
  }
}

async function loadHomeData() {
  try {
    const categoryResult = await categoryApi.getList()
    categories.value = categoryResult.data ?? []
  } catch {
    // 分类加载失败时使用 fallback，不阻断页面
  }

  await loadArticles()
  loadedAuthSignature.value = authSignature.value
}

async function refreshArticlesForAuthChange() {
  if (!isHomeRoute.value || loadedAuthSignature.value === authSignature.value) {
    return
  }

  currentPage.value = 1
  await loadArticles()
  loadedAuthSignature.value = authSignature.value
}

function resetHomeState() {
  selectedCategoryId.value = allCategory.id
  selectedSort.value = 'recommend'
  currentPage.value = 1
  articles.value = []
  totalArticles.value = 0
}

function onPageChange(page: number) {
  currentPage.value = page
  loadArticles()
}

function onCategorySelect(category: Category) {
  selectedCategoryId.value = category.id
  currentPage.value = 1
  loadArticles()
}

function onSortChange(sort: ArticleSort) {
  selectedSort.value = sort
  currentPage.value = 1
  loadArticles()
}

function beginArticleAction(key: string) {
  if (articleActionKeys.value.has(key)) {
    return false
  }

  articleActionKeys.value = new Set([...articleActionKeys.value, key])
  return true
}

function finishArticleAction(key: string) {
  const nextKeys = new Set(articleActionKeys.value)
  nextKeys.delete(key)
  articleActionKeys.value = nextKeys
}

async function handleArticleLike(article: Article) {
  if (!authStore.isLoggedIn) {
    message.warning('请先登录后再操作亲')
    return
  }

  const actionKey = `like-${article.id}`
  if (!beginArticleAction(actionKey)) {
    return
  }

  const wasLiked = article.liked === 1
  try {
    if (wasLiked) {
      await articleApi.unlike(article.id)
      article.liked = 0
      article.likeCount = Math.max(0, (article.likeCount || 0) - 1)
    } else {
      await articleApi.like(article.id)
      article.liked = 1
      article.likeCount = (article.likeCount || 0) + 1
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '操作失败'
    message.error(msg)
  } finally {
    finishArticleAction(actionKey)
  }
}

async function handleArticleFavorite(article: Article) {
  if (!authStore.isLoggedIn) {
    message.warning('请先登录后再操作亲')
    return
  }

  const actionKey = `favorite-${article.id}`
  if (!beginArticleAction(actionKey)) {
    return
  }

  const wasFavorited = article.favorited === 1
  try {
    if (wasFavorited) {
      await articleApi.unfavorite(article.id)
      article.favorited = 0
      article.favoriteCount = Math.max(0, (article.favoriteCount || 0) - 1)
    } else {
      await articleApi.favorite(article.id)
      article.favorited = 1
      article.favoriteCount = (article.favoriteCount || 0) + 1
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '操作失败'
    message.error(msg)
  } finally {
    finishArticleAction(actionKey)
  }
}

onMounted(loadHomeData)

onActivated(refreshArticlesForAuthChange)

watch(authSignature, refreshArticlesForAuthChange)

watch(
  () => route.query.keyword,
  () => {
    if (!isHomeRoute.value || route.query.refresh) {
      return
    }

    currentPage.value = 1
    loadArticles()
  },
)

watch(
  () => route.query.refresh,
  async () => {
    if (!isHomeRoute.value || !route.query.refresh) {
      return
    }

    resetHomeState()
    await loadHomeData()
    window.scrollTo({ top: 0, left: 0 })
    const cleanQuery = { ...route.query }
    delete cleanQuery.refresh
    await router.replace({ path: '/', query: cleanQuery })
  },
)
</script>

<template>
  <MainLayout>
    <div class="feed-layout home-feed-layout">
      <aside class="category-rail" aria-label="分类导航">
        <button
          v-for="category in categoryItems"
          :key="category.id"
          :class="{ active: category.id === selectedCategoryId }"
          type="button"
          @click="onCategorySelect(category)"
        >
          <span class="category-icon">{{ category.name.slice(0, 1) }}</span>
          <span>{{ category.name }}</span>
        </button>
      </aside>

      <ArticleFeed
        class="main-feed"
        :articles="articles"
        :loading="loading"
        :page="currentPage"
        :page-size="pageSize"
        :sort="selectedSort"
        :total="totalArticles"
        @like="handleArticleLike"
        @favorite="handleArticleFavorite"
        @page-change="onPageChange"
        @sort-change="onSortChange"
      />
    </div>
  </MainLayout>
</template>
