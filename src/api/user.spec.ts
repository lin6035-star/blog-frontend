import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('@/utils/request', () => ({
  default: {
    get: getMock,
    post: postMock,
  },
}))

describe('userApi', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('requests current user profile without repeating the /api prefix', async () => {
    const { userApi } = await import('./user')

    userApi.getMe()

    expect(getMock).toHaveBeenCalledWith('/users/me')
  })

  it('uploads avatar with multipart file field named file', async () => {
    const { userApi } = await import('./user')
    const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })

    userApi.uploadAvatar(file)

    const [url, formData, config] = postMock.mock.calls[0]
    expect(url).toBe('/users/me/avatar')
    expect(formData.get('file')).toBe(file)
    expect(config.headers['Content-Type']).toBe('multipart/form-data')
  })
})
