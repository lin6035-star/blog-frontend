import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, 'AvatarPreviewModal.vue'), 'utf8')

describe('avatar preview modal layout', () => {
  it('keeps the enlarged image centered with the download action below it', () => {
    expect(source).toContain('class="avatar-preview-overlay"')
    expect(source).toContain('class="avatar-preview-img"')
    expect(source).toContain('class="avatar-preview-toolbar"')
    expect(source).toContain('width: min(76vw, 720px)')
    expect(source).toContain('max-height: min(76vh, 720px)')
    expect(source).toContain('width: min(76vw, 720px)')
    expect(source).toContain('justify-content: center')
  })

  it('keeps the close button fixed at the upper-right corner', () => {
    const closeStart = source.indexOf('.avatar-preview-close')
    const closeBlock = source.slice(closeStart, source.indexOf('}', closeStart))

    expect(closeBlock).toContain('position: fixed')
    expect(closeBlock).toContain('top: 16px')
    expect(closeBlock).toContain('right: 16px')
  })
})
