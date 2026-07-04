import request from '@/utils/request'
import type { Article } from '@/types/article'
import type { PageData } from '@/types/result'

export interface ArticleListParams {
  page?: number
  pageSize?: number
}

export const articleApi = {
  getList(params?: ArticleListParams) {
    return request.get<PageData<Article>>('/articles', { params })
  },
  getDetail(id: number | string) {
    return request.get<Article>(`/articles/${id}`)
  },
}
