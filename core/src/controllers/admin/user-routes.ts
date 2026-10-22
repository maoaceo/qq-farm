import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};
const users = require('../../models/user-store');
const store = require('../../models/store');
const { principal, revoke } = require('./permissions');
function mountUserRoutes(app: Application, ctx: AdminContext): void {
    app.use('/api/users', (req: Request, res: Response, next: any) => {
        if (principal(ctx, req)?.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可管理用户' });
        return next();
    });
    app.get('/api/users/turnstile', (_req, res) => {
        res.set('Cache-Control', 'no-store');
        try { res.json({ ok: true, data: require('../../services/turnstile').adminConfig() }); }
        catch { res.status(503).json({ ok: false, error: '读取验证配置失败' }); }
    });
    app.post('/api/users/turnstile', (req, res) => {
        res.set('Cache-Control', 'no-store');
        try { res.json({ ok: true, data: require('../../services/turnstile').save(req.body || {}) }); }
        catch { res.status(400).json({ ok: false, error: '保存失败：开启验证需填写有效的 Site Key 和 Secret Key' }); }
    });
    app.get('/api/users', (_req, res) => res.json({ ok: true, data: users.list() }));
    app.post('/api/users', (req, res) => {
        try { res.json({ ok: true, data: users.create(String(req.body?.username || '').trim(), String(req.body?.password || '')) }); }
        catch (e: any) { res.status(400).json({ ok: false, error: e.message }); }
    });
    app.patch('/api/users/:id', (req, res) => {
        try { const id = String(req.params.id); const data = users.update(id, req.body || {}); revoke(ctx, id); res.json({ ok: true, data }); }
        catch (e: any) { res.status(400).json({ ok: false, error: e.message }); }
    });
    app.post('/api/users/assign-account', (req, res) => {
        const { accountId, ownerId } = req.body || {};
        const account = store.getAccounts().accounts.find((a: any) => a.id === String(accountId));
        if (!account || !users.find(String(ownerId))) return res.status(400).json({ ok: false, error: '账号或目标用户不存在/已禁用' });
        store.addOrUpdateAccount({ id: account.id, ownerId: String(ownerId) });
        // Clear snapshots and memberships on both sides immediately.
        revoke(ctx, account.ownerId || 'admin'); revoke(ctx, String(ownerId));
        return res.json({ ok: true });
    });
}
module.exports = { mountUserRoutes };
