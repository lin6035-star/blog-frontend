<script setup lang="ts">
import { computed } from 'vue'
import {
  ChatbubbleOutline,
  Eye,
  Heart,
  HeartOutline,
  Star,
  StarOutline,
} from '@vicons/ionicons5'
import type { Article } from '@/types/article'
import { formatArticleDate } from '@/utils/format'

const props = defineProps<{
  article: Article
}>()

const emit = defineEmits<{
  open: [article: Article]
  like: [article: Article]
  favorite: [article: Article]
  'author-click': [authorId: number]
}>()

const authorDisplayName = computed(() =>
  props.article.authorName?.trim() || `#${props.article.authorId}`,
)
</script>

<template>
  <article class="article-card">
    <div
      class="article-link"
      role="link"
      tabindex="0"
      @click="emit('open', article)"
      @keydown.enter="emit('open', article)"
    >
      <div class="article-main">
        <div class="article-meta">
          <button
            class="article-author-link"
            type="button"
            @click.prevent.stop="emit('author-click', article.authorId)"
          >
            作者：{{ authorDisplayName }}
          </button>
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
            {{ article.commentCount || 0 }}
          </span>
          <button
            class="article-stat-btn"
            :class="{ active: article.liked === 1 }"
            type="button"
            @click.prevent.stop="emit('like', article)"
          >
            <n-icon>
              <Heart v-if="article.liked === 1" />
              <HeartOutline v-else />
            </n-icon>
            {{ article.likeCount || 0 }}
          </button>
          <button
            class="article-stat-btn"
            :class="{ active: article.favorited === 1 }"
            type="button"
            @click.prevent.stop="emit('favorite', article)"
          >
            <n-icon>
              <Star v-if="article.favorited === 1" />
              <StarOutline v-else />
            </n-icon>
            {{ article.favoriteCount || 0 }}
          </button>
        </div>
      </div>
      <img
        v-if="article.coverUrl"
        class="article-cover"
        :src="article.coverUrl"
        alt=""
      />
    </div>
  </article>
</template>
