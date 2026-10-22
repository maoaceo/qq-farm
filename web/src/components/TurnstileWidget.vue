<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
const props = defineProps<{ siteKey: string }>()
const emit = defineEmits<{ token: [value: string] }>()
const container = ref<HTMLElement | null>(null)
const error = ref('')
let widget: string | undefined
let alive = true
const api = () => (window as any).turnstile
let timer: ReturnType<typeof setTimeout> | undefined
async function load() {
  if (api()) return
  await new Promise<void>((resolve, reject) => {
    const fail = () => reject(new Error('人机验证加载失败，请检查网络后刷新'))
    timer = setTimeout(fail, 15000)
    const done = () => { if (timer) clearTimeout(timer); resolve() }
    let script = document.querySelector<HTMLScriptElement>('script[data-farm-turnstile]')
    if (!script) {
      script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true; script.defer = true; script.dataset.farmTurnstile = 'true'
      script.addEventListener('load', done, { once: true }); script.addEventListener('error', fail, { once: true })
      document.head.appendChild(script)
    }
    else { script.addEventListener('load', done, { once: true }); script.addEventListener('error', fail, { once: true }); if (api()) done() }
  })
}
function reset() { emit('token', ''); if (widget !== undefined && api()) api().reset(widget) }
defineExpose({ reset })
onMounted(async () => {
  try {
    await load()
    if (!alive || !container.value) return
    widget = api().render(container.value, {
      sitekey: props.siteKey, action: 'register', theme: 'auto',
      callback: (token: string) => { error.value = ''; emit('token', token) },
      'expired-callback': () => emit('token', ''),
      'error-callback': () => { emit('token', ''); error.value = '人机验证失败，请重试'; return true },
    })
  } catch (e: any) { if (alive) error.value = e.message }
})
onBeforeUnmount(() => { alive = false; if (timer) clearTimeout(timer); if (widget !== undefined && api()) api().remove(widget) })
</script>
<template>
  <div>
    <div ref="container" />
    <p v-if="error" class="text-sm text-red-600" role="alert">{{ error }}</p>
  </div>
</template>
