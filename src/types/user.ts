export interface UsersVO {
  id: number
  username: string
  nickname: string
  avatarUrl: string
  bio: string
  followersCount: number
  followingCount: number
  createdAt: string
}

export interface UserProfileDTO {
  nickname: string
  bio: string
}

export interface AuthVO {
  token: string
  usersVO: UsersVO
}

export interface LoginDTO {
  username: string
  password: string
}

export interface RegisterDTO {
  username: string
  password: string
  confirmPassword: string
  nickname: string
}
