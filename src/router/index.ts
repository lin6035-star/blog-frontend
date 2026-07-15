import { createRouter, createWebHistory } from 'vue-router'
import { createDiscreteApi } from 'naive-ui'
import HomeView from '@/views/HomeView.vue'
import ArticleDetailView from '@/views/ArticleDetailView.vue'
import LoginView from '@/views/LoginView.vue'
import RegisterView from '@/views/RegisterView.vue'
import ProfileView from '@/views/ProfileView.vue'
import EditorView from '@/views/EditorView.vue'
import DraftsView from '@/views/DraftsView.vue'
import { useAuthStore } from '@/stores/auth'

const { message } = createDiscreteApi(['message'])

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    }

    return { top: 0 }
  },
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: { title: '首页', keepAlive: true },
    },
    {
      path: '/articles/:id',
      name: 'article-detail',
      component: ArticleDetailView,
      meta: { title: '文章详情' },
    },
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { title: '登录' },
    },
    {
      path: '/register',
      name: 'register',
      component: RegisterView,
      meta: { title: '注册' },
    },
    {
      path: '/me',
      name: 'profile',
      component: ProfileView,
      meta: { title: '个人中心', requiresAuth: true },
    },
    {
      path: '/editor',
      name: 'editor-new',
      component: EditorView,
      meta: { title: '写文章', requiresAuth: true },
    },
    {
      path: '/editor/:id',
      name: 'editor-edit',
      component: EditorView,
      meta: { title: '编辑文章', requiresAuth: true },
    },
    {
      path: '/drafts',
      name: 'drafts',
      component: DraftsView,
      meta: { title: '草稿箱', requiresAuth: true },
    },
  ],
})

router.beforeEach((to) => {
  if (to.meta.requiresAuth && !useAuthStore().isLoggedIn) {
    message.warning('请先登录后再操作亲')
    return false
  }

  return true
})

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? '博客')} - 海林Blog`
})

export default router
