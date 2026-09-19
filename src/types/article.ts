export interface Article {
  id: string
  categoryId: string
  authorId: string
  authorName?: string
  categoryName?: string
  title: string
  summary: string
  content: string
  coverUrl: string
  status: number
  viewCount: number
  commentCount?: number
  likeCount?: number
  favoriteCount?: number
  shareCount?: number
  liked?: number
  favorited?: number
  /** 今日独立访客。注意与 viewCount 语义不同：viewCount 是累计浏览量，这个只统计当天 */
  uvCount?: number
  publishedAt: string
  createdAt: string
  updatedAt: string
}
