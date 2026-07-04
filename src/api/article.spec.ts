import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMock = vi.fn()

vi.mock('@/utils/request', () => ({
  default: {
    get: getMock,
  },
}))

describe('articleApi', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it('requests public articles without repeating the /api prefix', async () => {
    const { articleApi } = await import('./article')

    articleApi.getList()

    expect(getMock).toHaveBeenCalledWith('/articles')
  })

  it('requests public article detail without repeating the /api prefix', async () => {
    const { articleApi } = await import('./article')

    articleApi.getDetail(12)

    expect(getMock).toHaveBeenCalledWith('/articles/12')
  })
})
