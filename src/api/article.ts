import request from '@/utils/request'
import type { Article } from '@/types/article'
import type { PageData } from '@/types/result'

export interface ArticleListParams {
  page?: number
  pageSize?: number
  keyword?: string
  categoryId?: number
  sort?: ArticleSort
}

export type ArticleSort = 'recommend' | 'latest'

export const articleApi = {
  getList(params?: ArticleListParams) {
    return request.get<PageData<Article>>('/articles', { params })
  },
  getDetail(id: number | string) {
    return request.get<Article>(`/articles/${id}`)
  },
  like(articleId: number) {
    return request.post(`/articles/${articleId}/like`)
  },
  unlike(articleId: number) {
    return request.delete(`/articles/${articleId}/like`)
  },
  favorite(articleId: number) {
    return request.post(`/articles/${articleId}/favorite`)
  },
  unfavorite(articleId: number) {
    return request.delete(`/articles/${articleId}/favorite`)
  },
}
