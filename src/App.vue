<template>
  <n-dialog-provider>
    <n-message-provider>
      <router-view v-slot="{ Component }">
        <KeepAlive include="HomeView">
          <component :is="Component" />
        </KeepAlive>
      </router-view>
    </n-message-provider>
  </n-dialog-provider>
</template>
