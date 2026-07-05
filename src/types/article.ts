export interface Article {
  id: number
  categoryId: number
  authorId: number
  title: string
  summary: string
  content: string
  coverUrl: string
  status: number
  viewCount: number
  publishedAt: string
  createdAt: string
  updatedAt: string
}
