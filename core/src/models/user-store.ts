export {};
const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readJsonFileStrict, writeJsonFileAtomic } = require('../services/json-db');
const security = require('./auth-security');
const adminStore = require('./admin-store');
const file = getDataFile('users.json');
interface User { id: string; username: string; password: string; disabled: boolean; createdAt: number; identities?: { issuer: string; subject: string }[]; }
function load(): User[] {
    ensureDataDir();
    const data = readJsonFileStrict(file, () => ({ users: [] }));
    if (!data || !Array.isArray(data.users)) throw new Error('Invalid users data');
    return data.users;
}
function info(u: User): any { return { id: u.id, username: u.username, role: 'user', disabled: u.disabled, createdAt: u.createdAt }; }
function list(): any[] { return load().map(info); }
function find(id: string): any { if (id === 'admin') return { id: 'admin', ...adminStore.getAdminInfo() }; const u = load().find(x => x.id === id); return u && !u.disabled ? info(u) : null; }
function save(users: User[]): void { writeJsonFileAtomic(file, { users }); }
function create(username: string, password: string): any {
    if (!/^[a-zA-Z0-9_\-]{3,32}$/.test(username)) throw new Error('用户名须为3–32位字母、数字、下划线或短横线');
    const users = load();
    if (username.toLowerCase() === adminStore.getAdminInfo().username.toLowerCase() || users.some(u => u.username.toLowerCase() === username.toLowerCase())) throw new Error('用户名已存在');
    const v = security.validatePasswordStrength(password); if (!v.valid) throw new Error(v.errors.join('；'));
    const user = { id: crypto.randomUUID(), username, password: security.hashPassword(password), disabled: false, createdAt: Date.now() };
    users.push(user); save(users); return info(user);
}
function update(id: string, input: any): any {
    const users = load(); const u = users.find(x => x.id === id); if (!u) throw new Error('用户不存在');
    if (typeof input.disabled === 'boolean') u.disabled = input.disabled;
    if (input.password !== undefined) { const v = security.validatePasswordStrength(String(input.password)); if (!v.valid) throw new Error(v.errors.join('；')); u.password = security.hashPassword(String(input.password)); }
    save(users); return info(u);
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
    else { const u = load().find(x => x.username === username && !x.disabled); result = u && security.verifyPassword(password, u.password) ? info(u) : { error: 'invalid_credentials', message: '用户名或密码错误' }; }
    if (!result?.error) { attempts.delete(ip); return { ...result, id: result.role === 'admin' ? 'admin' : result.id }; }
    return result;
}
function changePassword(id: string, oldPassword: string, newPassword: string): any {
    if (id === 'admin') return adminStore.changePassword(oldPassword, newPassword);
    const u = load().find(x => x.id === id && !x.disabled);
    if (!u || !security.verifyPassword(oldPassword, u.password)) return { ok: false, error: '当前密码错误' };
    try { update(id, { password: newPassword }); return { ok: true }; } catch (e: any) { return { ok: false, error: e.message }; }
}
function federated(issuer: string, subject: string): any {
    const users = load();
    const existing = users.find(u => u.identities?.some(i => i.issuer === issuer && i.subject === subject));
    if (existing) { if (existing.disabled) throw new Error('User disabled'); return info(existing); }
    if (process.env.OIDC_AUTO_REGISTER !== 'true') throw new Error('Automatic registration is disabled');
    // Identity = verified (issuer, sub), never email/name. No implicit local account linking.
    let username: string;
    do { username = `sso_${crypto.randomBytes(10).toString('hex')}`; } while (users.some(u => u.username === username) || adminStore.getAdminInfo().username === username);
    const user: User = { id: crypto.randomUUID(), username, password: '', disabled: false, createdAt: Date.now(), identities: [{ issuer, subject }] };
    users.push(user); save(users); return info(user);
}
module.exports = { list, find, create, update, validate, changePassword, federated };
