<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDialog, useMessage, type UploadFileInfo } from 'naive-ui'
import {
  CameraOutline,
  CreateOutline,
  EyeOffOutline,
  EyeOutline,
  LogOutOutline,
  Person,
  RefreshOutline,
  TrashOutline,
} from '@vicons/ionicons5'
import { myArticleApi } from '@/api/myArticle'
import { userApi } from '@/api/user'
import MainLayout from '@/layouts/MainLayout.vue'
import { useAuthStore } from '@/stores/auth'
import type { Article } from '@/types/article'

const router = useRouter()
const authStore = useAuthStore()
const message = useMessage()
const dialog = useDialog()

const user = computed(() => authStore.usersVO)
const profileLoading = ref(false)
const uploading = ref(false)

type ProfileTabKey = 'published' | 'liked' | 'favorited' | 'commented'

const activeTab = ref<ProfileTabKey>('published')
const profileTabs = [
  { key: 'published', label: '我发布的' },
  { key: 'liked', label: '我喜欢的' },
  { key: 'favorited', label: '我收藏的' },
  { key: 'commented', label: '我评论的' },
] satisfies Array<{ key: ProfileTabKey; label: string }>

/* ---- 退出登录 ---- */
function handleLogout() {
  dialog.warning({
    title: '确认退出',
    content: '确定要退出登录吗？',
    positiveText: '退出',
    negativeText: '取消',
    onPositiveClick: () => {
      authStore.clearAuth()
      message.success('已退出登录')
      router.push('/')
    },
  })
}

/* ---- 我的文章 ---- */
const articles = ref<Article[]>([])
const articleLoading = ref(false)
const currentPage = ref(1)
const pageSize = 2
const total = ref(0)

function formatDate(value: string) {
  if (!value) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function statusLabel(status: number) {
  if (status === 0) return '草稿'
  return status === 1 ? '已发布' : '已隐藏'
}

async function loadArticles() {
  articleLoading.value = true
  try {
    const res = await myArticleApi.getList(currentPage.value, pageSize)
    const data = res.data
    articles.value = data.list ?? []
    total.value = data.total ?? 0
  } catch {
    message.error('文章加载失败')
  } finally {
    articleLoading.value = false
  }
}

function goToArticle(article: Article) {
  router.push(`/articles/${article.id}`)
}

function handleEdit(article: Article) {
  router.push(`/editor/${article.id}`)
}

function handleToggleHide(article: Article) {
  const isHidden = article.status === 2
  dialog.warning({
    title: isHidden ? '取消隐藏' : '隐藏文章',
    content: isHidden
      ? `确定要重新公开《${article.title}》吗？`
      : `确定要隐藏《${article.title}》吗？隐藏后仅自己可见。`,
    positiveText: isHidden ? '取消隐藏' : '隐藏',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        if (isHidden) {
          await myArticleApi.publish(article.id)
          article.status = 1
        } else {
          await myArticleApi.hide(article.id)
          article.status = 2
        }
        message.success(isHidden ? '已公开' : '已隐藏')
      } catch {
        message.error('操作失败')
      }
    },
  })
}

function handleDelete(article: Article) {
  dialog.error({
    title: '确认删除',
    content: `确定要删除《${article.title}》吗？删除后无法恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await myArticleApi.delete(article.id)
        message.success('已删除')
        loadArticles()
      } catch {
        message.error('删除失败')
      }
    },
  })
}

function onPageChange(page: number) {
  currentPage.value = page
  loadArticles()
}

function switchTab(key: ProfileTabKey) {
  activeTab.value = key
  currentPage.value = 1
  if (key === 'published') {
    loadArticles()
  }
}

/* ---- 资料刷新 ---- */
async function refreshProfile() {
  profileLoading.value = true
  try {
    const result = await userApi.getMe()
    authStore.updateUser(result.data)
  } catch {
    message.error('用户信息加载失败')
  } finally {
    profileLoading.value = false
  }
}

/* ---- 头像上传 ---- */
async function uploadAvatar(rawFile: File) {
  uploading.value = true
  try {
    const result = await userApi.uploadAvatar(rawFile)
    authStore.updateUser(result.data)
    message.success('头像已更新')
  } catch {
    message.error('头像上传失败')
  } finally {
    uploading.value = false
  }
  return false
}

function handleAvatarChange(data: { file: UploadFileInfo; fileList: UploadFileInfo[] }) {
  if (data.file.file) {
    uploadAvatar(data.file.file)
  }
}

onMounted(() => {
  refreshProfile()
  loadArticles()
})
</script>

<template>
  <MainLayout>
    <div class="profile-layout">
      <!-- 左侧：身份卡片 -->
      <aside class="profile-sidebar">
        <div class="profile-avatar-wrap">
          <n-avatar :size="96" :src="user?.avatarUrl">
            <template #fallback>
              <n-icon><Person /></n-icon>
            </template>
          </n-avatar>
          <n-upload
            :default-upload="false"
            :show-file-list="false"
            accept="image/*"
            @change="handleAvatarChange"
          >
            <n-button class="avatar-action" circle :loading="uploading">
              <template #icon><n-icon><CameraOutline /></n-icon></template>
            </n-button>
          </n-upload>
        </div>

        <h1>{{ authStore.displayName }}</h1>
        <p class="profile-bio">{{ user?.bio || '这个人还没有写简介。' }}</p>

        <div class="profile-sidebar-actions">
          <n-button :loading="profileLoading" @click="refreshProfile" quaternary block>
            <template #icon><n-icon><RefreshOutline /></n-icon></template>
            刷新资料
          </n-button>
          <n-button @click="handleLogout" quaternary block type="error">
            <template #icon><n-icon><LogOutOutline /></n-icon></template>
            退出登录
          </n-button>
        </div>

        <div class="profile-stats" v-if="total">
          <span>共 {{ total }} 篇文章</span>
        </div>
      </aside>

      <!-- 右侧：文章关系区 -->
      <section class="profile-main">
        <header class="profile-main-header">
          <nav class="profile-tabs" aria-label="个人中心内容切换">
            <button
              v-for="tab in profileTabs"
              :key="tab.key"
              type="button"
              class="profile-tab"
              :class="{ active: activeTab === tab.key }"
              @click="switchTab(tab.key)"
            >
              {{ tab.label }}
            </button>
          </nav>
        </header>

        <template v-if="activeTab === 'published'">
          <!-- 加载骨架 -->
          <div v-if="articleLoading" class="profile-articles">
            <div v-for="i in 2" :key="i" class="profile-article-card">
              <n-skeleton text style="width: 48%; height: 20px; margin-bottom: 8px" />
              <n-skeleton text style="margin-bottom: 8px" />
              <n-skeleton text style="width: 72%" />
            </div>
          </div>

          <!-- 空态 -->
          <div v-else-if="!articles.length" class="profile-empty">
            <p>还没有文章</p>
            <router-link class="profile-go-write" to="/editor">去写文章</router-link>
          </div>

          <!-- 文章列表 -->
          <div v-else class="profile-articles">
            <article
              v-for="article in articles"
              :key="article.id"
              class="profile-article-card"
              @click="goToArticle(article)"
            >
              <div class="profile-article-body">
                <div class="profile-article-meta">
                  <span
                    class="profile-article-status"
                    :class="{
                      draft: article.status === 0,
                      published: article.status === 1,
                      hidden: article.status === 2,
                    }"
                  >
                    {{ statusLabel(article.status) }}
                  </span>
                  <span>{{ formatDate(article.updatedAt) }}</span>
                  <span>{{ article.viewCount || 0 }} 次浏览</span>
                </div>
                <h3>{{ article.title }}</h3>
                <p>{{ article.summary || '暂无摘要' }}</p>
              </div>

              <img
                v-if="article.coverUrl"
                :src="article.coverUrl"
                class="profile-article-cover"
                alt="封面"
              />

              <div class="profile-article-actions" @click.stop>
                <button class="pa-btn edit" type="button" @click="handleEdit(article)">
                  <n-icon size="16"><CreateOutline /></n-icon>
                  <span>编辑</span>
                </button>
                <button class="pa-btn hide" type="button" @click="handleToggleHide(article)">
                  <n-icon size="16">
                    <EyeOffOutline v-if="article.status === 1" />
                    <EyeOutline v-else />
                  </n-icon>
                  <span>{{ article.status === 1 ? '隐藏' : '取消隐藏' }}</span>
                </button>
                <button class="pa-btn delete" type="button" @click="handleDelete(article)">
                  <n-icon size="16"><TrashOutline /></n-icon>
                  <span>删除</span>
                </button>
              </div>
            </article>
          </div>

          <!-- 分页 -->
          <div v-if="total > pageSize" class="profile-pagination">
            <n-pagination
              :page="currentPage"
              :page-size="pageSize"
              :item-count="total"
              @update:page="onPageChange"
            />
          </div>
        </template>

        <template v-else>
          <div class="profile-placeholder-panel">
            <p>这个模块的后端接口还没接入，先保留文章列表框架。</p>
            <div class="profile-articles preview">
              <div v-for="i in pageSize" :key="i" class="profile-article-card placeholder">
                <div class="profile-article-body">
                  <div class="profile-article-meta">
                    <span class="profile-article-status muted">待接入</span>
                    <span>分页列表</span>
                  </div>
                  <h3>{{ activeTab === 'liked' ? '我喜欢的文章' : activeTab === 'favorited' ? '我收藏的文章' : '我评论过的文章' }}</h3>
                  <p>后续接入接口后，这里会沿用相同的文章卡片和分页交互。</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 占位分页 -->
          <div class="profile-pagination">
            <n-pagination
              :page="1"
              :page-size="pageSize"
              :item-count="20"
              disabled
            />
          </div>
        </template>
      </section>
    </div>
  </MainLayout>
</template>

<style scoped>
.profile-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 32px;
  max-width: 1080px;
  margin: 0;
  padding: 32px 20px 56px 30px;
}

/* ---- 左侧 ---- */
.profile-sidebar {
  text-align: center;
}

.profile-avatar-wrap {
  position: relative;
  display: inline-block;
  margin-bottom: 16px;
}

.avatar-action {
  position: absolute;
  bottom: 0;
  right: 0;
}

.profile-sidebar h1 {
  margin: 0 0 8px;
  font-size: 22px;
  color: #111;
}

.profile-bio {
  margin: 0 0 16px;
  color: #999;
  font-size: 14px;
  line-height: 1.6;
}

.profile-sidebar-actions {
  display: grid;
  gap: 4px;
}

.profile-stats {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
  color: #999;
  font-size: 13px;
}

/* ---- 右侧 ---- */
.profile-main-header {
  margin-bottom: 18px;
}

.profile-tabs {
  display: flex;
  align-items: center;
  gap: 28px;
  border-bottom: 1px solid #eef0f2;
}

.profile-tab {
  position: relative;
  padding: 0 0 13px;
  border: 0;
  background: transparent;
  color: #666;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  transition: color 0.16s;
}

.profile-tab:hover,
.profile-tab.active {
  color: #111;
}

.profile-tab.active::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 3px;
  border-radius: 999px;
  background: #1e80ff;
  content: '';
}

.profile-articles {
  display: grid;
  gap: 14px;
}

.profile-empty {
  text-align: center;
  padding: 48px 20px;
  color: #999;
}

.profile-go-write {
  display: inline-block;
  margin-top: 12px;
  padding: 8px 20px;
  border-radius: 8px;
  color: #fff;
  background: #2f6f73;
  font-weight: 700;
  text-decoration: none;
}
.profile-go-write:hover {
  background: #25595d;
}

/* ---- 文章卡片 ---- */
.profile-article-card {
  display: flex;
  align-items: stretch;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: box-shadow 0.15s;
}
.profile-article-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.profile-article-cover {
  width: 120px;
  min-height: 80px;
  object-fit: cover;
  flex-shrink: 0;
}

.profile-article-body {
  flex: 1;
  min-width: 0;
  padding: 16px;
}

.profile-article-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
  color: #999;
  font-size: 12px;
}

.profile-article-status {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}
.profile-article-status.draft {
  background: #eef2ff;
  color: #4f46e5;
}
.profile-article-status.published {
  background: #e6f7e8;
  color: #2d8a3e;
}
.profile-article-status.hidden {
  background: #fff3e0;
  color: #e67e22;
}
.profile-article-status.muted {
  background: #f3f4f6;
  color: #888;
}

.profile-article-body h3 {
  margin: 0 0 4px;
  font-size: 17px;
  color: #111;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-article-body p {
  margin: 0;
  color: #999;
  font-size: 13px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ---- 操作按钮 ---- */
.profile-article-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 12px 12px 0;
  flex-shrink: 0;
}

.pa-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
  background: #fff;
  color: #555;
  font-size: 12px;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s;
  white-space: nowrap;
}
.pa-btn:hover {
  border-color: #ccc;
}

.pa-btn.edit:hover {
  color: #2f6f73;
  border-color: #2f6f73;
  background: #f0f9f9;
}
.pa-btn.hide:hover {
  color: #e67e22;
  border-color: #e67e22;
  background: #fef9f3;
}
.pa-btn.delete:hover {
  color: #e74c3c;
  border-color: #e74c3c;
  background: #fef2f2;
}

/* ---- 分页 ---- */
.profile-pagination {
  display: flex;
  justify-content: center;
  padding-top: 24px;
}

.profile-placeholder-panel {
  color: #888;
}

.profile-placeholder-panel > p {
  margin: 4px 0 16px;
  font-size: 13px;
}

.profile-articles.preview {
  opacity: 0.78;
}

.profile-article-card.placeholder {
  cursor: default;
}

@media (max-width: 860px) {
  .profile-layout {
    grid-template-columns: 1fr;
    max-width: 680px;
  }

  .profile-tabs {
    justify-content: space-between;
    gap: 14px;
  }
}

@media (max-width: 560px) {
  .profile-article-card {
    flex-direction: column;
  }

  .profile-article-cover {
    width: 100%;
    height: 132px;
  }

  .profile-article-actions {
    flex-direction: row;
    flex-wrap: wrap;
    padding: 0 16px 16px;
  }
}
</style>
