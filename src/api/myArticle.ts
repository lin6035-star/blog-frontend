import request from '@/utils/request'
import type { Article } from '@/types/article'
import type { PageData } from '@/types/result'

export interface ArticleForm {
  categoryId: number | null
  title: string
  summary: string
  content: string
  coverUrl: string
  status: number
}

export const myArticleApi = {
  getList(page: number, pageSize: number, status?: number) {
    return request.get<PageData<Article>>('/users/me/articles', {
      params: status !== undefined ? { page, pageSize, status } : { page, pageSize },
    })
  },
  getDetail(id: number | string) {
    return request.get<Article>(`/users/me/articles/${id}`)
  },
  create(data: ArticleForm) {
    return request.post<number>('/users/me/articles', data)
  },
  update(id: number | string, data: ArticleForm) {
    return request.put(`/users/me/articles/${id}`, data)
  },
  delete(id: number | string) {
    return request.delete(`/users/me/articles/${id}`)
  },
  publish(id: number | string) {
    return request.patch(`/users/me/articles/${id}/publish`)
  },
  hide(id: number | string) {
    return request.patch(`/users/me/articles/${id}/hide`)
  },
  uploadImage(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    return request.post<string>('/users/me/image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}
