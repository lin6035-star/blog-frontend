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
    return request.post<null>('/auth/logout')
  },
}
