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

      if (!token || !usersVO) {
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
