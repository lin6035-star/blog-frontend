<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { articleApi } from '@/api/article'
import { categoryApi } from '@/api/category'
import ArticleFeed from '@/components/article/ArticleFeed.vue'
import MainLayout from '@/layouts/MainLayout.vue'
import type { Article } from '@/types/article'
import type { Category } from '@/types/category'
import type { PageData } from '@/types/result'
import type { ArticleSort } from '@/api/article'

defineOptions({ name: 'HomeView' })

const route = useRoute()
const router = useRouter()
const message = useMessage()
const articles = ref<Article[]>([])
const categories = ref<Category[]>([])
const loading = ref(false)
const selectedCategoryId = ref(0)
const selectedSort = ref<ArticleSort>('recommend')

/* ---- 分页 ---- */
const currentPage = ref(1)
const pageSize = 10
const totalArticles = ref(0)

const searchKeyword = computed(() => (route.query.keyword as string) ?? '')
const isHomeRoute = computed(() => route.name === 'home')

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

onMounted(loadHomeData)

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
        @page-change="onPageChange"
        @sort-change="onSortChange"
      />
    </div>
  </MainLayout>
</template>
