<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { ArrowBack, Eye } from '@vicons/ionicons5'
import { Marked } from 'marked'
import { articleApi } from '@/api/article'
import MainLayout from '@/layouts/MainLayout.vue'
import type { Article } from '@/types/article'
import { formatArticleDateTime } from '@/utils/format'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const article = ref<Article | null>(null)
const loading = ref(false)

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

onMounted(loadArticle)
</script>

<template>
  <MainLayout>
    <button class="back-link" type="button" @click="goBack">
      <n-icon><ArrowBack /></n-icon>
      返回首页
    </button>

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
        </template>
        <template v-else-if="!loading">
          <h1>文章不存在</h1>
          <p class="detail-summary">请返回首页查看其他公开文章。</p>
        </template>
      </article>
    </n-spin>
  </MainLayout>
</template>
