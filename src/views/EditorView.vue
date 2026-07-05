<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useDialog, useMessage } from 'naive-ui'
import { ArrowBack } from '@vicons/ionicons5'
import { MdEditor } from 'md-editor-v3'
import 'md-editor-v3/lib/style.css'
import { categoryApi } from '@/api/category'
import { myArticleApi, type ArticleForm } from '@/api/myArticle'
import type { Category } from '@/types/category'

const router = useRouter()
const route = useRoute()
const message = useMessage()
const dialog = useDialog()

/* ---- 编辑模式 ---- */
const editId = computed(() => {
  const id = route.params.id
  return id ? Number(id) : null
})

/* ---- 表单 ---- */
const form = reactive<ArticleForm>({
  categoryId: null,
  title: '',
  summary: '',
  content: '',
  coverUrl: '',
  status: 0,
})
const initialContent = ref('')
const initialTitle = ref('')
const initialCoverUrl = ref('')
const saving = ref(false)

/* ---- 分类 ---- */
const categories = ref<Category[]>([])

/* ---- 摘要自动截取 ---- */
function extractSummary(content: string): string {
  const plain = content
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*/g, '')
    .replace(/[`*_~>]/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n+/g, ' ')
    .trim()
  const maxLen = 25
  return plain.length > maxLen ? plain.slice(0, maxLen) + '…' : plain
}

/* ---- 封面上传 ---- */
const coverUploading = ref(false)
const coverInput = ref<HTMLInputElement>()

async function handleCoverUpload(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  coverUploading.value = true
  try {
    const res = await myArticleApi.uploadImage(file)
    form.coverUrl = res.data
    message.success('封面上传成功')
  } catch {
    message.error('封面上传失败')
  } finally {
    coverUploading.value = false
    // 清空 input，允许重复选同一文件
    if (coverInput.value) coverInput.value.value = ''
  }
}

/* ---- 脏检测 ---- */
const skipGuard = ref(false)

const isDirty = computed(() => {
  if (editId.value) {
    return (
      form.title !== initialTitle.value ||
      form.content !== initialContent.value ||
      form.coverUrl !== initialCoverUrl.value
    )
  }
  return form.title.trim() !== '' || form.content !== '' || form.coverUrl !== ''
})

/* ---- 图片上传 ---- */
async function handleUploadImg(files: File[], callback: (urls: string[]) => void) {
  const urls: string[] = []
  for (const file of files) {
    try {
      const res = await myArticleApi.uploadImage(file)
      urls.push(res.data)
    } catch {
      message.error(`图片 ${file.name} 上传失败`)
    }
  }
  callback(urls)
}

/* ---- 保存草稿 ---- */
async function handleSaveDraft() {
  if (!form.title.trim()) {
    message.warning('请输入文章标题')
    return
  }

  saving.value = true
  form.status = 0
  form.summary = extractSummary(form.content)

  try {
    if (editId.value) {
      await myArticleApi.update(editId.value, form)
    } else {
      const res = await myArticleApi.create(form)
      const id = res.data
      if (id) {
        skipGuard.value = true
        router.replace({ name: 'editor-edit', params: { id } })
      }
    }
    message.success('已保存至草稿箱')
    initialContent.value = form.content
    initialTitle.value = form.title
    initialCoverUrl.value = form.coverUrl
  } catch (e) {
    const msg = e instanceof Error ? e.message : '保存失败'
    message.error(msg)
  } finally {
    saving.value = false
  }
}

/* ---- 发布 ---- */
async function handlePublish() {
  if (!form.title.trim()) {
    message.warning('请输入文章标题')
    return
  }

  saving.value = true
  form.status = 1
  form.summary = extractSummary(form.content)

  try {
    if (editId.value) {
      await myArticleApi.update(editId.value, form)
    } else {
      await myArticleApi.create(form)
    }
    message.success('发布成功')
    skipGuard.value = true
    router.back()
  } catch (e) {
    const msg = e instanceof Error ? e.message : '发布失败'
    message.error(msg)
  } finally {
    saving.value = false
  }
}

/* ---- 返回 ---- */
function handleBack() {
  router.back()
}

/* ---- 键盘快捷键 Ctrl+S 保存草稿 ---- */
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    handleSaveDraft()
  }
}

/* ---- 生命周期 ---- */
onMounted(async () => {
  document.addEventListener('keydown', onKeydown)

  // 加载分类
  try {
    const res = await categoryApi.getList()
    categories.value = res.data ?? []
  } catch { /* 忽略 */ }

  // 编辑模式：加载文章
  if (editId.value) {
    try {
      const res = await myArticleApi.getDetail(editId.value)
      const article = res.data
      form.categoryId = article.categoryId
      form.title = article.title
      form.summary = article.summary
      form.content = article.content
      form.coverUrl = article.coverUrl
      form.status = article.status
      initialContent.value = article.content
      initialTitle.value = article.title
      initialCoverUrl.value = article.coverUrl
    } catch {
      message.error('文章加载失败')
      router.back()
    }
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})

/* ---- 路由离开守卫 ---- */
onBeforeRouteLeave((_to, _from, next) => {
  if (skipGuard.value) {
    skipGuard.value = false
    next()
    return
  }
  if (isDirty.value) {
    dialog.warning({
      title: '离开确认',
      content: '你还有未保存的内容，是否保存草稿后再离开？',
      positiveText: '保存草稿',
      negativeText: '不保存',
      onPositiveClick: async () => {
        await handleSaveDraft()
        next()
      },
      onNegativeClick: () => {
        next()
      },
    })
  } else {
    next()
  }
})
</script>

<template>
  <div class="editor-page">
    <!-- 顶部工具栏 -->
    <header class="editor-toolbar">
      <button class="editor-back" type="button" @click="handleBack">
        <n-icon size="20"><ArrowBack /></n-icon>
      </button>

      <input
        class="editor-title-input"
        v-model="form.title"
        type="text"
        placeholder="输入文章标题…"
        maxlength="120"
      />

      <div class="editor-actions">
        <button
          class="editor-btn editor-btn-draft"
          type="button"
          :disabled="saving"
          @click="handleSaveDraft"
        >
          {{ saving ? '…' : '保存草稿' }}
        </button>
        <button
          class="editor-btn editor-btn-publish"
          type="button"
          :disabled="saving"
          @click="handlePublish"
        >
          {{ saving ? '…' : '发布' }}
        </button>
      </div>
    </header>

    <!-- 配置栏 -->
    <div class="editor-config">
      <div class="config-field">
        <label>分类</label>
        <n-select
          v-model:value="form.categoryId"
          :options="categories.map(c => ({ label: c.name, value: c.id }))"
          placeholder="选择分类"
          clearable
          style="width: 160px"
        />
      </div>

      <div class="config-field">
        <label>封面图</label>
        <input
          ref="coverInput"
          type="file"
          accept="image/*"
          style="display: none"
          @change="handleCoverUpload"
        />
        <button
          class="cover-upload-btn"
          type="button"
          :disabled="coverUploading"
          @click="coverInput?.click()"
        >
          {{ coverUploading ? '上传中…' : form.coverUrl ? '更换封面' : '上传封面' }}
        </button>
        <span v-if="form.coverUrl" class="cover-thumb-wrap">
          <img :src="form.coverUrl" class="cover-thumb" alt="封面预览" />
          <button class="cover-remove" type="button" @click="form.coverUrl = ''">×</button>
        </span>
      </div>
    </div>

    <!-- 编辑区 -->
    <div class="editor-main">
      <MdEditor
        v-model="form.content"
        :on-upload-img="handleUploadImg"
        preview-theme="github"
        language="zh-CN"
        style="height: 100%"
      />
    </div>
  </div>
</template>

<style scoped>
.editor-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #fff;
}

/* ---- 顶部工具栏 ---- */
.editor-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
}

.editor-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #555;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
}
.editor-back:hover {
  background: #f3f4f6;
}

.editor-title-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  font-size: 26px;
  font-weight: 800;
  color: #111;
  background: transparent;
}
.editor-title-input::placeholder {
  color: #c0c0c0;
  font-weight: 400;
}

.editor-actions {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

.editor-btn {
  padding: 9px 22px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.15s,
    opacity 0.15s;
  border: 0;
}
.editor-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.editor-btn-draft {
  color: #111;
  background: #f3f4f6;
}
.editor-btn-draft:hover:not(:disabled) {
  background: #e5e7eb;
}

.editor-btn-publish {
  color: #fff;
  background: #2f6f73;
}
.editor-btn-publish:hover:not(:disabled) {
  background: #25595d;
}

/* ---- 配置栏 ---- */
.editor-config {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 10px 20px;
  border-bottom: 1px solid #f0f0f0;
  background: #fafafa;
}

.config-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.config-field label {
  font-size: 13px;
  font-weight: 700;
  color: #555;
  white-space: nowrap;
}

.cover-upload-btn {
  padding: 6px 14px;
  border: 1px dashed #ccc;
  border-radius: 6px;
  background: #fff;
  color: #555;
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.cover-upload-btn:hover:not(:disabled) {
  border-color: #2f6f73;
  color: #2f6f73;
}
.cover-upload-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.cover-thumb-wrap {
  position: relative;
  display: inline-flex;
}

.cover-thumb {
  width: 56px;
  height: 40px;
  border-radius: 4px;
  object-fit: cover;
  border: 1px solid #e5e7eb;
}

.cover-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border: 1px solid #ddd;
  border-radius: 50%;
  background: #fff;
  color: #999;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.cover-remove:hover {
  color: #e74c3c;
  border-color: #e74c3c;
}

/* ---- 编辑区 ---- */
.editor-main {
  flex: 1;
  min-height: 0;
}
</style>
