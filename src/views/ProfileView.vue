<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useMessage, type UploadFileInfo } from 'naive-ui'
import { CameraOutline, RefreshOutline, Person } from '@vicons/ionicons5'
import { userApi } from '@/api/user'
import MainLayout from '@/layouts/MainLayout.vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const message = useMessage()
const loading = ref(false)
const uploading = ref(false)

const user = computed(() => authStore.usersVO)

function formatDate(value?: string) {
  if (!value) {
    return '暂无'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

async function refreshProfile() {
  loading.value = true

  try {
    const result = await userApi.getMe()
    authStore.updateUser(result.data)
  } catch (error) {
    const msg = error instanceof Error ? error.message : '用户信息加载失败'
    message.error(msg)
  } finally {
    loading.value = false
  }
}

async function uploadAvatar(rawFile: File) {
  uploading.value = true

  try {
    const result = await userApi.uploadAvatar(rawFile)
    authStore.updateUser(result.data)
    message.success('头像已更新')
  } catch (error) {
    const msg = error instanceof Error ? error.message : '头像上传失败'
    message.error(msg)
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

onMounted(refreshProfile)
</script>

<template>
  <MainLayout>
    <n-spin :show="loading">
      <section class="profile-grid">
        <aside class="profile-card profile-identity">
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
          <p>{{ user?.bio || '这个人还没有写简介。' }}</p>
        </aside>

        <section class="profile-card profile-detail">
          <div class="section-heading">
            <div>
              <p class="eyebrow">MY PROFILE</p>
              <h2>个人中心</h2>
            </div>
            <n-button :loading="loading" @click="refreshProfile">
              <template #icon><n-icon><RefreshOutline /></n-icon></template>
              刷新资料
            </n-button>
          </div>

          <dl class="profile-fields">
            <div>
              <dt>用户 ID</dt>
              <dd>{{ user?.id ?? '-' }}</dd>
            </div>
            <div>
              <dt>用户名</dt>
              <dd>{{ user?.username || '-' }}</dd>
            </div>
            <div>
              <dt>昵称</dt>
              <dd>{{ user?.nickname || '-' }}</dd>
            </div>
            <div>
              <dt>注册时间</dt>
              <dd>{{ formatDate(user?.createdAt) }}</dd>
            </div>
          </dl>

          <div class="profile-note">
            <strong>当前阶段只做资料展示和头像上传。</strong>
            <span>文章发布、我的文章管理和资料编辑可以放到下一步继续加。</span>
          </div>
        </section>
      </section>
    </n-spin>
  </MainLayout>
</template>
