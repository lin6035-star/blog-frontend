<script setup lang="ts">
import { ChatbubbleOutline, Eye } from '@vicons/ionicons5'
import type { Article } from '@/types/article'

defineProps<{
  article: Article
}>()

function formatDate(value: string) {
  if (!value) {
    return '未发布'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}
</script>

<template>
  <article class="article-card">
    <router-link class="article-link" :to="`/articles/${article.id}`">
      <div class="article-main">
        <div class="article-meta">
          <span>作者 #{{ article.authorId }}</span>
          <span>{{ formatDate(article.publishedAt) }}</span>
        </div>
        <h2>{{ article.title }}</h2>
        <p>{{ article.summary || '这篇文章暂时没有摘要，点击查看完整内容。' }}</p>
        <div class="article-stats">
          <span>
            <n-icon><Eye /></n-icon>
            {{ article.viewCount || 0 }}
          </span>
          <span>
            <n-icon><ChatbubbleOutline /></n-icon>
            讨论
          </span>
        </div>
      </div>
      <img
        v-if="article.coverUrl"
        class="article-cover"
        :src="article.coverUrl"
        alt=""
      />
    </router-link>
  </article>
</template>
