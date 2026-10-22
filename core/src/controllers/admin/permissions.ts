import type { Request, Response, NextFunction } from 'express';
import type { AdminContext } from './context';
export {};
const users = require('../../models/user-store');
const store = require('../../models/store');
const { findAccountByRef } = require('../../services/account-resolver');
function principal(ctx: AdminContext, req: Request): any { return users.find(ctx.sessions.get(String(req.headers['x-admin-token'] || '')) || ''); }
function canAccess(user: any, account: any): boolean { return !!user && !!account && (user.role === 'admin' || account.ownerId === user.id); }
function visible(ctx: AdminContext, req: Request, accounts: any[]): any[] { const u = principal(ctx, req); return accounts.filter(a => canAccess(u, a)); }
function filterData(ctx: AdminContext, req: Request, data: any): any { return { ...data, accounts: visible(ctx, req, data.accounts || []) }; }
function revoke(ctx: AdminContext, id: string): void {
    for (const [token, uid] of ctx.sessions) if (uid === id) { ctx.tokens.delete(token); ctx.sessions.delete(token); }
    if (ctx.io) for (const socket of ctx.io.sockets.sockets.values()) if (socket.data.userId === id) socket.disconnect(true);
}
function gate(ctx: AdminContext) {
    return (req: Request, res: Response, next: NextFunction): any => {
        if (req.path === '/game-version') return next();
        const u = principal(ctx, req);
        if (!u) return res.status(401).json({ ok: false, error: 'Unauthorized' });
        (req as any).user = u;
        if (u.role === 'admin') return next();
        const path = req.path.toLowerCase().replace(/\/+$/, '') || '/';
        // Instance configuration and credentials are never exposed to ordinary users.
        if (/^\/(?:users|scheduler)(?:\/|$)/i.test(path) || /^\/settings\/(?:system-config|device-presets|offline-reminder|theme)(?:\/|$)/i.test(path) || (path.toLowerCase() === '/settings/login-config' && req.method !== 'GET')) return res.status(403).json({ ok: false, error: '仅管理员可操作系统配置' });
        const accounts = store.getAccounts().accounts;
        const refs: any[] = [];
        const header = req.headers['x-account-id'];
        const unscoped = /^\/(?:accounts|account-logs|ping|auth\/validate|user\/me|logout|settings\/login-config|settings\/default)$/.test(path) || /^\/(?:qq-login|wx-login)(?:\/|$)/.test(path);
        if (!unscoped && header && header !== 'all') refs.push(header);
        if (req.query.accountId && req.query.accountId !== 'all') refs.push(req.query.accountId);
        const match = path.match(/^\/accounts\/([^/]+)/i);
        if (match) { try { refs.push(decodeURIComponent(match[1])); } catch { return res.sendStatus(400); } }
        if (path.toLowerCase() === '/accounts' && req.method === 'POST' && req.body?.id) refs.push(req.body.id);
        if (path.toLowerCase() === '/account/remark') refs.push(req.body?.id || req.body?.accountId || req.body?.uin || header);
        for (const ref of refs) if (!canAccess(u, findAccountByRef(accounts, ref))) return res.status(403).json({ ok: false, error: '无权访问此游戏账号' });
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'ownerId')) return res.status(403).json({ ok: false, error: '不能修改账号归属' });
        return next();
    };
}
module.exports = { principal, canAccess, visible, filterData, revoke, gate };
