<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { ArrowBack } from '@vicons/ionicons5'
import MainLayout from '@/layouts/MainLayout.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import { seckillApi } from '@/api/seckill'
import type { SeckillActivity, SeckillStatus } from '@/types/seckill'
import { formatArticleDateTime, formatCredit } from '@/utils/format'

const router = useRouter()
const message = useMessage()

const activities = ref<SeckillActivity[]>([])
const loading = ref(false)
/** 正在发请求的活动 id——按钮转圈用 */
const grabbing = ref<string | null>(null)

/** 结果秒级产出，1 秒一次足够；上限 10 次是给「消费者恰好卡了一轮」留余量 */
const POLL_INTERVAL_MS = 1000
const MAX_POLL_ATTEMPTS = 10
const pollTimers = new Map<string, ReturnType<typeof setTimeout>>()

async function loadActivities() {
  loading.value = true
  try {
    const res = await seckillApi.listActivities()
    activities.value = res.data ?? []
  } catch (e) {
    message.error(e instanceof Error ? e.message : '活动加载失败')
  } finally {
    loading.value = false
  }
}

/**
 * 抢购。
 *
 * ⚠️ 后端返回 `QUEUED` **不是「抢到了」**——那只是名额占住了、事件进了队列。
 * 真正的发放是异步的，必须轮询到 `GRANTED` 才能告诉用户到账。
 * 这里把两步分开，是为了让界面上「排队中」和「已到账」永远是两个不同的样子。
 */
async function grab(activity: SeckillActivity) {
  if (grabbing.value) {
    return
  }
  grabbing.value = activity.id
  try {
    const res = await seckillApi.grab(activity.id)
    const result = res.data
    applyStatus(activity.id, result.status)

    if (result.status === 'QUEUED') {
      message.info(result.message ?? '已为你占住名额，正在入账')
      pollUntilSettled(activity.id)
    } else {
      message.warning(result.message ?? '没抢到')
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : '抢购失败')
  } finally {
    grabbing.value = null
  }
}

/** 轮询到有确定性结论为止（GRANTED / FAILED / FAILED_RETRY），或者到达次数上限 */
async function pollUntilSettled(activityId: string, attempt = 1) {
  const scheduleNext = () => {
    pollTimers.set(
      activityId,
      setTimeout(() => pollUntilSettled(activityId, attempt + 1), POLL_INTERVAL_MS),
    )
  }

  try {
    const res = await seckillApi.getResult(activityId)
    const result = res.data
    applyStatus(activityId, result.status)

    if (result.status === 'GRANTED') {
      message.success(`已到账 ${formatCredit(result.creditAmount ?? 0)} 额度`)
      return
    }
    if (result.status === 'QUEUED') {
      if (attempt < MAX_POLL_ATTEMPTS) {
        scheduleNext()
      } else {
        message.info('还在处理中，稍后刷新页面看看')
      }
      return
    }
    if (result.status !== 'NONE') {
      message.warning(result.message ?? '很遗憾，没能抢到')
    }
  } catch {
    // 轮询失败不弹错：它是后台行为，弹窗只会打扰用户。继续重试到上限为止
    if (attempt < MAX_POLL_ATTEMPTS) {
      scheduleNext()
    }
  }
}

function applyStatus(activityId: string, status: SeckillStatus) {
  const target = activities.value.find((item) => item.id === activityId)
  if (!target) {
    return
  }
  const wasGranted = target.myStatus === 'GRANTED'
  target.myStatus = status
  if (status === 'GRANTED' && !wasGranted) {
    // 本地 +1，省一次整表刷新；后端下次加载会给出准确值
    target.soldCount += 1
    target.remainingStock = Math.max(0, target.remainingStock - 1)
  }
}

function buttonLabel(activity: SeckillActivity): string {
  switch (activity.myStatus) {
    case 'GRANTED':
      return '已到账'
    case 'QUEUED':
      return '排队中…'
    case 'FAILED':
      return '未抢到'
    case 'FAILED_RETRY':
      return '发放异常'
    default:
      return activity.remainingStock > 0 ? '立即抢' : '已抢完'
  }
}

function isBusy(activity: SeckillActivity): boolean {
  return (
    grabbing.value === activity.id ||
    activity.myStatus === 'QUEUED' ||
    activity.myStatus === 'GRANTED' ||
    activity.remainingStock <= 0
  )
}

function goBackToWallet() {
  if (router.options.history.state.back) {
    router.back()
  } else {
    router.replace('/me/wallet')
  }
}

onMounted(loadActivities)

onUnmounted(() => {
  pollTimers.forEach((timer) => clearTimeout(timer))
  pollTimers.clear()
})
</script>

<template>
  <MainLayout>
    <div class="seckill-page">
      <header class="seckill-header">
        <button class="seckill-back" type="button" @click="goBackToWallet">
          <n-icon :component="ArrowBack" size="18" />
          返回钱包
        </button>
        <h1>额度秒杀</h1>
        <p class="seckill-subtitle">
          抢到的额度直接进钱包，可用于 AI 助手消费。每人每场限一次。
        </p>
      </header>

      <div v-if="loading" class="seckill-loading">
        <n-skeleton text :repeat="3" />
      </div>

      <EmptyState
        v-else-if="activities.length === 0"
        title="暂无可参与的活动"
        description="有新的额度秒杀时会出现在这里"
      />

      <ul v-else class="seckill-list">
        <li
          v-for="activity in activities"
          :key="activity.id"
          class="seckill-card"
          :class="`is-${activity.myStatus.toLowerCase()}`"
        >
          <div class="seckill-card-main">
            <h2 class="seckill-name">{{ activity.name }}</h2>
            <p class="seckill-credit">
              +{{ formatCredit(activity.creditAmount) }}
              <span class="seckill-credit-unit">额度</span>
            </p>
            <p class="seckill-stock">
              剩余 {{ activity.remainingStock }} / {{ activity.totalStock }}
              <span class="seckill-time">
                {{ formatArticleDateTime(activity.startAt) }} 起
              </span>
            </p>
          </div>

          <div class="seckill-card-action">
            <button
              type="button"
              class="seckill-button"
              :disabled="isBusy(activity)"
              @click="grab(activity)"
            >
              {{ buttonLabel(activity) }}
            </button>
            <p v-if="activity.myStatus === 'QUEUED'" class="seckill-hint">
              名额已占住，正在入账
            </p>
          </div>
        </li>
      </ul>
    </div>
  </MainLayout>
</template>

<style scoped>
.seckill-page {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 10px 18px 56px;
}

.seckill-header {
  display: grid;
  gap: 8px;
  margin-bottom: 18px;
}

.seckill-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  padding: 6px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #4b5563;
  font-size: 13px;
  cursor: pointer;
}

.seckill-back:hover {
  background: #f8fafc;
}

.seckill-header h1 {
  margin: 0;
  color: #1f2937;
  font-size: 22px;
}

.seckill-subtitle {
  margin: 0;
  color: #94a3b8;
  font-size: 13px;
}

.seckill-loading {
  padding: 8px 0;
}

.seckill-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.seckill-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 22px;
  border: 1px solid #eef0f2;
  border-radius: 12px;
  background: #fff;
}

/* 排队中：暖黄，和钱包的「预占中」三态保持一致——它是进行中，不是告警 */
.seckill-card.is-queued {
  border-color: #fde68a;
  background: #fffbeb;
}

.seckill-card.is-granted {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.seckill-name {
  margin: 0 0 6px;
  color: #1f2937;
  font-size: 16px;
}

.seckill-credit {
  margin: 0 0 6px;
  color: #6366f1;
  font-size: 22px;
  font-weight: 700;
}

.seckill-credit-unit {
  color: #94a3b8;
  font-size: 13px;
  font-weight: 400;
}

.seckill-stock {
  display: flex;
  gap: 12px;
  margin: 0;
  color: #64748b;
  font-size: 13px;
}

.seckill-time {
  color: #94a3b8;
}

.seckill-card-action {
  display: grid;
  justify-items: center;
  gap: 6px;
}

.seckill-button {
  min-width: 108px;
  padding: 9px 18px;
  border: none;
  border-radius: 9px;
  background: #6366f1;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease;
}

.seckill-button:hover:not(:disabled) {
  background: #4f46e5;
}

.seckill-button:disabled {
  background: #e5e7eb;
  color: #9ca3af;
  cursor: not-allowed;
}

.seckill-card.is-granted .seckill-button:disabled {
  background: #dcfce7;
  color: #16a34a;
}

.seckill-card.is-queued .seckill-button:disabled {
  background: #fef3c7;
  color: #b45309;
}

.seckill-hint {
  margin: 0;
  color: #b45309;
  font-size: 12px;
}
</style>
