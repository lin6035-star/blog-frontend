import { describe, expect, it } from 'vitest'
import { formatArticleDate, formatArticleDateTime } from './format'

describe('date formatting helpers', () => {
  it('formats published article dates for article cards', () => {
    expect(formatArticleDate('2026-07-05T16:21:04')).toMatch(/^2026\/07\/05$/)
  })

  it('returns the article fallback label when no published date exists', () => {
    expect(formatArticleDate('')).toBe('未发布')
  })

  it('formats article timestamps with time for management views', () => {
    expect(formatArticleDateTime('2026-07-05T16:21:04')).toContain('2026')
    expect(formatArticleDateTime('2026-07-05T16:21:04')).toContain('16')
  })

  it('keeps empty management timestamps empty', () => {
    expect(formatArticleDateTime('')).toBe('')
  })

  it('supports a custom fallback label for empty timestamps', () => {
    expect(formatArticleDateTime('', '未发布')).toBe('未发布')
  })
})
