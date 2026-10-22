const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const express = require('express'); const http = require('node:http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-register-'));
const paths = require('../dist/config/runtime-paths'); paths.getDataFile = n => path.join(tmp, n); paths.ensureDataDir = () => tmp;
const users = require('../dist/models/user-store');
const store = require('../dist/models/store');
test('ordinary registration, auto-login, role isolation, validation, toggle and limits', async t => {
  const prev = process.env.LOCAL_REGISTRATION_ENABLED; delete process.env.LOCAL_REGISTRATION_ENABLED;
  const app = express(); app.use(express.json());
  const ctx = require('../dist/controllers/admin/context').createAdminContext({ getAccounts: () => store.getAccounts() });
  require('../dist/controllers/admin/auth-routes').mountAuthRoutes(app, ctx);
  require('../dist/controllers/admin/user-routes').mountUserRoutes(app, ctx);
  require('../dist/controllers/admin/account-routes').mountAccountRoutes(app, ctx);
  const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { if (prev === undefined) delete process.env.LOCAL_REGISTRATION_ENABLED; else process.env.LOCAL_REGISTRATION_ENABLED = prev; server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(tmp, { recursive:true,force:true }); });
  async function request(url, body, token) {
    const res = await fetch(base+url, { method: body ? 'POST' : 'GET', headers:{ 'content-type':'application/json', ...(token ? {'x-admin-token':token} : {}) }, body:body ? JSON.stringify(body):undefined });
    return { status:res.status, body:await res.json() };
  }
  const good = {username:'new_user',password:'SafePass42!',confirmPassword:'SafePass42!'};
  assert.equal((await request('/api/registration')).body.data.enabled,true);
  store.addOrUpdateAccount({name:'admin-secret-account'});
  const created = await request('/api/register', {...good,role:'admin',ownerId:'admin',id:'admin'});
  assert.equal(created.status,201); assert.equal(created.body.data.role,'user');
  const token=created.body.data.token;
  const me=await request('/api/user/me',undefined,token); assert.equal(me.body.data.role,'user'); assert.notEqual(me.body.data.id,'admin');
  assert.equal((await request('/api/users',undefined,token)).status,403);
  assert.equal((await request('/api/accounts',undefined,token)).body.data.accounts.length,0);
  assert.equal((await request('/api/login',{username:good.username,password:good.password})).status,200);
  assert.equal(users.list().some(u=>'password' in u),false);
  const raw=require('../dist/models/user-database').db().prepare('SELECT password FROM users').get(); assert.notEqual(raw.password,good.password); assert.ok(fs.existsSync(path.join(tmp,'users.sqlite')));
  for (const body of [good,{...good,username:'NEW_USER'}, {...good,username:'admin'}, {...good,username:'bad name'}, {...good,username:'another',password:'123456',confirmPassword:'123456'}, {...good,username:'another',confirmPassword:'wrong'}, {username:'missing'}, {...good,username:{x:1}}]) {
    assert.equal((await request('/api/register',body)).status,400);
  }
  assert.equal(users.list().length,1);
  assert.equal((await request('/api/register',{...good,username:'last-valid'})).status,201);
  assert.equal((await request('/api/register',{...good,username:'rate-limited'})).status,429);
  process.env.LOCAL_REGISTRATION_ENABLED='false';
  assert.equal((await request('/api/registration')).body.data.enabled,false);
  assert.equal((await request('/api/register',{...good,username:'disabled'})).status,403);
});
