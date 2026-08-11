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
  publishedAt: string
  createdAt: string
  updatedAt: string
}
