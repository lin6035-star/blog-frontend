export interface Article {
  id: number
  categoryId: number
  authorId: number
  title: string
  summary: string
  content: string
  coverUrl: string
  viewCount: number
  publishedAt: string
}
