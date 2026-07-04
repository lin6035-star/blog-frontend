<script setup lang="ts">
defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <div class="empty-state">
    <div class="empty-mark">∅</div>
    <h2>{{ title }}</h2>
    <p>{{ description }}</p>
  </div>
</template>
