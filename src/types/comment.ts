export interface Comment {
  id: number
  articleId: number
  userId: number
  nickname: string
  avatarUrl?: string | null
  content: string
  rootId: number | null
  parentId: number | null
  replyToNickname?: string | null
  ipLocation?: string | null
  likeCount: number
  liked: boolean
  createdAt: string
  replies: Comment[]
  replyCount: number
}

export type CommentSort = 'time' | 'hot'
