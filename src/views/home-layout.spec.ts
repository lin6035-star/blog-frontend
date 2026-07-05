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
    expect(header).toContain('class="header-search"')
    expect(header).toContain('class="creator-center"')
    expect(header).toContain('class="creator-popover"')
    expect(header).toContain('<button type="button">')
    expect(header).not.toContain('to="/write"')
    expect(header).not.toContain('to="/drafts"')
    expect(header).not.toContain("router.push('/login')")
    expect(header).not.toContain("router.push('/register')")
  })

  it('moves categories to the left rail and tags to the centered top strip', () => {
    const home = readSource('views/HomeView.vue')

    expect(home).not.toContain('RightSidebar')
    expect(home).not.toContain('home-hero')
    expect(home).toContain('class="tag-strip"')
    expect(home).toContain('class="category-rail"')
    expect(home).toContain('class="feed-layout"')
  })

  it('keeps avatar hover circular without the old red border ring', () => {
    const css = readSource('styles/index.css')
    const hoverStart = css.indexOf('.header-avatar-link:hover')
    const hoverBlock = css.slice(hoverStart, css.indexOf('}', hoverStart))

    expect(css).toContain('.header-avatar-link:hover')
    expect(hoverBlock).toContain('scale(1.08)')
    expect(hoverBlock).not.toContain('border-color')
  })
})
