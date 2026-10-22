export {};
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readJsonFileStrict, writeJsonFileAtomic } = require('./json-db');
interface Config { enabled: boolean; siteKey: string; secretKey: string; }
function config(): Config {
    const raw = readJsonFileStrict(getDataFile('turnstile.json'), () => ({}));
    return { enabled: raw.enabled === true, siteKey: String(raw.siteKey || ''), secretKey: String(raw.secretKey || '') };
}
function publicConfig(): any { const c = config(); return { enabled: c.enabled, siteKey: c.enabled ? c.siteKey : '' }; }
function adminConfig(): any { const c = config(); return { enabled: c.enabled, siteKey: c.siteKey, secretConfigured: !!c.secretKey }; }
function save(input: any): any {
    const c = config();
    if (typeof input.enabled !== 'boolean' || typeof input.siteKey !== 'string') throw new Error('无效的 Turnstile 配置');
    const next = { enabled: input.enabled, siteKey: input.siteKey.trim(), secretKey: c.secretKey };
    // Blank means keep existing secret, never echo it back.
    if (typeof input.secretKey === 'string' && input.secretKey.trim()) next.secretKey = input.secretKey.trim();
    if (next.siteKey.length > 256 || next.secretKey.length > 1024 || (next.enabled && (!next.siteKey || !next.secretKey))) throw new Error('开启验证必须配置 Site Key 和 Secret Key');
    ensureDataDir(); writeJsonFileAtomic(getDataFile('turnstile.json'), next);
    return adminConfig();
}
async function verify(token: any): Promise<boolean> {
    const c = config(); if (!c.enabled) return true;
    if (!c.secretKey || !c.siteKey || typeof token !== 'string' || !token || token.length > 2048) return false;
    try {
        const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ secret: c.secretKey, response: token }),
        });
        if (!res.ok) return false;
        const data: any = await res.json();
        if (data.success !== true || data.action !== 'register') return false;
        if (process.env.AUTH_PUBLIC_URL && data.hostname !== new URL(process.env.AUTH_PUBLIC_URL).hostname) return false;
        return true;
    } catch { return false; }
}
module.exports = { publicConfig, adminConfig, save, verify };
