export interface Article {
  id: number
  categoryId: number
  authorId: number
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
  liked?: number
  favorited?: number
  publishedAt: string
  createdAt: string
  updatedAt: string
}
