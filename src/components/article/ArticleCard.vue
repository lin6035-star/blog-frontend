<script setup lang="ts">
import { computed } from 'vue'
import { ChatbubbleOutline, Eye } from '@vicons/ionicons5'
import type { Article } from '@/types/article'
import { formatArticleDate } from '@/utils/format'

const props = defineProps<{
  article: Article
}>()

const authorDisplayName = computed(() =>
  props.article.authorName?.trim() || `#${props.article.authorId}`,
)
</script>

<template>
  <article class="article-card">
    <router-link class="article-link" :to="`/articles/${article.id}`">
      <div class="article-main">
        <div class="article-meta">
          <span>作者：{{ authorDisplayName }}</span>
          <span>{{ formatArticleDate(article.publishedAt) }}</span>
          <span v-if="article.categoryName" class="article-category-tag">
            #{{ article.categoryName }}
          </span>
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
