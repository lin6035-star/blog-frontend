import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const profileView = readFileSync(resolve(__dirname, 'ProfileView.vue'), 'utf8')

describe('profile article tabs layout', () => {
  it('shows four profile tabs and defaults to published articles', () => {
    expect(profileView).toContain("activeTab = ref<ProfileTabKey>('published')")
    expect(profileView).toContain("key: 'published'")
    expect(profileView).toContain("label: '我发布的'")
    expect(profileView).toContain("label: '我喜欢的'")
    expect(profileView).toContain("label: '我收藏的'")
    expect(profileView).toContain("label: '我评论的'")
  })

  it('loads published articles with page size 2 and keeps other tabs as placeholders', () => {
    expect(profileView).toContain('const pageSize = 2')
    expect(profileView).toContain('myArticleApi.getList(currentPage.value, pageSize)')
    expect(profileView).toContain('profile-placeholder-panel')
    expect(profileView).toContain('这个模块的后端接口还没接入')
  })

  it('moves profile identity card left by widening the page grid', () => {
    expect(profileView).toContain('max-width: 1080px')
    expect(profileView).toContain('grid-template-columns: 280px minmax(0, 1fr)')
  })

  it('keeps the profile content close to the top header', () => {
    expect(profileView).toContain('margin: 14px 0 0 30px')
    expect(profileView).toContain('padding: 20px 20px 56px 30px')
  })

  it('uses a history back button instead of refreshing home', () => {
    expect(profileView).toContain('function goBack()')
    expect(profileView).toContain('router.back()')
    expect(profileView).toContain('class="profile-back"')
    expect(profileView).toContain('@click="goBack"')
    expect(profileView).not.toContain('refresh: String(Date.now())')
  })
})
