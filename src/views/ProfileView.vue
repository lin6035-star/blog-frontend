<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDialog, useMessage, type UploadFileInfo } from 'naive-ui'
import {
  ArrowBack,
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
import { ARTICLE_STATUS, getArticleStatusLabel } from '@/constants/articleStatus'
import { userApi } from '@/api/user'
import MainLayout from '@/layouts/MainLayout.vue'
import { useAuthStore } from '@/stores/auth'
import type { Article } from '@/types/article'
import { formatArticleDate, formatArticleDateTime } from '@/utils/format'

const router = useRouter()
const authStore = useAuthStore()
const message = useMessage()
const dialog = useDialog()

const user = computed(() => authStore.usersVO)
const joinedAtText = computed(() =>
  user.value?.createdAt ? formatArticleDate(user.value.createdAt) : '暂无',
)
const PROFILE_BIO_MAX_LENGTH = 50
const profileLoading = ref(false)
const uploading = ref(false)
const profileEditVisible = ref(false)
const profileSaving = ref(false)
const profileForm = reactive({
  nickname: '',
  bio: '',
})

type ProfileTabKey = 'published' | 'liked' | 'favorited' | 'commented'

const activeTab = ref<ProfileTabKey>('published')
const profileTabs = [
  { key: 'published', label: '我发布的' },
  { key: 'liked', label: '我喜欢的' },
  { key: 'favorited', label: '我收藏的' },
  { key: 'commented', label: '我评论的' },
] satisfies Array<{ key: ProfileTabKey; label: string }>

const profileTabText: Record<ProfileTabKey, { empty: string; status: string }> = {
  published: { empty: '还没有文章', status: '我发布的' },
  liked: { empty: '还没有喜欢的文章', status: '喜欢' },
  favorited: { empty: '还没有收藏的文章', status: '收藏' },
  commented: { empty: '还没有评论过文章', status: '评论过' },
}

function goBack() {
  router.back()
}

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

function getArticleTabRequest(key: ProfileTabKey, page: number) {
  if (key === 'liked') {
    return myArticleApi.getLiked(page, pageSize)
  }
  if (key === 'favorited') {
    return myArticleApi.getFavorited(page, pageSize)
  }
  if (key === 'commented') {
    return myArticleApi.getCommented(page, pageSize)
  }
  return myArticleApi.getList(page, pageSize)
}

async function loadArticlesForTab(key: ProfileTabKey = activeTab.value, page = currentPage.value) {
  articleLoading.value = true
  try {
    const res = await getArticleTabRequest(key, page)
    const data = res.data
    articles.value = data.list ?? []
    total.value = data.total ?? 0
    currentPage.value = data.page ?? page
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
  const isHidden = article.status === ARTICLE_STATUS.HIDDEN
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
          article.status = ARTICLE_STATUS.PUBLISHED
        } else {
          await myArticleApi.hide(article.id)
          article.status = ARTICLE_STATUS.HIDDEN
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
        loadArticlesForTab()
      } catch {
        message.error('删除失败')
      }
    },
  })
}

function onPageChange(page: number) {
  loadArticlesForTab(activeTab.value, page)
}

function switchTab(key: ProfileTabKey) {
  if (activeTab.value === key) {
    return
  }

  activeTab.value = key
  articles.value = []
  total.value = 0
  loadArticlesForTab(key, 1)
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

function openProfileEditor() {
  profileForm.nickname = user.value?.nickname ?? ''
  profileForm.bio = (user.value?.bio ?? '').slice(0, PROFILE_BIO_MAX_LENGTH)
  profileEditVisible.value = true
}

async function submitProfile() {
  const nickname = profileForm.nickname.trim()
  if (!nickname) {
    message.warning('昵称不能为空')
    return
  }

  profileSaving.value = true
  try {
    const result = await userApi.updateProfile({
      nickname,
      bio: profileForm.bio.trim().slice(0, PROFILE_BIO_MAX_LENGTH),
    })
    authStore.updateUser(result.data)
    profileEditVisible.value = false
    message.success('资料已更新')
  } catch (error) {
    console.error('资料保存失败', error)
    message.error(error instanceof Error ? error.message : '资料保存失败')
  } finally {
    profileSaving.value = false
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
  loadArticlesForTab()
})
</script>

<template>
  <MainLayout>
    <button class="profile-back" type="button" @click="goBack">
      <n-icon><ArrowBack /></n-icon>
      <span>返回</span>
    </button>

    <div class="profile-layout">
      <div class="profile-top-row">
        <section class="profile-hero-card">
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

          <div class="profile-identity">
            <h1>{{ authStore.displayName }}</h1>
          </div>

          <div class="profile-bio-panel">
            <p class="profile-bio">{{ user?.bio || '这个人还没有写简介。' }}</p>
            <div class="profile-stats" v-if="total">
              <span>共 {{ total }} 篇文章</span>
            </div>
          </div>

          <div class="profile-hero-actions">
            <n-button @click="openProfileEditor" quaternary block>
              <template #icon><n-icon><CreateOutline /></n-icon></template>
              编辑资料
            </n-button>
            <n-button :loading="profileLoading" @click="refreshProfile" quaternary block>
              <template #icon><n-icon><RefreshOutline /></n-icon></template>
              刷新资料
            </n-button>
            <n-button @click="handleLogout" quaternary block type="error">
              <template #icon><n-icon><LogOutOutline /></n-icon></template>
              退出登录
            </n-button>
          </div>
        </section>

        <aside class="profile-side-card">
          <div class="profile-follow-row">
            <div class="profile-follow-item">
              <span class="profile-follow-label">关注了</span>
              <strong>0</strong>
            </div>
            <div class="profile-follow-item">
              <span class="profile-follow-label">关注者</span>
              <strong>0</strong>
            </div>
          </div>
          <div class="profile-join-row">
            <span>加入于</span>
            <strong>{{ joinedAtText }}</strong>
          </div>
        </aside>
      </div>

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

        <!-- 加载骨架 -->
        <div v-if="articleLoading" class="profile-articles">
          <div v-for="i in pageSize" :key="i" class="profile-article-card">
            <n-skeleton text style="width: 48%; height: 20px; margin-bottom: 8px" />
            <n-skeleton text style="margin-bottom: 8px" />
            <n-skeleton text style="width: 72%" />
          </div>
        </div>

        <!-- 空态 -->
        <div v-else-if="!articles.length" class="profile-empty">
          <p class="profile-tab-empty-title">{{ profileTabText[activeTab].empty }}</p>
          <router-link
            v-if="activeTab === 'published'"
            class="profile-go-write"
            to="/editor"
          >
            去写文章
          </router-link>
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
                  v-if="activeTab === 'published'"
                  class="profile-article-status"
                  :class="{
                    draft: article.status === ARTICLE_STATUS.DRAFT,
                    published: article.status === ARTICLE_STATUS.PUBLISHED,
                    hidden: article.status === ARTICLE_STATUS.HIDDEN,
                  }"
                >
                  {{ getArticleStatusLabel(article.status) }}
                </span>
                <span v-else class="profile-article-status muted">
                  {{ profileTabText[activeTab].status }}
                </span>
                <span>{{ formatArticleDateTime(activeTab === 'published' ? article.updatedAt : article.publishedAt) }}</span>
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

            <div v-if="activeTab === 'published'" class="profile-article-actions" @click.stop>
              <button class="pa-btn edit" type="button" @click="handleEdit(article)">
                <n-icon size="16"><CreateOutline /></n-icon>
                <span>编辑</span>
              </button>
              <button class="pa-btn hide" type="button" @click="handleToggleHide(article)">
                <n-icon size="16">
                  <EyeOffOutline v-if="article.status === ARTICLE_STATUS.PUBLISHED" />
                  <EyeOutline v-else />
                </n-icon>
                <span>{{ article.status === ARTICLE_STATUS.PUBLISHED ? '隐藏' : '取消隐藏' }}</span>
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
      </section>
    </div>

    <n-modal v-model:show="profileEditVisible" preset="card" title="编辑资料" class="profile-edit-modal">
      <n-form label-placement="top">
        <n-form-item label="昵称">
          <n-input
            v-model:value="profileForm.nickname"
            maxlength="30"
            show-count
            placeholder="请输入昵称"
          />
        </n-form-item>
        <n-form-item label="个人简介">
          <n-input
            v-model:value="profileForm.bio"
            type="textarea"
            :maxlength="PROFILE_BIO_MAX_LENGTH"
            show-count
            placeholder="写一点关于自己的介绍"
            :autosize="{ minRows: 2, maxRows: 3 }"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <div class="profile-edit-actions">
          <n-button @click="profileEditVisible = false">取消</n-button>
          <n-button type="primary" :loading="profileSaving" @click="submitProfile">保存</n-button>
        </div>
      </template>
    </n-modal>
  </MainLayout>
</template>

<style scoped>
.profile-back {
  display: flex;
  align-items: center;
  gap: 6px;
  width: min(calc(100% - 36px), 1200px);
  margin: 6px auto 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: #2f6f73;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.profile-layout {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  max-width: 1200px;
  margin: 0 auto;
  padding: 10px 18px 56px;
}

/* ---- 顶部身份卡片 ---- */
.profile-top-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  align-items: stretch;
  gap: 16px;
  width: 100%;
}

.profile-hero-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 132px;
  grid-template-rows: auto 1fr;
  align-items: start;
  column-gap: 18px;
  row-gap: 10px;
  width: 100%;
  min-height: 136px;
  padding: 24px 32px;
  border: 1px solid #eef0f2;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.03);
}

.profile-avatar-wrap {
  position: relative;
  display: inline-block;
  grid-row: 1 / 3;
  width: 96px;
  height: 96px;
  flex-shrink: 0;
}

.avatar-action {
  position: absolute;
  bottom: 0;
  right: 0;
}

.profile-identity {
  position: static;
  top: auto;
  align-self: start;
  min-width: 0;
  padding-top: 6px;
  text-align: left;
}

.profile-identity h1 {
  margin: 0;
  color: #111;
  font-size: 28px;
  line-height: 1.25;
  text-align: left;
}

.profile-bio-panel {
  grid-column: 2;
  grid-row: 2;
  align-self: stretch;
  min-width: 0;
  padding-top: 2px;
  text-align: left;
}

.profile-bio {
  margin: 0;
  color: #666;
  font-size: 15px;
  line-height: 1.7;
  word-break: break-word;
}

.profile-hero-actions {
  display: grid;
  grid-column: 3;
  grid-row: 1 / 3;
  gap: 8px;
  align-self: center;
}

.profile-stats {
  margin-top: 14px;
  color: #999;
  font-size: 13px;
}

.profile-side-card {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 136px;
  border: 1px solid #eef0f2;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.03);
  overflow: hidden;
}

.profile-follow-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-bottom: 1px solid #eef0f2;
}

.profile-follow-item {
  display: grid;
  justify-items: center;
  gap: 4px;
  padding: 18px 12px;
  color: #1f2d3d;
}

.profile-follow-item + .profile-follow-item {
  border-left: 1px solid #eef0f2;
}

.profile-follow-label,
.profile-join-row span {
  color: #4b5563;
  font-size: 15px;
}

.profile-follow-item strong {
  color: #1f2d3d;
  font-size: 18px;
  line-height: 1;
}

.profile-join-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 18px 20px;
}

.profile-join-row strong {
  color: #1f2937;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
}

.profile-edit-modal {
  max-width: 520px;
}

.profile-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* ---- 内容区 ---- */
.profile-main {
  min-height: 520px;
  border: 1px solid #eef0f2;
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}

.profile-main-header {
  margin-bottom: 0;
}

.profile-tabs {
  display: flex;
  align-items: center;
  gap: 28px;
  padding: 0 24px;
  border-bottom: 1px solid #eef0f2;
}

.profile-tab {
  position: relative;
  padding: 18px 0 15px;
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
  padding: 18px 20px 0;
}

.profile-empty {
  text-align: center;
  padding: 92px 20px;
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
  padding: 24px 20px;
}

@media (max-width: 860px) {
  .profile-layout {
    max-width: 680px;
  }

  .profile-top-row {
    grid-template-columns: 1fr;
  }

  .profile-hero-card {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto auto;
    gap: 20px;
    padding: 24px;
  }

  .profile-avatar-wrap {
    grid-row: 1 / 3;
  }

  .profile-bio-panel {
    grid-column: 2;
    grid-row: 2;
  }

  .profile-hero-actions {
    grid-column: 1 / -1;
    grid-row: 3;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .profile-tabs {
    justify-content: space-between;
    gap: 14px;
  }

  .profile-side-card {
    min-height: auto;
  }
}

@media (max-width: 560px) {
  .profile-layout {
    padding: 16px 14px 44px;
  }

  .profile-hero-card {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
    justify-items: center;
    text-align: center;
  }

  .profile-avatar-wrap,
  .profile-bio-panel,
  .profile-hero-actions {
    grid-column: auto;
    grid-row: auto;
  }

  .profile-identity {
    padding-top: 0;
    text-align: center;
  }

  .profile-identity h1,
  .profile-bio-panel {
    text-align: center;
  }

  .profile-follow-item {
    padding: 14px 10px;
  }

  .profile-join-row {
    padding: 14px 16px;
  }

  .profile-identity h1 {
    font-size: 24px;
  }

  .profile-hero-actions {
    width: 100%;
  }

  .profile-tabs {
    overflow-x: auto;
    justify-content: flex-start;
    padding: 0 16px;
  }

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
