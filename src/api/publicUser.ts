import request from '@/utils/request'
import type { Article } from '@/types/article'
import type { PublicUserInfo, UserRelation } from '@/types/publicUser'
import type { PageData } from '@/types/result'

export const publicUserApi = {
  getInfo(id: number | string) {
    return request.get<PublicUserInfo>(`/users/${id}`)
  },
  getArticles(id: number | string, page: number, pageSize: number) {
    return request.get<PageData<Article>>(`/users/${id}/articles`, {
      params: { page, pageSize },
    })
  },
  getLiked(id: number | string, page: number, pageSize: number) {
    return request.get<PageData<Article>>(`/users/${id}/liked`, {
      params: { page, pageSize },
    })
  },
  getFavorited(id: number | string, page: number, pageSize: number) {
    return request.get<PageData<Article>>(`/users/${id}/favorited`, {
      params: { page, pageSize },
    })
  },
  getCommented(id: number | string, page: number, pageSize: number) {
    return request.get<PageData<Article>>(`/users/${id}/commented`, {
      params: { page, pageSize },
    })
  },
  getFollowing(id: number | string, page: number, pageSize: number) {
    return request.get<PageData<UserRelation>>(`/users/${id}/following`, {
      params: { page, pageSize },
    })
  },
  getFollowers(id: number | string, page: number, pageSize: number) {
    return request.get<PageData<UserRelation>>(`/users/${id}/followers`, {
      params: { page, pageSize },
    })
  },
  follow(id: number | string) {
    return request.post(`/users/${id}/follow`)
  },
  cancelFollow(id: number | string) {
    return request.delete(`/users/${id}/follow`)
  },
}
