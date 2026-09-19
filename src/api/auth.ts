import request from '@/utils/request'
import type { AuthVO, LoginDTO, RegisterDTO } from '@/types/user'

export const authApi = {
  login(data: LoginDTO) {
    return request.post<AuthVO>('/auth/login', data)
  },
  register(data: RegisterDTO) {
    return request.post<AuthVO>('/auth/register', data)
  },
  logout() {
    // 单独设短超时：退出登录不该被后端拖住（默认 60s 太长），
    // 拿不到响应时前端仍会清本地状态，见 ProfileView 的 handleLogout
    return request.post<null>('/auth/logout', undefined, { timeout: 3000 })
  },
  getGitHubAuthUrl() {
    return request.get<{ url: string }>('/auth/github/url')
  },
}
