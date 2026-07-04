import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const registerView = readFileSync(resolve(__dirname, 'RegisterView.vue'), 'utf8')
const loginCss = readFileSync(resolve(__dirname, '../styles/login-characters.css'), 'utf8')

describe('register page compact layout', () => {
  it('uses a register-specific compact layout instead of inline scaling', () => {
    expect(registerView).toContain('class="login-page register-page"')
    expect(registerView).not.toContain('transform: scale')
    expect(loginCss).toContain('.register-page .login-right')
    expect(loginCss).toContain('.register-page .login-star')
  })
})
