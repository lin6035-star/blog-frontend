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
