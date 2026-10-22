import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require('typescript')
const vue = require('vue')
const source = readFileSync(new URL('../src/views/Login.vue', import.meta.url), 'utf8')
function setup(store) {
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  const { outputText } = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } })
  const module = { exports: {} }
  const api = { get: async () => ({ data: { ok: true } }) }
  const load = id => id === 'vue' ? { ...vue, onMounted: () => {} } : id === '@/stores/user' ? { useUserStore: () => store } : id === '@/api' ? { __esModule: true, default: api, getApiErrorMessage: e => e.message } : { default: {} }
  return new Function('require', 'module', 'exports', '__APP_VERSION__', 'setTimeout', `${outputText}\nreturn { username, password, confirmPassword, registering, error, loading, toggleRegistration, handleSubmit };`)(load, module, module.exports, 'test', () => {})
}
test('registration entry toggles form, checks confirmation and invokes real register action', async () => {
  assert.match(source, /没有账号？普通注册/)
  assert.match(source, /v-if="registrationEnabled"/)
  const calls = []
  const view = setup({ register: async (...args) => { calls.push(['register', ...args]); return { ok: true } }, login: async (...args) => { calls.push(['login', ...args]); return { ok: true } } })
  view.username.value = 'new-user'
  view.toggleRegistration(); assert.equal(view.registering.value, true)
  view.password.value = 'SafePass42!'; view.confirmPassword.value = 'wrong'
  await view.handleSubmit(); assert.equal(calls.length, 0); assert.match(view.error.value, /不一致/); assert.equal(view.loading.value, false)
  view.confirmPassword.value = 'SafePass42!'
  await view.handleSubmit(); assert.deepEqual(calls[0], ['register', 'new-user', 'SafePass42!', 'SafePass42!'])
  view.toggleRegistration(); assert.equal(view.registering.value, false); assert.equal(view.password.value, '')
  view.password.value = 'SafePass42!'; await view.handleSubmit(); assert.deepEqual(calls[1], ['login', 'new-user', 'SafePass42!'])
})
