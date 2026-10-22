const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'farm-sqlite-'));
const paths=require('../dist/config/runtime-paths');paths.getDataFile=n=>path.join(temp,n);paths.ensureDataDir=()=>temp;
const security=require('../dist/models/auth-security');const dbModule=require('../dist/models/user-database');
test('transactional SQLite migration preserves IDs, password hashes, identities and original backup',()=>{
 const legacy={users:[{id:'original-uuid',username:'legacy',password:security.hashPassword('SafePass42!'),disabled:false,createdAt:123456,identities:[{issuer:'https://issuer.example',subject:'subject'}]},{id:'disabled-uuid',username:'disabled',password:'',disabled:true,createdAt:123457}]};
 const raw=JSON.stringify(legacy);fs.writeFileSync(path.join(temp,'users.json'),raw);
 try{
  const users=require('../dist/models/user-store');
  assert.equal(users.find('original-uuid').username,'legacy');assert.equal(users.find('disabled-uuid'),null);
  assert.equal(users.validate('legacy','SafePass42!','test').id,'original-uuid');
  assert.equal(users.federated('https://issuer.example','subject').id,'original-uuid');
  assert.equal(dbModule.db().prepare('SELECT password FROM users WHERE id=?').get('original-uuid').password,legacy.users[0].password);
  assert.equal(fs.readFileSync(path.join(temp,'users.json.pre-sqlite.bak'),'utf8'),raw);
  assert.equal(fs.readFileSync(path.join(temp,'users.json'),'utf8'),raw);
  assert.throws(()=>dbModule.db().prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('another','LEGACY','',0,1));
  assert.throws(()=>dbModule.db().prepare('INSERT INTO identities VALUES (?,?,?)').run('https://issuer.example','subject','disabled-uuid'));
  users.update('original-uuid',{password:'Changed42!',disabled:false});
  const added=users.create('new_user','SafePass42!');dbModule.close();
  assert.ok(users.find(added.id));assert.equal(users.validate('legacy','Changed42!','test2').id,'original-uuid');
  assert.equal(users.list().length,3); // Migration marker prevents stale JSON overwriting updates.
  dbModule.close();
  const Database=require('better-sqlite3');let db=new Database(path.join(temp,'users.sqlite'));assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();
 }finally{dbModule.close();fs.rmSync(temp,{recursive:true,force:true});}
});

test('migration conflict rolls back completely and does not silently replace users',()=>{
 const {execFileSync}=require('node:child_process');
 const code=`
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'farm-bad-migration-'));
 const paths=require('./dist/config/runtime-paths');paths.getDataFile=n=>path.join(dir,n);paths.ensureDataDir=()=>dir;
 const legacy={users:[{id:'a',username:'same',password:'hash',createdAt:1},{id:'b',username:'SAME',password:'hash',createdAt:2}]};
 fs.writeFileSync(path.join(dir,'users.json'),JSON.stringify(legacy));
 const m=require('./dist/models/user-database');assert.throws(()=>m.db());
 const D=require('better-sqlite3');const d=new D(path.join(dir,'users.sqlite'));
 assert.equal(d.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);
 assert.equal(d.prepare('SELECT COUNT(*) AS n FROM migrations').get().n,0);d.close();
 assert.equal(fs.readFileSync(path.join(dir,'users.json'),'utf8'),JSON.stringify(legacy));
 fs.rmSync(dir,{recursive:true,force:true});`;
 execFileSync(process.execPath,['-e',code],{cwd:path.join(__dirname,'..')});
});
