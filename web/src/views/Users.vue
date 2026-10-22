<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import { useUserStore } from '@/stores/user'
const userStore = useUserStore()
const users = ref<any[]>([])
const username = ref('')
const password = ref('')
const message = ref('')
const busy = ref(false)
const turnstile = ref({ enabled: false, siteKey: '', secretKey: '', secretConfigured: false })
async function saveTurnstile() {
  await perform(async () => {
    await api.post('/api/users/turnstile', turnstile.value)
    turnstile.value.secretKey = ''
  })
}
async function load() {
  const [u, c] = await Promise.all([api.get('/api/users'), api.get('/api/users/turnstile')])
  turnstile.value = { ...c.data.data, secretKey: '' }
  users.value = u.data.data || []
}
async function perform(fn: () => Promise<any>) {
  if (busy.value) return
  busy.value = true
  try { await fn(); await load(); message.value = '保存成功' }
  catch (e) { message.value = getApiErrorMessage(e) }
  finally { busy.value = false }
}
async function createUser() {
  await perform(async () => { await api.post('/api/users', { username: username.value, password: password.value }); username.value = ''; password.value = '' })
}
async function resetPassword(user: any) {
  const next = window.prompt(`为 ${user.username} 设置新密码（至少6位且含两类字符）`)
  if (next) await perform(() => api.patch(`/api/users/${user.id}`, { password: next }))
}
onMounted(async () => {
  await userStore.fetchUserInfo()
  if (userStore.userInfo?.role === 'admin') {
    try { await load() } catch (e) { message.value = getApiErrorMessage(e) }
  }
})
</script>

<template>
  <div v-if="userStore.userInfo?.role === 'admin'" class="space-y-5 p-4">
    <h1 class="text-xl font-bold">用户管理</h1>
    <p class="text-sm">普通用户只能管理自己的游戏账号。支持普通注册和第三方登录注册。</p>
    <p role="status">{{ message }}</p>
    <form class="farm-card space-y-3 rounded-lg p-4" @submit.prevent="saveTurnstile">
      <h2 class="font-bold">注册人机验证 · Cloudflare Turnstile</h2>
      <label class="flex items-center gap-2"><input v-model="turnstile.enabled" type="checkbox">启用注册验证</label>
      <label class="block">Site Key<input v-model="turnstile.siteKey" class="mt-1 w-full rounded border p-2 text-black" maxlength="256" autocomplete="off" placeholder="Cloudflare Site Key"></label>
      <label class="block">Secret Key<input v-model="turnstile.secretKey" class="mt-1 w-full rounded border p-2 text-black" type="password" maxlength="1024" autocomplete="new-password" :placeholder="turnstile.secretConfigured ? '已配置，留空保持原密钥' : '填写 Cloudflare Secret Key'"></label>
      <p class="text-sm">Secret Key 保存后不回显；在 Cloudflare 中允许你的网站域名。开启后验证失败、过期或服务不可用均不能注册。第三方登录及管理员创建用户不受影响。</p>
      <button class="rounded bg-green-700 px-4 py-2 text-white" :disabled="busy">保存验证设置</button>
    </form>
    <form class="farm-card flex flex-wrap gap-3 rounded-lg p-4" @submit.prevent="createUser">
      <input v-model="username" class="rounded border p-2 text-black" autocomplete="off" placeholder="用户名（3–32位）" required maxlength="32">
      <input v-model="password" class="rounded border p-2 text-black" type="password" autocomplete="new-password" placeholder="初始密码" required maxlength="128">
      <button class="rounded bg-green-700 px-4 py-2 text-white" :disabled="busy">创建用户</button>
    </form>
    <section class="farm-card space-y-3 rounded-lg p-4">
      <h2 class="font-bold">用户列表</h2>
      <div v-for="u in users" :key="u.id" class="flex flex-wrap items-center gap-3 border-b py-2">
        <span>{{ u.username }} · {{ u.disabled ? '已禁用' : '正常' }}</span>
        <button class="rounded border px-3 py-1" :disabled="busy" @click="resetPassword(u)">重置密码</button>
        <button class="rounded border px-3 py-1" :disabled="busy" @click="perform(() => api.patch(`/api/users/${u.id}`, { disabled: !u.disabled }))">{{ u.disabled ? '启用' : '禁用' }}</button>
      </div>
    </section>

  </div>
  <p v-else class="p-4">仅管理员可访问。</p>
</template>
