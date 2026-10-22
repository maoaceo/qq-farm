import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

const { version } = require('../../../package.json');
const { getRuntimeConfig } = require('../../config/config');
const { getSchedulerRegistrySnapshot } = require('../../services/scheduler');
const { createModuleLogger } = require('../../services/logger');
const adminStore = require('../../models/admin-store');
const userStore = require('../../models/user-store');
const permissions = require('./permissions');

const {
    getClientIp,
    issueToken,
    createAuthRequired,
    getAccId,
    handleApiError,
} = require('./middleware');

const adminLogger = createModuleLogger('admin');

function mountAuthRoutes(app: Application, ctx: AdminContext): void {
    const authRequired = createAuthRequired(ctx);
    require('./oauth-routes').mountOAuthRoutes(app, ctx);
    require('./registration-routes').mountRegistrationRoutes(app, ctx);

    app.post('/api/login', (req: Request, res: Response) => {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(401).json({ ok: false, error: '请输入用户名和密码' });
        }

        const clientIp = String(req.socket.remoteAddress || 'unknown');
        const result = userStore.validate(String(username), String(password), clientIp);
        if (result?.error) {
            const statusCode = result.error === 'rate_limit' ? 429 : result.error === 'locked' ? 423 : 401;
            adminLogger.warn('登录失败', { username, error: result.error, ip: clientIp });
            return res.status(statusCode).json({
                ok: false,
                error: result.message,
                errorType: result.error,
                remainingMs: result.remainingMs,
            });
        }

        const token = issueToken();
        ctx.tokens.add(token);
        ctx.sessions.set(token, result.id);
        adminLogger.info('面板用户登录成功', { username: result.username, role: result.role, ip: clientIp });
        return res.json({
            ok: true,
            data: {
                token,
                role: result.role,
                user: { username: result.username },
                mustChangePassword: result.mustChangePassword === true,
            },
        });
    });

    app.post('/api/user/change-password', authRequired, (req: Request, res: Response) => {
        const { oldPassword, newPassword } = req.body || {};
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ ok: false, error: '请提供原密码和新密码' });
        }
        const user = permissions.principal(ctx, req);
        const result = userStore.changePassword(user.id, String(oldPassword), String(newPassword));
        if (result.ok) permissions.revoke(ctx, user.id);
        return res.json(result);
    });

    app.use('/api', (req: Request, res: Response, next: any) => {
        if (req.path === '/login' || req.path === '/game-version') return next();
        return authRequired(req, res, next);
    });

    app.use('/api', permissions.gate(ctx));

    app.get('/api/ping', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version } });
    });

    app.get('/api/game-version', (_req: Request, res: Response) => {
        const { clientVersion, wxClientVersion } = getRuntimeConfig();
        res.json({ ok: true, clientVersion, wxClientVersion, botVersion: version });
    });

    app.get('/api/auth/validate', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { valid: true } });
    });

    app.get('/api/scheduler', async (req: Request, res: Response) => {
        try {
            const id = getAccId(ctx, req);
            if (ctx.provider && typeof ctx.provider.getSchedulerStatus === 'function') {
                const data = await ctx.provider.getSchedulerStatus(id);
                return res.json({ ok: true, data });
            }
            return res.json({
                ok: true,
                data: {
                    runtime: getSchedulerRegistrySnapshot(),
                    worker: null,
                    workerError: 'DataProvider does not support scheduler status',
                },
            });
        } catch (e: any) {
            return handleApiError(res, e);
        }
    });

    app.post('/api/logout', (req: Request, res: Response) => {
        const token = (req as any).adminToken;
        if (token) { ctx.tokens.delete(token); ctx.sessions.delete(token); }
        if (ctx.io && token) {
            for (const socket of ctx.io.sockets.sockets.values()) {
                if (String((socket.data as any).adminToken || '') === String(token)) socket.disconnect(true);
            }
        }
        res.json({ ok: true });
    });

    app.get('/api/user/me', (req: Request, res: Response) => {
        res.json({ ok: true, data: permissions.principal(ctx, req) });
    });
}

module.exports = { mountAuthRoutes };
