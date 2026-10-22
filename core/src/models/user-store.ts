export {};
const crypto = require('node:crypto');
const { db } = require('./user-database');
const security = require('./auth-security');
const adminStore = require('./admin-store');
function load(): any[] { return db().prepare('SELECT * FROM users').all(); }
function info(u: any): any { return { id: u.id, username: u.username, role: 'user', disabled: !!u.disabled, createdAt: u.createdAt }; }
function list(): any[] { return load().map(info); }
function find(id: string): any { if (id === 'admin') return { id: 'admin', ...adminStore.getAdminInfo() }; const u = db().prepare('SELECT * FROM users WHERE id = ?').get(id); return u && !u.disabled ? info(u) : null; }

function create(username: string, password: string): any {
    if (!/^[a-zA-Z0-9_\-]{3,32}$/.test(username)) throw new Error('用户名须为3–32位字母、数字、下划线或短横线');
    const users = load();
    if (username.toLowerCase() === adminStore.getAdminInfo().username.toLowerCase() || users.some(u => u.username.toLowerCase() === username.toLowerCase())) throw new Error('用户名已存在');
    const v = security.validatePasswordStrength(password); if (!v.valid) throw new Error(v.errors.join('；'));
    const user = { id: crypto.randomUUID(), username, password: security.hashPassword(password), disabled: false, createdAt: Date.now() };
    try { db().prepare('INSERT INTO users(id,username,password,disabled,createdAt) VALUES (?,?,?,?,?)').run(user.id,user.username,user.password,0,user.createdAt); } catch (e: any) { if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new Error('用户名已存在'); throw e; }
    return info(user);
}
function update(id: string, input: any): any {
    return db().transaction(() => {
        const u = db().prepare('SELECT * FROM users WHERE id = ?').get(id); if (!u) throw new Error('用户不存在');
        if (typeof input.disabled === 'boolean') u.disabled = input.disabled ? 1 : 0;
        if (input.password !== undefined) { const v = security.validatePasswordStrength(String(input.password)); if (!v.valid) throw new Error(v.errors.join('；')); u.password = security.hashPassword(String(input.password)); }
        db().prepare('UPDATE users SET disabled = ?, password = ? WHERE id = ?').run(u.disabled, u.password, id);
        return info(u);
    }).immediate();
}
// Bound per-address login attempts without trusting user-supplied forwarding headers.
const attempts = new Map<string, { count: number; until: number }>();
function validate(username: string, password: string, ip: string): any {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const a = attempts.get(ip) || { count: 0, until: now + 15 * 60_000 };
    if (a.count >= 10) return { error: 'rate_limit', message: '登录尝试过多，请稍后再试' };
    a.count++; attempts.set(ip, a);
    let result: any;
    if (username === adminStore.getAdminInfo().username) result = adminStore.validateAdmin(username, password, ip);
    else { const u = db().prepare('SELECT * FROM users WHERE username = ? AND disabled = 0').get(username); result = u && security.verifyPassword(password, u.password) ? info(u) : { error: 'invalid_credentials', message: '用户名或密码错误' }; }
    if (!result?.error) { attempts.delete(ip); return { ...result, id: result.role === 'admin' ? 'admin' : result.id }; }
    return result;
}
function changePassword(id: string, oldPassword: string, newPassword: string): any {
    if (id === 'admin') return adminStore.changePassword(oldPassword, newPassword);
    const u = db().prepare('SELECT * FROM users WHERE id = ? AND disabled = 0').get(id);
    if (!u || !security.verifyPassword(oldPassword, u.password)) return { ok: false, error: '当前密码错误' };
    try { update(id, { password: newPassword }); return { ok: true }; } catch (e: any) { return { ok: false, error: e.message }; }
}
function federated(issuer: string, subject: string): any {
    return db().transaction(() => {
        const existing = db().prepare('SELECT u.* FROM users u JOIN identities i ON u.id=i.userId WHERE i.issuer=? AND i.subject=?').get(issuer,subject);
        if (existing) { if (existing.disabled) throw new Error('User disabled'); return info(existing); }
        if (process.env.OIDC_AUTO_REGISTER !== 'true') throw new Error('Automatic registration is disabled');
        const id = crypto.randomUUID(); const username = `sso_${crypto.randomBytes(10).toString('hex')}`;
        db().prepare('INSERT INTO users(id,username,password,disabled,createdAt) VALUES (?,?,?,?,?)').run(id,username,'',0,Date.now());
        db().prepare('INSERT INTO identities(issuer,subject,userId) VALUES (?,?,?)').run(issuer,subject,id);
        return find(id);
    }).immediate();
}
module.exports = { list, find, create, update, validate, changePassword, federated };
