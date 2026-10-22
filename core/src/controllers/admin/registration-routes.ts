import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};
const turnstile = require('../../services/turnstile');
const users = require('../../models/user-store');
const { issueToken } = require('./middleware');
function mountRegistrationRoutes(app: Application, ctx: AdminContext): void {
    // Opt-out because this edition explicitly provides public local registration.
    const enabled = () => process.env.LOCAL_REGISTRATION_ENABLED !== 'false';
    const limits = new Map<string, { count: number; expires: number }>();
    app.get('/api/registration', (_req: Request, res: Response) => {
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true, data: { enabled: enabled(), turnstile: turnstile.publicConfig() } });
    });
    app.post('/api/register', async (req: Request, res: Response) => {
        res.set('Cache-Control', 'no-store');
        if (!enabled()) return res.status(403).json({ ok: false, error: '管理员已关闭普通注册' });
        const now = Date.now();
        for (const [key, value] of limits) if (value.expires < now) limits.delete(key);
        // Do not trust arbitrary forwarded headers. A reverse proxy shares this bucket;
        // use a trusted edge rate limiter for larger deployments.
        const ip = String(req.socket.remoteAddress || 'unknown');
        const limit = limits.get(ip) || { count: 0, expires: now + 15 * 60_000 };
        if (limit.count >= 10 || limits.size >= 5000) {
            res.set('Retry-After', '900');
            return res.status(429).json({ ok: false, error: '注册尝试过多，请稍后重试' });
        }
        limit.count++; limits.set(ip, limit);
        const { username, password, confirmPassword } = req.body || {};
        if (typeof username !== 'string' || typeof password !== 'string' || typeof confirmPassword !== 'string') return res.status(400).json({ ok: false, error: '请填写用户名、密码和确认密码' });
        if (password !== confirmPassword) return res.status(400).json({ ok: false, error: '两次输入的密码不一致' });
        if (username.length > 32 || password.length > 128) return res.status(400).json({ ok: false, error: '用户名或密码过长' });
        try {
            if (!await turnstile.verify(req.body?.turnstileToken)) return res.status(400).json({ ok: false, error: '人机验证失败或已过期，请重新验证' });
            // Only these two fields are accepted; role, disabled, ownerId etc. are ignored.
            const user = users.create(username.trim(), password);
            const token = issueToken(); ctx.tokens.add(token); ctx.sessions.set(token, user.id);
            return res.status(201).json({ ok: true, data: { token, role: 'user', user: { username: user.username } } });
        } catch (e: any) {
            if (String(e.code || '').startsWith('STORAGE_')) return res.status(503).json({ ok: false, error: '注册服务暂不可用' });
            return res.status(400).json({ ok: false, error: e.message || '注册失败' });
        }
    });
}
module.exports = { mountRegistrationRoutes };
