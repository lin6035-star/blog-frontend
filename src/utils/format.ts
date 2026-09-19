export function formatArticleDate(value: string) {
  if (!value) {
    return '未发布'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value))
}

export function formatArticleDateTime(value: string, fallback = '') {
  if (!value) {
    return fallback
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

/**
 * 应付金额：后端用「分」，展示成元。
 *
 * ⚠️ 只用于 `payAmount` 这类真实货币口径的字段。
 * 额度（credit）不是钱，用下面的 formatCredit——两者混用会把 10000 credit 显示成 ¥100.00。
 */
export function formatPayAmount(fen: number | null | undefined) {
  if (fen === null || fen === undefined) {
    return '—'
  }

  return `¥${(fen / 100).toFixed(2)}`
}

/**
 * 额度（credit）展示：千分位整数，负数原样带符号。
 *
 * 余额允许为负（允许透支一轮），所以不能在这里把负号抹掉——
 * 抹掉之后「预占中」和「已欠费」看起来一模一样。
 */
export function formatCredit(credit: number | null | undefined) {
  if (credit === null || credit === undefined) {
    return '—'
  }

  return credit.toLocaleString('zh-CN')
}

export function formatCommentTime(value: string) {
  if (!value) {
    return ''
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  const diff = Date.now() - date.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff >= 0 && diff < minute) {
    return '刚刚'
  }

  if (diff >= 0 && diff < hour) {
    return `${Math.floor(diff / minute)}分钟前`
  }

  if (diff >= 0 && diff < day) {
    return `${Math.floor(diff / hour)}小时前`
  }

  if (diff >= 0 && diff < 7 * day) {
    return `${Math.floor(diff / day)}天前`
  }

  return formatArticleDateTime(value)
}
