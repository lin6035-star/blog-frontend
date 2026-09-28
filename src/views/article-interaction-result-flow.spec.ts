// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcRoot = resolve(__dirname, '..')

function readSource(path: string) {
  return readFileSync(resolve(srcRoot, path), 'utf8')
}

describe('article interaction result flow', () => {
  it('routes STOP actionResults through the dedicated refresh bus', () => {
    const api = readSource('api/ai.ts')
    const assistant = readSource('components/ai/AiAssistant.vue')

    expect(api).toContain('actionResults?: ArticleInteractionResult[]')
    expect(api).toContain('data.actionResults')
    expect(assistant).toContain('emitAiArticleResults')
    expect(assistant).toContain('actionResults')
  })

  it('refreshes authority for the matching article without executing writes again', () => {
    const detail = readSource('views/ArticleDetailView.vue')
    const start = detail.indexOf('async function handleAiArticleResults')
    const end = detail.indexOf('\n}', start) + 2
    const handler = detail.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(handler).toContain('loadArticle()')
    expect(handler).not.toContain('handleLike')
    expect(handler).not.toContain('handleFavorite')
    expect(handler).not.toContain('handleAuthorFollow')
    expect(handler).not.toContain('articleApi.like')
    expect(handler).not.toContain('publicUserApi.follow')
    expect(detail).toContain('registerAiArticleResultHandler(handleAiArticleResults)')
    expect(detail).toContain('unregisterAiArticleResultHandler(handleAiArticleResults)')
  })
})
