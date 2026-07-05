<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useMessage } from 'naive-ui'
import { ArrowBack, Eye } from '@vicons/ionicons5'
import { Marked } from 'marked'
import { articleApi } from '@/api/article'
import MainLayout from '@/layouts/MainLayout.vue'
import type { Article } from '@/types/article'

const route = useRoute()
const message = useMessage()
const article = ref<Article | null>(null)
const loading = ref(false)

const marked = new Marked()

const renderedContent = computed(() => {
  if (!article.value?.content) return ''
  return marked.parse(article.value.content) as string
})

function formatDate(value: string) {
  if (!value) {
    return '未发布'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

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

onMounted(loadArticle)
</script>

<template>
  <MainLayout>
    <router-link class="back-link" to="/">
      <n-icon><ArrowBack /></n-icon>
      返回首页
    </router-link>

    <n-spin :show="loading">
      <article class="detail-panel">
        <template v-if="article">
          <p class="eyebrow">ARTICLE</p>
          <h1>{{ article.title }}</h1>
          <div class="detail-meta">
            <span>作者 #{{ article.authorId }}</span>
            <span>{{ formatDate(article.publishedAt) }}</span>
            <span>
              <n-icon><Eye /></n-icon>
              {{ article.viewCount || 0 }}
            </span>
          </div>
          <p class="detail-summary">{{ article.summary }}</p>
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
