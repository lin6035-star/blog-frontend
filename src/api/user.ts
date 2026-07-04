import request from '@/utils/request'
import type { UsersVO } from '@/types/user'

export const userApi = {
  getMe() {
    return request.get<UsersVO>('/users/me')
  },
  uploadAvatar(file: File) {
    const formData = new FormData()
    formData.append('file', file)

    return request.post<UsersVO>('/users/me/avatar', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
  },
}
