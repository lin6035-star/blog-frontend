<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ChevronDown,
  CreateOutline,
  DocumentTextOutline,
  FileTrayOutline,
  Home,
  Person,
  SearchOutline,
} from '@vicons/ionicons5'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const { isLoggedIn, usersVO } = storeToRefs(authStore)

const searchKeyword = ref((route.query.keyword as string) ?? '')

function handleSearch() {
  const kw = searchKeyword.value.trim()
  if (kw) {
    router.push({ path: '/', query: { keyword: kw } })
  } else {
    router.push({ path: '/' })
  }
}
</script>

<template>
  <header class="app-header">
    <router-link class="brand" to="/">
      <span class="brand-mark">H</span>
      <span class="brand-text">海林Blog</span>
    </router-link>

    <nav class="header-nav" aria-label="主导航">
      <router-link to="/">
        <n-icon><Home /></n-icon>
        首页
      </router-link>
      <router-link to="/editor">
        <n-icon><CreateOutline /></n-icon>
        写文章
      </router-link>
    </nav>

    <div class="header-actions">
      <label class="header-search" aria-label="搜索文章">
        <input
          v-model="searchKeyword"
          type="search"
          placeholder="搜索文章标题"
          @keyup.enter="handleSearch"
        />
        <n-icon @click="handleSearch" style="cursor: pointer"><SearchOutline /></n-icon>
      </label>

      <div class="creator-center">
        <button class="creator-trigger" type="button">
          创作中心
          <n-icon><ChevronDown /></n-icon>
        </button>
        <div class="creator-popover">
          <button type="button" @click="$router.push('/editor')">
            <span class="creator-icon">
              <n-icon><DocumentTextOutline /></n-icon>
            </span>
            <span>写文章</span>
          </button>
          <button type="button" @click="$router.push('/drafts')">
            <span class="creator-icon">
              <n-icon><FileTrayOutline /></n-icon>
            </span>
            <span>草稿箱</span>
          </button>
        </div>
      </div>

      <template v-if="isLoggedIn">
        <router-link class="header-avatar-link" to="/me" aria-label="进入个人中心">
          <n-avatar :size="38" :src="usersVO?.avatarUrl">
            <template #fallback>
              <n-icon><Person /></n-icon>
            </template>
          </n-avatar>
        </router-link>
      </template>
      <template v-else>
        <router-link class="auth-link login-link" to="/login">登录</router-link>
        <router-link class="auth-link register-link" to="/register">注册</router-link>
      </template>
    </div>
  </header>
</template>
