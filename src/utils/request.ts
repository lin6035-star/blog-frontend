import axios, {
  type AxiosAdapter,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import type { Result } from '@/types/result'

interface CreateRequestOptions {
  getToken?: () => string
  adapter?: AxiosAdapter
  onUnauthorized?: () => void
}

type AxiosMethods = 'get' | 'post' | 'put' | 'patch' | 'delete'
const TOKEN_KEY = 'blog_token'
const USER_KEY = 'blog_user'

export type ResultRequest = Omit<AxiosInstance, AxiosMethods> & {
  get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<Result<T>>
  post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<Result<T>>
  put<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<Result<T>>
  patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<Result<T>>
  delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<Result<T>>
}

function readLocalAuthToken() {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  if (!token) {
    return ''
  }

  const rawUser = localStorage.getItem(USER_KEY)
  if (!rawUser) {
    localStorage.removeItem(TOKEN_KEY)
    return ''
  }

  try {
    JSON.parse(rawUser)
    return token
  } catch {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    return ''
  }
}

export function createRequest(options: CreateRequestOptions = {}): ResultRequest {
  const instance = axios.create({
    baseURL: '/api',
    timeout: 10000,
    adapter: options.adapter,
  })

  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = options.getToken ? options.getToken() : readLocalAuthToken()

    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }

    return config
  })

  instance.interceptors.response.use(
    (response) => {
      const result = response.data as Result

      if (typeof result?.code === 'number' && result.code !== 0) {
        if (result.code === 40100) {
          options.onUnauthorized?.()
        }

        return Promise.reject(new Error(result.message || '请求失败'))
      }

      return result as unknown as AxiosResponse
    },
    (error) => Promise.reject(error),
  )

  return instance as ResultRequest
}

const request = createRequest()

export default request
