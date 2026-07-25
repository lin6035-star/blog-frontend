<script setup lang="ts">
import AppHeader from '@/components/layout/AppHeader.vue'
import AiAssistant from '@/components/ai/AiAssistant.vue'
</script>

<template>
  <div class="app-shell">
    <AppHeader />
    <main class="shell-main">
      <slot />
    </main>
    <AiAssistant />
  </div>
</template>
