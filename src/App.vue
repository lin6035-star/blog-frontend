<script setup lang="ts">
import AiAssistant from '@/components/ai/AiAssistant.vue'
</script>

<template>
  <n-dialog-provider>
    <n-message-provider>
      <router-view v-slot="{ Component }">
        <KeepAlive include="HomeView">
          <component :is="Component" />
        </KeepAlive>
      </router-view>
      <AiAssistant />
    </n-message-provider>
  </n-dialog-provider>
</template>
