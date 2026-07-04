import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcRoot = resolve(__dirname, '..')

function readSource(path: string) {
  return readFileSync(resolve(srcRoot, path), 'utf8')
}

describe('home information-flow layout', () => {
  it('uses custom top-right auth links instead of Element Plus buttons', () => {
    const header = readSource('components/layout/AppHeader.vue')

    expect(header).toContain('class="auth-link login-link"')
    expect(header).toContain('class="auth-link register-link"')
    expect(header).not.toContain("router.push('/login')")
    expect(header).not.toContain("router.push('/register')")
  })

  it('moves categories to the left rail and tags to the centered top strip', () => {
    const home = readSource('views/HomeView.vue')

    expect(home).not.toContain('RightSidebar')
    expect(home).toContain('class="tag-strip"')
    expect(home).toContain('class="category-rail"')
    expect(home).toContain('class="feed-layout"')
  })
})
