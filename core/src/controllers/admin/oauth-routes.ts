import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};
const oidc = require('../../services/oidc');
const users = require('../../models/user-store');
const { issueToken } = require('./middleware');
interface Flow { provider: string; browser: string; nonce: string; verifier: string; expires: number; metadata: any; }
function mountOAuthRoutes(app: Application, ctx: AdminContext): void {
    const flows = new Map<string, Flow>();
    const handoffs = new Map<string, { userId: string; expires: number }>();
    const limits = new Map<string, { count: number; expires: number }>();
    function cleanup(): void {
        const now = Date.now();
        for (const map of [flows, handoffs, limits]) for (const [k, v] of map) if (v.expires < now) map.delete(k);
    }
    const cookieOptions = () => ({ httpOnly: true, secure: oidc.publicOrigin().startsWith('https:'), sameSite: 'lax' as const, path: '/api/oauth', maxAge: 5 * 60_000 });
    const readCookie = (req: Request, name: string): string => {
        const values = String(req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${name}=`));
        if (values.length !== 1) return '';
        return values[0].slice(name.length + 1);
    };
    app.use('/api/oauth', (_req: Request, res: Response, next: any) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next(); });
    app.get('/api/oauth/providers', (_req: Request, res: Response) => {
        try { res.json({ ok: true, data: oidc.providers().map((p: any) => ({ id: p.id, name: p.name, url: `/api/oauth/${p.id}/start` })) }); }
        catch { res.status(503).json({ ok: false, error: '第三方登录配置无效，请联系管理员' }); }
    });
    app.get('/api/oauth/:provider/start', async (req: Request, res: Response) => {
        cleanup();
        try {
            const p = oidc.providers().find((p: any) => p.id === req.params.provider);
            if (!p) return res.sendStatus(404);
            const ip = String(req.socket.remoteAddress || 'unknown');
            const limit = limits.get(ip) || { count: 0, expires: Date.now() + 60_000 };
            if (limit.count >= 20 || flows.size >= 2000 || limits.size >= 5000) return res.sendStatus(429);
            limit.count++; limits.set(ip, limit);
            const d = await oidc.discover(p);
            const state = oidc.random(); const browser = oidc.random(); const nonce = oidc.random(); const verifier = oidc.random();
            if (flows.size >= 2000) return res.sendStatus(429);
            flows.set(state, { provider: p.id, browser, nonce, verifier, expires: Date.now() + 5 * 60_000, metadata: d });
            res.cookie('farm_oauth_flow', browser, cookieOptions());
            return res.redirect(oidc.authorize(p, d, state, nonce, verifier));
        } catch { return res.status(502).send('第三方登录暂不可用，请返回登录页重试'); }
    });
    app.get('/api/oauth/:provider/callback', async (req: Request, res: Response) => {
        cleanup();
        const state = typeof req.query.state === 'string' ? req.query.state : '';
        const flow = flows.get(state);
        // Do not consume a flow until the provider and browser binding both match.
        if (!flow || flow.provider !== req.params.provider || flow.browser !== readCookie(req, 'farm_oauth_flow')) return res.status(400).send('登录会话无效或已过期，请重新登录');
        flows.delete(state); res.clearCookie('farm_oauth_flow', { ...cookieOptions(), maxAge: undefined });
        try {
            const p = oidc.providers().find((p: any) => p.id === flow.provider);
            if (!p || req.query.error || typeof req.query.code !== 'string' || req.query.code.length > 8192) throw new Error('Invalid callback');
            const identity = await oidc.exchange(p, flow.metadata, req.query.code, flow.nonce, flow.verifier);
            const user = users.federated(identity.issuer, identity.subject);
            if (handoffs.size >= 2000) throw new Error('Capacity exceeded');
            const ticket = oidc.random(); handoffs.set(ticket, { userId: user.id, expires: Date.now() + 60_000 });
            res.cookie('farm_oauth_ticket', ticket, { ...cookieOptions(), maxAge: 60_000 });
            return res.redirect(`${oidc.publicOrigin()}/login?oauth=complete`);
        } catch { return res.redirect(`${oidc.publicOrigin()}/login?oauth=error`); }
    });
    app.post('/api/oauth/exchange', (req: Request, res: Response) => {
        cleanup();
        try {
            if (req.headers.origin !== oidc.publicOrigin()) return res.sendStatus(403);
            const ticket = readCookie(req, 'farm_oauth_ticket'); const handoff = handoffs.get(ticket);
            handoffs.delete(ticket); res.clearCookie('farm_oauth_ticket', { ...cookieOptions(), maxAge: undefined });
            const user = handoff && users.find(handoff.userId);
            if (!user) return res.status(401).json({ ok: false, error: '登录已失效，请重新登录' });
            const token = issueToken(); ctx.tokens.add(token); ctx.sessions.set(token, user.id);
            return res.json({ ok: true, data: { token, role: user.role, user: { username: user.username } } });
        } catch { return res.status(503).json({ ok: false, error: '第三方登录配置无效' }); }
    });
}
module.exports = { mountOAuthRoutes };
