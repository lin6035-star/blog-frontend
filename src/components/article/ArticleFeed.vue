<script setup lang="ts">
import ArticleCard from '@/components/article/ArticleCard.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import type { ArticleSort } from '@/api/article'
import type { Article } from '@/types/article'

defineProps<{
  articles: Article[]
  loading: boolean
  page: number
  pageSize: number
  total: number
  sort: ArticleSort
}>()

const emit = defineEmits<{
  'page-change': [page: number]
  'sort-change': [sort: ArticleSort]
}>()

const sortTabs: Array<{ label: string; value: ArticleSort }> = [
  { label: '推荐', value: 'recommend' },
  { label: '最新', value: 'latest' },
]
</script>

<template>
  <section class="feed-panel">
    <div class="feed-tabs">
      <button
        v-for="tab in sortTabs"
        :key="tab.value"
        :class="{ active: tab.value === sort }"
        type="button"
        @click="emit('sort-change', tab.value)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div v-if="loading" class="article-list">
      <div v-for="item in 4" :key="item" style="padding: 20px">
        <n-skeleton text style="width: 48%; height: 21px; margin-bottom: 8px" />
        <n-skeleton text style="margin-bottom: 8px" />
        <n-skeleton text style="width: 72%" />
      </div>
    </div>

    <div v-else-if="articles.length" class="article-list">
      <ArticleCard
        v-for="article in articles"
        :key="article.id"
        :article="article"
      />
    </div>

    <EmptyState v-else title="暂无公开文章" description="等后端准备好文章数据后，这里会显示技术信息流。" />

    <!-- 分页 -->
    <div v-if="total > pageSize" class="feed-pagination">
      <n-pagination
        :page="page"
        :page-size="pageSize"
        :item-count="total"
        @update:page="emit('page-change', $event)"
      />
    </div>
  </section>
</template>

<style scoped>
.feed-pagination {
  display: flex;
  justify-content: center;
  padding: 24px 20px 20px;
  border-top: 1px solid var(--color-border);
}
</style>
