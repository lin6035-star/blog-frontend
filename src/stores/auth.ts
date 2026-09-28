import { defineStore } from 'pinia'
import type { UsersVO } from '@/types/user'

const TOKEN_KEY = 'blog_token'
const USER_KEY = 'blog_user'

function readStoredUser(): UsersVO | null {
  const rawUser = localStorage.getItem(USER_KEY)

  if (!rawUser) {
    return null
  }

  try {
    return JSON.parse(rawUser) as UsersVO
  } catch {
    localStorage.removeItem(USER_KEY)
    return null
  }
}

/**
 * 本地判断 JWT 是否过期：只读 exp，不验签（签名是后端的事）。
 *
 * 目的是让"已过期"在刷新页面时就被发现，而不是等用户点了操作、请求返回 401
 * 才知道——后者会让界面一直装作还登录着。
 */
function isTokenExpired(token: string): boolean {
  const payload = token.split('.')[1]

  if (!payload) {
    return true
  }

  try {
    // JWT 用 base64url，先转回 base64 并补齐 padding 再解
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      '=',
    )
    const { exp } = JSON.parse(atob(padded)) as { exp?: number }

    // exp 是秒；拿不到 exp 一律当作已过期，宁可让用户重登也不留下假登录态
    return typeof exp !== 'number' || exp * 1000 <= Date.now()
  } catch {
    return true
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: '',
    usersVO: null as UsersVO | null,
  }),
  getters: {
    isLoggedIn: (state) => Boolean(state.token && state.usersVO),
    displayName: (state) =>
      state.usersVO?.nickname || state.usersVO?.username || '创作者',
  },
  actions: {
    restoreAuth() {
      const token = localStorage.getItem(TOKEN_KEY) ?? ''
      const usersVO = readStoredUser()

      if (!token || !usersVO || isTokenExpired(token)) {
        this.clearAuth()
        return
      }

      this.token = token
      this.usersVO = usersVO
    },
    setAuth(token: string, usersVO: UsersVO) {
      this.token = token
      this.usersVO = usersVO
      localStorage.setItem(TOKEN_KEY, token)
      localStorage.setItem(USER_KEY, JSON.stringify(usersVO))
    },
    updateUser(usersVO: UsersVO) {
      this.usersVO = usersVO
      localStorage.setItem(USER_KEY, JSON.stringify(usersVO))
    },
    clearAuth() {
      this.token = ''
      this.usersVO = null
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    },
  },
})
