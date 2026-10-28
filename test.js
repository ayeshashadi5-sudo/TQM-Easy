'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qmt-'));
const seed = require('./test/fixture.json');
fs.writeFileSync(path.join(process.env.DATA_DIR, 'data.json'), JSON.stringify({ users: seed.users, programs: seed.programs, entries: Object.fromEntries(seed.entries.map(e => [e.id, e])) }));
const { server } = require('./server.js');
const pin = n => Object.values(seed.users).find(u => u.name === n).pin;
const uid = n => Object.entries(seed.users).find(([k, u]) => u.name === n)[0];
let base;
const call = async (ck, m, u, b, h = {}) => {
  const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'qmt', ...(ck ? { Cookie: ck } : {}), ...h }, body: b === undefined ? undefined : JSON.stringify(b) });
  const j = await r.json().catch(() => ({})); return { s: r.status, j, ck: (r.headers.get('set-cookie') || '').split(';')[0] };
};
const login = async n => { const r = await call(null, 'POST', '/api/login', { name: n, pin: pin(n) }); assert.equal(r.s, 200, 'login ' + n); return r.ck; };
(async () => {
  await new Promise(r => server.listen(0, r)); base = 'http://127.0.0.1:' + server.address().port;
  let ok = 0; const t = (n, c) => { ok++; console.log('✓', n); };
  assert.deepEqual((await call(null, 'GET', '/api/me')).j, {}); t('me بدون جلسة');
  assert.equal((await call(null, 'GET', '/api/c/users')).s, 401); t('رفض القراءة بدون دخول');
  assert.equal((await call(null, 'POST', '/api/login', { name: 'عائشة', pin: pin('عائشة') }, { 'X-Requested-With': '' })).s, 403); t('CSRF header');
  const A = await login('د عائشة'.replace('د ', '')); t('دخول عائشة');
  const aliasOk = await call(null, 'POST', '/api/login', { name: 'م/ هبة', pin: pin('هبة') }); assert.equal(aliasOk.s, 200); t('الدخول يتجاهل الألقاب');
  const users = (await call(A, 'GET', '/api/c/users')).j; assert(users.every(u => u.data.pin)); t('الأدمن يرى كلمات السر');
  const DEV = await login('عصام'), TST = await login('حامد'), MG = await login('هبة');
  const du = (await call(DEV, 'GET', '/api/c/users')).j; assert(du.every(u => !('pin' in u.data))); t('غير الأدمن لا يرى كلمات السر');
  assert.equal((await call(DEV, 'PATCH', '/api/c/users/' + uid('عصام'), { role: 'admin' })).s, 403); t('المطور لا يرفع صلاحيته');
  // entries visibility
  const ent = (await call(A, 'GET', '/api/c/entries')).j; assert(ent.length > 100); t('الأدمن يرى كل الملاحظات ' + ent.length);
  const accE = ent.find(e => e.data.pid === 'accounting' && e.data.status !== 'مغلق');
  const devEntries = (await call(DEV, 'GET', '/api/c/entries')).j; assert(devEntries.every(e => ['apar', 'stores', 'drtablet', 'adt'].includes(e.data.pid))); t('المطور يرى برامجه فقط');
  // create entry permissions
  const body = { pid: 'apar', menu: 'اذن قبض', screen: 'قبض خزينة', desc: 'اختبار', sev: 'وسط', type: 'وظيفي', req: true };
  assert.equal((await call(DEV, 'POST', '/api/c/entries', body)).s, 403); t('المطور لا يضيف ملاحظة');
  const r1 = await call(TST, 'POST', '/api/c/entries', { ...body, by: 'spoof', at: 1 }); assert.equal(r1.s, 200); t('المختبر يضيف ملاحظة');
  const e1 = (await call(TST, 'GET', '/api/c/entries/' + r1.j.id)).j; assert.equal(e1.by, uid('حامد')); assert(e1.at > 1e12); t('الخادم يختم المضيف والوقت');
  assert.equal((await call(TST, 'POST', '/api/c/entries', { ...body, pid: 'accounting' })).s, 403); t('المختبر خارج برنامجه مرفوض');
  assert.equal((await call(TST, 'POST', '/api/c/entries', { ...body, sev: 'غير' })).s, 403); t('أولوية غير معروفة');
  // assignment + status rules
  assert.equal((await call(TST, 'PATCH', '/api/c/entries/' + r1.j.id, { dev: uid('عصام'), orig: uid('عصام') })).s, 403); t('الإسناد يحتاج صلاحية');
  assert.equal((await call(A, 'PATCH', '/api/c/users/' + uid('حامد'), { as: true })).s, 200);
  assert.equal((await call(TST, 'PATCH', '/api/c/entries/' + r1.j.id, { dev: uid('عصام'), orig: uid('عصام'), status: 'مسند' })).s, 200); t('الإسناد بعد منح الصلاحية');
  assert.equal((await call(DEV, 'PATCH', '/api/c/entries/' + r1.j.id, { status: 'جاري العمل' })).s, 200); t('المطور يغيّر حالة مهمته');
  assert.equal((await call(DEV, 'PATCH', '/api/c/entries/' + r1.j.id, { status: 'مغلق' })).s, 403); t('المطور لا يغلق');
  assert.equal((await call(DEV, 'PATCH', '/api/c/entries/' + r1.j.id, { sev: 'خطير' })).s, 403); t('المطور لا يغيّر الأولوية');
  assert.equal((await call(DEV, 'PATCH', '/api/c/entries/' + r1.j.id, { desc: 'x' })).s, 403); t('المطور لا يعدّل الوصف');
  assert.equal((await call(DEV, 'PATCH', '/api/c/entries/' + r1.j.id, { status: 'جاهز لإعادة الاختبار' })).s, 200);
  // ready rules
  const rd = { pid: 'apar', menu: 'اذن قبض', screen: 'قبض خزينة', rel: '', decision: 'جاهزة' };
  assert.equal((await call(A, 'PUT', '/api/c/ready/k1', rd)).s, 403); t('لا اعتماد مع ملاحظة إلزامية مفتوحة');
  assert.equal((await call(MG, 'PUT', '/api/c/ready/k1', { ...rd, decision: 'باستثناء' })).s, 403); t('الاستثناء يحتاج صلاحية وسببًا');
  assert.equal((await call(A, 'PUT', '/api/c/ready/k1', { ...rd, decision: 'باستثناء', reason: 'سبب' })).s, 200); t('الاعتماد باستثناء بسبب');
  // retest closes
  assert.equal((await call(TST, 'POST', '/api/c/retests', { issue: r1.j.id, res: 'نجح' })).s, 200);
  assert.equal((await call(TST, 'PATCH', '/api/c/entries/' + r1.j.id, { status: 'مغلق', lt: 'نجح', lta: Date.now(), rt: 1 })).s, 200); t('المختبر يغلق بعد إعادة الاختبار');
  assert.equal((await call(DEV, 'POST', '/api/c/retests', { issue: r1.j.id, res: 'نجح' })).s, 403); t('المطور لا يسجل إعادة اختبار');
  assert.equal((await call(DEV, 'PATCH', '/api/c/entries/' + r1.j.id, { status: 'جديد' })).s, 403); t('إعادة الفتح تحتاج صلاحية');
  // task scope + stats scope
  const nu = await call(A, 'POST', '/api/c/users', { name: 'اختبار', pin: '4321', role: 'dev', progs: [], pv: [] }); assert.equal(nu.s, 200);
  const N = await call(null, 'POST', '/api/login', { name: 'اختبار', pin: '4321' }); const NC = N.ck;
  assert.equal((await call(NC, 'GET', '/api/c/entries')).j.length, 0); t('مستخدم بلا مهام لا يرى شيئًا');
  assert.equal((await call(A, 'POST', '/api/c/users', { name: 'اختبار', pin: '1111', role: 'dev' })).s, 403); t('اسم مكرر مرفوض');
  assert.equal((await call(A, 'POST', '/api/c/users', { name: 'س', pin: '12' })).s, 403); t('كلمة السر 4 أرقام');
  await call(A, 'PATCH', '/api/c/entries/' + accE.id, { dev: nu.j.id, orig: nu.j.id });
  const te = (await call(NC, 'GET', '/api/c/entries')).j; assert(te.length === 1 && te[0].data.pid === 'accounting'); t('وصول المهام فقط يرى مهمته');
  const tp = (await call(NC, 'GET', '/api/c/programs')).j; assert(tp.length === 1 && Object.keys(tp[0].data.menus).length === 0); t('لا يرى هيكل الشاشات');
  assert.equal((await call(NC, 'GET', '/api/c/history')).j.length, 0); t('لا يرى السجل');
  await call(A, 'PATCH', '/api/c/users/' + nu.j.id, { pv: ['stores'] });
  const se = (await call(NC, 'GET', '/api/c/entries')).j.filter(e => e.data.pid === 'stores'); assert(se.length > 0 && se.every(e => e.data.desc === '')); t('وصول الإحصائيات بلا تفاصيل');
  // last admin protection
  assert.equal((await call(A, 'PATCH', '/api/c/users/' + uid('عائشة'), { role: 'dev' })).s, 403); t('بقاء أدمن واحد');
  assert.equal((await call(A, 'DELETE', '/api/c/users/' + uid('عائشة'))).s, 403); t('لا حذف للنفس');
  assert.equal((await call(A, 'DELETE', '/api/c/entries/' + r1.j.id)).s, 403); t('لا حذف للملاحظات');
  // history
  assert.equal((await call(DEV, 'POST', '/api/c/history', { pid: 'accounting', f: 'x' })).s, 403); t('سجل برنامج بلا وصول');
  const h = await call(DEV, 'POST', '/api/c/history', { pid: 'apar', f: 'x', by: 'spoof', at: 1 }); assert.equal(h.s, 200);
  assert.equal((await call(DEV, 'PUT', '/api/c/history/' + h.j.id, { f: 'y' })).s, 403); t('السجل لا يُعدّل');
  // SSE
  const ctl = new AbortController(); const sres = await fetch(base + '/api/stream', { headers: { Cookie: A }, signal: ctl.signal });
  const rd2 = sres.body.getReader(); await rd2.read(); // retry:
  call(A, 'POST', '/api/c/history', { pid: 'apar', f: 'sse' });
  const ev = new TextDecoder().decode((await rd2.read()).value); assert(ev.includes('"c":"history"')); ctl.abort(); t('البث المباشر SSE');
  const vv = (await call(A, 'GET', '/api/v')).j; assert(vv.history >= 1); t('عدّاد التغييرات للتحديث التلقائي');
  // أدوار مخصصة + حصر الشاشات + بيانات الدخول + اتساق الإسناد
  assert.equal((await call(A, 'PUT', '/api/c/settings/main', { prios: [{ n: 'خطير', d: 1, w: 4 }, { n: 'مرتفع', d: 3, w: 3 }, { n: 'وسط', d: 7, w: 2 }, { n: 'سريع', d: 2, w: 1 }, { n: 'بسيط', d: 14, w: 1 }], roles: [{ k: 'r1', n: 'محاسب مختبر', base: 'tester' }] })).s, 200);
  const cu = await call(A, 'POST', '/api/c/users', { name: 'محاسب', pin: '2468', role: 'r1', progs: ['apar'], sl: { apar: ['اذن قبض|قبض خزينة'] } }); assert.equal(cu.s, 200);
  const CK = (await call(null, 'POST', '/api/login', { name: 'محاسب', pin: '2468' })).ck;
  const ce = (await call(CK, 'GET', '/api/c/entries')).j; assert(ce.length > 0 && ce.every(e => e.data.screen === 'قبض خزينة')); t('حصر الشاشات: لا يرى غير شاشته');
  assert.equal((await call(CK, 'POST', '/api/c/entries', { ...body, screen: 'صرف' })).s, 403); t('حصر الشاشات: لا يضيف على شاشة غيره');
  assert.equal((await call(CK, 'POST', '/api/c/entries', body)).s, 200); t('دور مخصص يعمل كمختبر');
  assert.equal((await call(CK, 'PUT', '/api/c/ready/zz', { ...rd, screen: 'صرف', decision: 'ملغاة' })).s, 403); t('حصر الشاشات في الاعتماد');
  await call(A, 'PATCH', '/api/c/programs/apar', { login: 'user: a / pass: b' });
  assert.equal((await call(DEV, 'GET', '/api/c/programs/apar')).j.login, 'user: a / pass: b'); t('بيانات الدخول لمن له وصول كامل');
  await call(A, 'PATCH', '/api/c/users/' + nu.j.id, { pv: ['apar'] });
  assert.equal((await call(NC, 'GET', '/api/c/programs/apar')).j.login, undefined); t('بيانات الدخول مخفية عن الإحصائيات');
  assert.equal((await call(A, 'DELETE', '/api/c/users/' + cu.j.id)).s, 200);
  const e2 = (await call(A, 'POST', '/api/c/entries', { ...body, desc: 'للإسناد' })).j.id;
  await call(A, 'PATCH', '/api/c/users/' + uid('عصام'), { dl: true });
  await call(A, 'PATCH', '/api/c/entries/' + e2, { dev: uid('عصام'), orig: uid('عصام'), status: 'مسند' });
  assert.equal((await call(DEV, 'PATCH', '/api/c/entries/' + e2, { dev: uid('وليد') })).s, 200); t('التفويض: صاحب المهمة يفوّض مهمته');
  assert.equal((await call(DEV, 'PATCH', '/api/c/entries/' + e2, { dev: uid('عصام') })).s, 403); t('التفويض: لا يتصرف في مهمة غيره');
  // rate limit
  let st = 0; for (let i = 0; i < 6; i++) st = (await call(null, 'POST', '/api/login', { name: 'وليد', pin: '0000' })).s; assert.equal(st, 429); t('تقييد المحاولات');
  // logout
  assert.equal((await call(A, 'POST', '/api/logout')).s, 200); assert.equal((await call(A, 'GET', '/api/c/users')).s, 401); t('تسجيل الخروج');
  console.log('\nكل الاختبارات نجحت:', ok); server.close(); process.exit(0);
})().catch(e => { console.error('✗ فشل:', e.message, e.stack.split('\n')[1]); process.exit(1); });
