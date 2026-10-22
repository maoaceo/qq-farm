<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import { useUserStore } from '@/stores/user'
const userStore = useUserStore()
const users = ref<any[]>([])
const accounts = ref<any[]>([])
const username = ref('')
const password = ref('')
const message = ref('')
const busy = ref(false)
async function load() {
  const [u, a] = await Promise.all([api.get('/api/users'), api.get('/api/accounts')])
  users.value = u.data.data || []
  accounts.value = a.data.data?.accounts || []
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
async function assign(account: any, event: Event) {
  const ownerId = (event.target as HTMLSelectElement).value
  if (!window.confirm('转移后，原用户将失去此账号的访问权限。相关用户需重新登录，是否继续？')) { await load(); return }
  await perform(async () => {
    await api.post('/api/users/assign-account', { accountId: account.id, ownerId })
    // Assignment may revoke this administrator session when moving a legacy account.
    window.location.reload()
  })
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
    <p class="text-sm">普通用户只能管理自己的游戏账号。暂不开放自行注册，由管理员创建用户。</p>
    <p role="status">{{ message }}</p>
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
    <section class="farm-card space-y-3 rounded-lg p-4">
      <h2 class="font-bold">账号归属</h2>
      <p class="text-sm">升级前的游戏账号默认归管理员所有；可在此分配给用户。</p>
      <div v-for="a in accounts" :key="a.id" class="flex flex-wrap items-center gap-3 border-b py-2">
        <span>{{ a.name }}（{{ a.id }}）</span>
        <select :value="a.ownerId || 'admin'" class="rounded border p-2 text-black" :disabled="busy" @change="assign(a, $event)">
          <option value="admin">管理员</option>
          <option v-for="u in users" :key="u.id" :value="u.id" :disabled="u.disabled">{{ u.username }}</option>
        </select>
      </div>
    </section>
  </div>
  <p v-else class="p-4">仅管理员可访问。</p>
</template>
