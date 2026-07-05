<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useMessage } from 'naive-ui'
import { articleApi } from '@/api/article'
import { categoryApi } from '@/api/category'
import { tagApi } from '@/api/tag'
import ArticleFeed from '@/components/article/ArticleFeed.vue'
import MainLayout from '@/layouts/MainLayout.vue'
import type { Article } from '@/types/article'
import type { Category } from '@/types/category'
import type { PageData } from '@/types/result'
import type { Tag } from '@/types/tag'

const route = useRoute()
const message = useMessage()
const articles = ref<Article[]>([])
const categories = ref<Category[]>([])
const tags = ref<Tag[]>([])
const loading = ref(false)

/* ---- 分页 ---- */
const currentPage = ref(1)
const pageSize = 10
const totalArticles = ref(0)

const searchKeyword = computed(() => (route.query.keyword as string) ?? '')

const fallbackCategories: Category[] = [
  { id: 0, name: '综合', code: 'general', description: '全部内容' },
  { id: -1, name: '后端', code: 'backend', description: 'Java / Spring Boot' },
  { id: -2, name: '前端', code: 'frontend', description: 'Vue / TypeScript' },
  { id: -3, name: '人工智能', code: 'ai', description: 'AI / Agent' },
]

const fallbackTags: Tag[] = [
  { id: 0, name: '全部' },
  { id: -1, name: 'Java' },
  { id: -2, name: 'Vue3' },
  { id: -3, name: 'AI Coding' },
]

const categoryItems = computed(() =>
  categories.value.length ? categories.value : fallbackCategories,
)
const tagItems = computed(() => (tags.value.length ? tags.value : fallbackTags))

async function loadArticles() {
  loading.value = true

  try {
    const result = await articleApi.getList({
      page: currentPage.value,
      pageSize,
      keyword: searchKeyword.value || undefined,
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
    const [categoryResult, tagResult] = await Promise.all([
      categoryApi.getList(),
      tagApi.getList(),
    ])
    categories.value = categoryResult.data ?? []
    tags.value = tagResult.data ?? []
  } catch {
    // 分类/标签加载失败时使用 fallback，不阻断页面
  }

  await loadArticles()
}

function onPageChange(page: number) {
  currentPage.value = page
  loadArticles()
}

onMounted(loadHomeData)

watch(
  () => route.query.keyword,
  () => {
    currentPage.value = 1
    loadArticles()
  },
)
</script>

<template>
  <MainLayout>
    <nav class="tag-strip" aria-label="标签导航">
      <button
        v-for="tag in tagItems"
        :key="tag.id"
        :class="{ active: tag.id === tagItems[0]?.id }"
        type="button"
      >
        {{ tag.name }}
      </button>
    </nav>

    <div class="feed-layout">
      <aside class="category-rail" aria-label="分类导航">
        <button
          v-for="category in categoryItems"
          :key="category.id"
          :class="{ active: category.id === categoryItems[0]?.id }"
          type="button"
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
        :total="totalArticles"
        @page-change="onPageChange"
      />
    </div>
  </MainLayout>
</template>
