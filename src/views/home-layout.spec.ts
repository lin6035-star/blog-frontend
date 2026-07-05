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
    expect(header).toContain('class="creator-trigger" type="button"')
    expect(header).not.toContain('to="/write"')
    expect(header).not.toContain('to="/drafts"')
    expect(header).not.toContain("router.push('/login')")
    expect(header).not.toContain("router.push('/register')")
  })

  it('keeps categories in the left rail without showing the home tag strip', () => {
    const home = readSource('views/HomeView.vue')

    expect(home).not.toContain('RightSidebar')
    expect(home).not.toContain('home-hero')
    expect(home).not.toContain('class="tag-strip"')
    expect(home).toContain('class="category-rail"')
    expect(home).toContain('class="feed-layout home-feed-layout"')
  })

  it('selects a category from the left rail and passes categoryId when loading articles', () => {
    const home = readSource('views/HomeView.vue')

    expect(home).toContain('selectedCategoryId')
    expect(home).toContain('function onCategorySelect(category: Category)')
    expect(home).toContain('categoryId:')
    expect(home).toContain('@click="onCategorySelect(category)"')
    expect(home).toContain(':class="{ active: category.id === selectedCategoryId }"')
  })

  it('uses the top feed tabs as recommend/latest sort controls', () => {
    const home = readSource('views/HomeView.vue')
    const feed = readSource('components/article/ArticleFeed.vue')

    expect(home).toContain("selectedSort = ref<ArticleSort>('recommend')")
    expect(home).toContain('sort: selectedSort.value')
    expect(home).toContain('function onSortChange(sort: ArticleSort)')
    expect(home).toContain(':sort="selectedSort"')
    expect(home).toContain('@sort-change="onSortChange"')
    expect(feed).toContain("sortTabs")
    expect(feed).toContain("value: 'recommend'")
    expect(feed).toContain("value: 'latest'")
    expect(feed).not.toContain('<button type="button">后端</button>')
    expect(feed).not.toContain('<button type="button">前端</button>')
  })

  it('shows article author nickname and category tag in the card meta row', () => {
    const articleCard = readSource('components/article/ArticleCard.vue')
    const articleType = readSource('types/article.ts')

    expect(articleType).toContain('authorName?: string')
    expect(articleType).toContain('categoryName?: string')
    expect(articleCard).toContain('作者：{{ authorDisplayName }}')
    expect(articleCard).toContain('class="article-category-tag"')
    expect(articleCard).toContain('#{{ article.categoryName }}')
    expect(articleCard).not.toContain('作者 #{{ article.authorId }}')
  })

  it('shows article author nickname and category tag in the detail meta row', () => {
    const detail = readSource('views/ArticleDetailView.vue')

    expect(detail).toContain('authorDisplayName')
    expect(detail).toContain('作者：{{ authorDisplayName }}')
    expect(detail).toContain('class="article-category-tag"')
    expect(detail).toContain('#{{ article.categoryName }}')
    expect(detail).not.toContain('作者 #{{ article.authorId }}')
  })

  it('keeps avatar hover circular without the old red border ring', () => {
    const css = readSource('styles/index.css')
    const hoverStart = css.indexOf('.header-avatar-link:hover')
    const hoverBlock = css.slice(hoverStart, css.indexOf('}', hoverStart))

    expect(css).toContain('.header-avatar-link:hover')
    expect(hoverBlock).toContain('scale(1.08)')
    expect(hoverBlock).not.toContain('border-color')
  })

  it('caches the home route and restores browser back scroll positions', () => {
    const app = readSource('App.vue')
    const router = readSource('router/index.ts')
    const home = readSource('views/HomeView.vue')

    expect(router).toContain('scrollBehavior')
    expect(router).toContain('if (savedPosition)')
    expect(router).toContain('meta: { title: \'首页\', keepAlive: true }')
    expect(app).toContain('<router-view v-slot="{ Component }">')
    expect(app).toContain('<KeepAlive include="HomeView">')
    expect(app).toContain('<component :is="Component" />')
    expect(home).toContain("defineOptions({ name: 'HomeView' })")
  })

  it('refreshes home state only when users actively click header home entries', () => {
    const header = readSource('components/layout/AppHeader.vue')
    const home = readSource('views/HomeView.vue')

    expect(header).toContain('function goHomeFresh()')
    expect(header).toContain("query: { refresh: String(Date.now()) }")
    expect(header).toContain('@click.prevent="goHomeFresh"')
    expect(home).toContain('const router = useRouter()')
    expect(home).toContain('function resetHomeState()')
    expect(home).toContain('route.query.refresh')
    expect(home).toContain('resetHomeState()')
    expect(home).toContain('router.replace')
    expect(home).toContain('delete cleanQuery.refresh')
  })

  it('uses history back for the article detail return button', () => {
    const detail = readSource('views/ArticleDetailView.vue')

    expect(detail).toContain('const router = useRouter()')
    expect(detail).toContain('function goBack()')
    expect(detail).toContain('router.back()')
    expect(detail).toContain('@click="goBack"')
    expect(detail).not.toContain('class="back-link" to="/"')
  })

  it('does not show the article summary on the detail page', () => {
    const detail = readSource('views/ArticleDetailView.vue')

    expect(detail).not.toContain('{{ article.summary }}')
    expect(detail).toContain('请返回首页查看其他公开文章。')
  })
})
