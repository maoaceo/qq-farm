const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { io: connect } = require('../../web/node_modules/socket.io-client');

// All data, login attempts and accounts are written to a disposable directory.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-multiuser-'));
const paths = require('../dist/config/runtime-paths');
paths.getDataFile = name => path.join(temp, name);
paths.ensureDataDir = () => temp;
const store = require('../dist/models/store');
const users = require('../dist/models/user-store');
const { createAdminContext } = require('../dist/controllers/admin/context');
const sockets = require('../dist/controllers/admin/socket');
const actions = [];
const provider = {
  getAccounts: () => store.getAccounts(),
  startAccount: id => { actions.push(['start', id]); return true; },
  stopAccount: id => { actions.push(['stop', id]); return true; },
  restartAccount: id => { actions.push(['restart', id]); return true; },
  isAccountRunning: () => false,
  getStatus: id => ({ secret: `status-${id}` }),
  getLogs: id => id ? [{ accountId: id, msg: `log-${id}`, time: 1 }] : [{ accountId: '1', msg: 'admin-only' }],
  getAccountLogs: () => store.getAccounts().accounts.map(a => ({ accountId: a.id, msg: `account-${a.id}` })),
  addAccountLog: () => {},
  setRuntimeAccountName: () => {},
};
const app = express(); app.use(express.json());
const ctx = createAdminContext(provider);
require('../dist/controllers/admin/auth-routes').mountAuthRoutes(app, ctx);
require('../dist/controllers/admin/user-routes').mountUserRoutes(app, ctx);
require('../dist/controllers/admin/account-routes').mountAccountRoutes(app, ctx);
require('../dist/controllers/admin/farm-routes').mountFarmRoutes(app, ctx);
require('../dist/controllers/admin/qq-login-routes').mountQqLoginRoutes(app, ctx);
require('../dist/controllers/admin/wx-login-routes').mountWxLoginRoutes(app, ctx);
ctx.server = http.createServer(app); sockets.setupSocketIO(ctx);
let base;
async function api(method, url, token, body, account) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['x-admin-token'] = token;
  if (account) headers['x-account-id'] = account;
  const res = await fetch(base + url, { method, headers, body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function login(username, password = 'TestPass42!') {
  const r = await api('POST', '/api/login', null, { username, password });
  assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.data.token;
}
function socket(token, accountId) {
  return connect(base, { auth: { token, accountId }, transports: ['websocket'], reconnection: false });
}
function once(s, event) { return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error(`Timeout ${event}`)), 3000); s.once(event, data => { clearTimeout(t); resolve(data); }); }); }

test('multi-user HTTP and realtime tenant isolation', async t => {
  await new Promise(resolve => ctx.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${ctx.server.address().port}`;
  t.after(async () => { await new Promise(resolve => ctx.io.close(resolve)); ctx.server.closeAllConnections(); await new Promise(resolve => ctx.server.close(resolve)); fs.rmSync(temp, { recursive: true, force: true }); });
  // Legacy data must remain visible only to the administrator.
  store.addOrUpdateAccount({ name: 'legacy', code: 'legacy-secret' });
  let admin = await login('admin', 'admin');
  const a = (await api('POST', '/api/users', admin, { username: 'alice', password: 'TestPass42!' })).body.data;
  const b = (await api('POST', '/api/users', admin, { username: 'bobby', password: 'TestPass42!' })).body.data;
  let alice = await login('alice'); const bob = await login('bobby');
  await t.test('new accounts get server-side ownership; legacy stays admin', async () => {
    assert.equal((await api('GET', '/api/accounts', alice)).body.data.accounts.length, 0);
    const ar = await api('POST', '/api/accounts', alice, { name: 'same-remark', code: 'alice-secret' });
    assert.equal(ar.body.data.accounts.length, 1); assert.equal(ar.body.data.accounts[0].ownerId, a.id);
    const br = await api('POST', '/api/accounts', bob, { name: 'same-remark', code: 'bob-secret' });
    assert.equal(br.body.data.accounts.length, 1); assert.equal(br.body.data.accounts[0].ownerId, b.id);
    assert.equal(store.getAccounts().accounts.length, 3);
    assert.equal((await api('GET', '/api/accounts', admin)).body.data.accounts.length, 1);
  });
  const aid = store.getAccounts().accounts.find(x => x.ownerId === a.id).id;
  const bid = store.getAccounts().accounts.find(x => x.ownerId === b.id).id;
  await t.test('all cross-user read/update/start/stop/delete paths rejected', async () => {
    for (const [method, url, body, header] of [
      ['GET', '/api/status', undefined, bid],
      ['GET', `/api/logs?accountId=${bid}`],
      ['POST', `/api/accounts/${bid}/start`], ['POST', `/api/accounts/${bid}/stop`],
      ['DELETE', `/api/accounts/${bid}`],
      ['POST', '/api/accounts', { id: bid, name: 'hijack', code: 'stolen' }],
      ['POST', '/api/accounts/', { id: bid, name: 'hijack' }],
      ['POST', '/api/account/remark/', { id: bid, remark: 'hijack' }],
      ['POST', '/api/accounts', { name: 'fake-owner', ownerId: b.id }],
    ]) assert.equal((await api(method, url, alice, body, header)).status, 403, url);
    assert.equal(store.getAccounts().accounts.find(x => x.id === bid).code, 'bob-secret');
    assert.equal((await api('GET', '/api/status', alice, undefined, aid)).body.data.secret, `status-${aid}`);
    assert.equal((await api('POST', `/api/accounts/${aid}/start`, alice)).status, 200);
  });
  await t.test('canonical IDs cannot be shadowed by another user editable QQ/UIN alias', async () => {
    const resolver = require('../dist/services/account-resolver');
    store.addOrUpdateAccount({ id: aid, uin: bid, qq: bid });
    assert.equal(resolver.findAccountByRef(store.getAccounts().accounts, bid).id, bid);
    assert.equal((await api('GET', '/api/status', alice, undefined, bid)).status, 403);
    assert.equal((await api('POST', `/api/accounts/${bid}/start`, alice)).status, 403);
    require('../dist/models/store/accounts').loadAccounts();
    assert.equal(store.getAccounts().accounts.find(x => x.id === aid).ownerId, a.id);
  });
  await t.test('aggregate logs and config redact other users and system credentials', async () => {
    for (const url of ['/api/logs?accountId=all', '/api/account-logs']) {
      const r = await api('GET', url, alice); const entries = Array.isArray(r.body) ? r.body : r.body.data;
      assert.ok(entries.length); assert.ok(entries.every(e => e.accountId === aid));
    }
    store.setLoginSettings({ qqQrLogin: true, napCatEndpoint: 'http://secret', napCatSignature: 'private-signature' });
    const r = await api('GET', '/api/settings/login-config', alice); assert.equal(r.body.data.napCatSignature, undefined);
    assert.deepEqual((await api('GET', '/api/settings', alice, undefined, aid)).body.data.offlineReminder, {});
    for (const [method, url] of [['GET', '/api/users'], ['POST', '/api/users'], ['GET', '/api/settings/system-config'], ['POST', '/api/SETTINGS/LOGIN-CONFIG/'], ['POST', '/api/settings/offline-reminder/test'], ['GET', '/api/scheduler']]) assert.equal((await api(method, url, alice, {})).status, 403, url);
  });
  await t.test('QR sessions cannot be queried or consumed by another user', async () => {
    // Stub remote QQ service: create an actual task as Alice, then attempt access as Bob.
    const remote = require('../dist/services/qq-login/service');
    const originalCreate = remote.createLoginTask;
    const originalCode = remote.getMiniappCode;
    remote.createLoginTask = async () => ({ taskId: 'alice-task', status: 'waiting', qrImage: 'test-qr', expiresAt: Date.now() + 60_000 });
    remote.getMiniappCode = async () => ({ code: 'alice-auth-code' });
    try {
      assert.equal((await api('POST', '/api/qq-login/tasks', alice)).status, 200);
      assert.equal((await api('POST', '/api/qq-login/tasks/alice-task/code', bob)).status, 404);
      assert.equal((await api('POST', '/api/qq-login/tasks/alice-task/code', alice)).body.data.code, 'alice-auth-code');
    } finally { remote.createLoginTask = originalCreate; remote.getMiniappCode = originalCode; }
    const wx = require('../dist/services/wx-login/service').WxLoginService.prototype;
    const oldQr = wx.createQrSession; const oldDestroy = wx.destroy;
    wx.createQrSession = async () => ({ session: {}, qr: Buffer.from('jpeg-test') }); wx.destroy = () => {};
    try {
      const created = await api('POST', '/api/wx-login/tasks', alice);
      const id = created.body.data.task_id;
      assert.equal((await api('GET', `/api/wx-login/tasks/${id}/qr`, bob)).status, 404);
      assert.equal((await api('POST', `/api/wx-login/tasks/${id}/code`, bob)).status, 404);
      assert.equal((await api('DELETE', `/api/wx-login/tasks/${id}`, bob)).status, 404);
      assert.equal((await api('DELETE', `/api/wx-login/tasks/${id}`, alice)).status, 200);
    } finally { wx.createQrSession = oldQr; wx.destroy = oldDestroy; }
    for (const [method, url] of [['POST', '/api/qq-login/tasks/foreign/code'], ['POST', '/api/qq-login/tasks/foreign/status'], ['GET', '/api/wx-login/tasks/foreign/qr'], ['DELETE', '/api/wx-login/tasks/foreign']]) assert.equal((await api(method, url, alice)).status, 404);
  });
  await t.test('WebSocket all snapshots scoped; foreign subscription denied; live logs isolated', async () => {
    const s = socket(alice, 'all'); t.after(() => s.disconnect());
    const logs = await once(s, 'logs:snapshot'); assert.ok(logs.logs.every(e => e.accountId === aid));
    const denied = once(s, 'subscription:error'); s.emit('subscribe', { accountId: bid }); await denied;
    let leak = false; s.on('log:new', () => { leak = true; });
    sockets.emitRealtimeLog(ctx, { accountId: bid, msg: 'bob-only' });
    await new Promise(resolve => setTimeout(resolve, 80)); assert.equal(leak, false);
    const snapshot = once(s, 'logs:snapshot'); s.emit('subscribe', { accountId: aid }); await snapshot;
    const ownLog = once(s, 'log:new'); sockets.emitRealtimeLog(ctx, { accountId: aid, msg: 'alice-only' }); assert.equal((await ownLog).msg, 'alice-only');
  });
  await t.test('disable user revokes HTTP and sockets; password reset revokes sessions', async () => {
    const s = socket(alice, aid); await once(s, 'ready');
    const disconnected = once(s, 'disconnect'); await api('PATCH', `/api/users/${a.id}`, admin, { disabled: true }); await disconnected; s.disconnect();
    assert.equal((await api('GET', '/api/accounts', alice)).status, 401);
    assert.equal((await api('POST', '/api/login', null, { username: 'alice', password: 'TestPass42!' })).status, 401);
    await api('PATCH', `/api/users/${a.id}`, admin, { disabled: false }); alice = await login('alice');
    await api('PATCH', `/api/users/${a.id}`, admin, { password: 'NewPass42!' });
    assert.equal((await api('GET', '/api/accounts', alice)).status, 401); alice = await login('alice', 'NewPass42!');
    assert.equal((await api('GET', '/api/user/me', alice)).body.data.role, 'user');
    assert.equal((await api('GET', '/api/accounts', bob)).status, 200);
  });
  await t.test('password changes affect only self and cannot alter administrator password', async () => {
    assert.equal((await api('POST', '/api/user/change-password', alice, { oldPassword: 'NewPass42!', newPassword: 'AnotherPass42!' })).body.ok, true);
    assert.equal((await api('GET', '/api/accounts', alice)).status, 401);
    alice = await login('alice', 'AnotherPass42!'); admin = await login('admin', 'admin');
  });
  await t.test('administrator cannot access or manage other users game accounts', async () => {
    assert.deepEqual((await api('GET', '/api/accounts', admin)).body.data.accounts.map(a=>a.id), ['1']);
    for (const id of [aid,bid]) {
      for (const [method,url,body,header] of [
        ['GET','/api/status',undefined,id], ['GET',`/api/logs?accountId=${id}`],
        ['POST',`/api/accounts/${id}/start`],['POST',`/api/accounts/${id}/stop`],['DELETE',`/api/accounts/${id}`],
        ['POST','/api/accounts',{id,name:'admin-hijack'}], ['POST','/api/account/remark',{id,remark:'admin-hijack'}],
        ['POST','/api/users/assign-account',{accountId:id,ownerId:'admin'}],
      ]) assert.equal((await api(method,url,admin,body,header)).status,403,url);
    }
    const logs=(await api('GET','/api/logs?accountId=all',admin)).body.data;
    assert.ok(logs.every(e=>e.accountId==='1'));
    const s=socket(admin,'all'); const snap=await once(s,'logs:snapshot');
    assert.ok(snap.logs.every(e=>e.accountId==='1'));
    const denied=once(s,'subscription:error');s.emit('subscribe',{accountId:aid});await denied;s.disconnect();
    assert.equal((await api('GET','/api/status',admin,undefined,'1')).status,200);
    assert.equal((await api('GET','/api/users',admin)).status,200);
  });
});
