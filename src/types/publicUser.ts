export interface PublicUserInfo {
  id: number
  nickname: string
  avatarUrl?: string
  bio?: string
  articlesCount: number
  followersCount: number
  followingCount: number
  followed: boolean
  self: boolean
  createdAt: string
}

export interface UserRelation {
  id: number
  nickname: string
  avatarUrl?: string
  bio?: string
  followed: boolean
  self: boolean
}
