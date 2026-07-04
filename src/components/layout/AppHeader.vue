<script setup lang="ts">
import { CreateOutline, Home, Person } from '@vicons/ionicons5'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const { isLoggedIn, usersVO } = storeToRefs(authStore)
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
      <span class="nav-disabled">
        <n-icon><CreateOutline /></n-icon>
        写文章
      </span>
    </nav>

    <div class="header-actions">
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
