import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
import { cancelLoginTask, createLoginTask, getMiniappCode, QQ_MINIAPP_APP_ID, queryLoginStatus } from '../../services/qq-login/service';
export {};

const { createAuthRequired } = require('./middleware');

function publicTask(task: any) {
    return {
        task_id: task.taskId,
        status: task.status,
        qr_image: task.qrImage,
        expires_at: task.expiresAt,
    };
}

function sendError(res: Response, error: any, fallback: string): void {
    res.json({
        ok: false,
        error: String(error?.message || '').trim() || fallback,
    });
}

function mountQqLoginRoutes(app: Application, ctx: AdminContext): void {
    const owners = new Map<string, { owner: string; expires: number }>();
    app.use('/api/qq-login', createAuthRequired(ctx));
    app.use('/api/qq-login/tasks/:taskId', (req: Request, res: Response, next: any) => {
        const task = owners.get(String(req.params.taskId));
        if (!task || task.expires < Date.now() || task.owner !== (req as any).user.id) return res.status(404).json({ ok: false, error: 'Login task not found' });
        return next();
    });

    app.post('/api/qq-login/tasks', async (req: Request, res: Response) => {
        try {
            for (const [id, t] of owners) if (t.expires < Date.now()) owners.delete(id);
            const task = await createLoginTask();
            owners.set(task.taskId, { owner: (req as any).user.id, expires: Date.now() + 10 * 60_000 });
            res.json({ ok: true, data: publicTask(task) });
        }
        catch (error: any) {
            sendError(res, error, 'QQ 登录任务创建失败');
        }
    });

    app.post('/api/qq-login/tasks/:taskId/status', async (req: Request, res: Response) => {
        try {
            const task = await queryLoginStatus(String(req.params.taskId || ''));
            res.json({ ok: true, data: publicTask(task) });
        }
        catch (error: any) {
            sendError(res, error, 'QQ 登录状态查询失败');
        }
    });

    app.post('/api/qq-login/tasks/:taskId/code', async (req: Request, res: Response) => {
        try {
            const result = await getMiniappCode(String(req.params.taskId || ''));
            res.json({ ok: true, data: { code: result.code, nickname: result.nickname || '', app_id: QQ_MINIAPP_APP_ID } });
        }
        catch (error: any) {
            sendError(res, error, 'QQ 小程序授权 Code 获取失败');
        }
    });

    app.post('/api/qq-login/tasks/:taskId/cancel', async (req: Request, res: Response) => {
        try {
            await cancelLoginTask(String(req.params.taskId || ''));
            res.json({ ok: true });
        }
        catch (error: any) {
            sendError(res, error, 'QQ 登录任务取消失败');
        }
    });
}

module.exports = { mountQqLoginRoutes };
