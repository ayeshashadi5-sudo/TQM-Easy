'use strict';
/* QMT متابعة البرامج: خادم بلا اعتماديات خارجية (Node 18+)
   - تخزين: ملف JSON واحد في DATA_DIR مع نسخ احتياطية
   - دخول: الاسم + كلمة سر من 4 أرقام، جلسة بكوكي HttpOnly
   - الصلاحيات تُفحص هنا في الخادم (وليس في الواجهة فقط) */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = +process.env.PORT || 3000;
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'data.json');
const PUB = path.join(__dirname, 'public');
const SECURE = process.env.COOKIE_SECURE === '1', TRUST = process.env.TRUST_PROXY === '1';
const SESSION_MS = 30 * 864e5;
const COLS = ['users', 'programs', 'entries', 'history', 'ready', 'scrstat', 'releases', 'retests', 'assigns', 'settings'];

/* ---------- التخزين ---------- */
fs.mkdirSync(path.join(DIR, 'backups'), { recursive: true });
let D = {};
try { D = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { D = {}; }
for (const c of [...COLS, 'sessions']) D[c] = D[c] || {};
if (!Object.keys(D.users).length) {
  try {
    const cur = path.join(__dirname, 'seed', 'current.json');
    if (fs.existsSync(cur)) {
      const s = JSON.parse(fs.readFileSync(cur, 'utf8'));
      for (const c of COLS) D[c] = s[c] || {};
    } else {
      const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'seed.json'), 'utf8'));
      D.users = s.users; D.programs = s.programs; D.entries = Object.fromEntries(s.entries.map(e => [e.id, e]));
    }
    console.log('تم تحميل البيانات الأولية');
  } catch (e) { console.error('لا يوجد seed', e.message); }
}
let timer = null, lastBackup = '';
function flush() {
  clearTimeout(timer); timer = null;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(D));
  if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.bak');
  fs.renameSync(tmp, FILE);
  const day = new Date().toISOString().slice(0, 10);
  if (day !== lastBackup) {
    lastBackup = day; fs.copyFileSync(FILE, path.join(DIR, 'backups', `data-${day}.json`));
    const f = fs.readdirSync(path.join(DIR, 'backups')).sort(); f.slice(0, -30).forEach(n => fs.unlinkSync(path.join(DIR, 'backups', n)));
  }
}
const save = () => { if (!timer) timer = setTimeout(flush, 250); };
flush();
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => { flush(); process.exit(0); }));

/* ---------- أدوات ---------- */
const nid = () => crypto.randomBytes(9).toString('base64url');
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const merge = (a, b) => { if (!isObj(a) || !isObj(b)) return b; const o = { ...a }; for (const k in b) o[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : b[k]; return o; };
const norm = s => String(s || '').trim().replace(/^(م|د)(\/|\s)\s*/, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, '').toLowerCase();
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const send = (res, code, obj, hdr = {}) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...hdr }); res.end(b); };
const readBody = req => new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) { no(new Error('كبير')); req.destroy(); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(new Error('JSON غير صالح')); } }); });
const cookie = req => Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split('=')).filter(x => x[0]).map(x => [x[0], x.slice(1).join('=')]));
const ipOf = req => (TRUST && req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

/* ---------- الصلاحيات ---------- */
const base = u => ((D.settings.main && D.settings.main.roles) || []).find(r => r.k === u.role)?.base || u.role;
const isAdm = u => base(u) === 'admin', allp = u => isAdm(u) || base(u) === 'mgmt';
const can = (u, k) => isAdm(u) || !!u[k] || (k === 'rt' && base(u) === 'tester');
/* حصر الشاشات لكل مستخدم: u.sl = { programId: ['القائمة|الشاشة', ...] } (فارغ = الكل) */
const okScr = (u, pid, m, x) => { if (allp(u)) return true; const l = u.sl && u.sl[pid]; return !l || !l.length || l.includes(m + '|' + x); };
const scope = (u, pid) => {
  const p = D.programs[pid]; if (!p || (p.archived && !isAdm(u))) return null;
  if (allp(u) || (u.progs || []).includes(pid)) return 'full';
  if ((u.pv || []).includes(pid)) return 'stats';
  return Object.values(D.entries).some(e => e.pid === pid && e.dev === u.id) ? 'task' : null;
};
const prioNames = () => (D.settings.main && D.settings.main.prios || [{ n: 'خطير' }, { n: 'مرتفع' }, { n: 'وسط' }, { n: 'سريع' }, { n: 'بسيط' }]).map(x => x.n);

function readColl(u, c) {
  const items = Object.entries(D[c]).map(([id, data]) => ({ id, data }));
  const sc = pid => scope(u, pid);
  switch (c) {
    case 'users': return items.map(x => ({ id: x.id, data: isAdm(u) ? x.data : (({ pin, ...r }) => r)(x.data) }));
    case 'settings': return items;
    case 'programs': return items.filter(x => sc(x.id)).map(x => sc(x.id) === 'full' ? x : { id: x.id, data: { ...x.data, login: undefined, menus: sc(x.id) === 'task' ? {} : x.data.menus } });
    case 'releases': return items.filter(x => sc(x.data.pid));
    case 'entries': return items.flatMap(x => {
      const s = sc(x.data.pid), e = x.data;
      if (s === 'full') return okScr(u, e.pid, e.menu, e.screen) ? [x] : [];
      if (s === 'stats') return okScr(u, e.pid, e.menu, e.screen) ? [{ id: x.id, data: { pid: e.pid, menu: e.menu, screen: e.screen, status: e.status, sev: e.sev, req: e.req, type: e.type, rel: e.rel, due: e.due, tgt: e.tgt, at: e.at, desc: '' } }] : [];
      if (s === 'task' && (e.dev === u.id || (e.orig === u.id && e.fup))) return [x];
      return [];
    });
    case 'ready': case 'scrstat': return items.filter(x => (sc(x.data.pid) === 'full' || sc(x.data.pid) === 'stats') && okScr(u, x.data.pid, x.data.menu, x.data.screen));
    case 'history': return items.filter(x => { if (!x.data.pid) return isAdm(u); if (sc(x.data.pid) !== 'full') return false; const e = x.data.eid && D.entries[x.data.eid]; return !e || okScr(u, e.pid, e.menu, e.screen); });
    case 'retests': case 'assigns': {
      return items.filter(x => { const e = D.entries[x.data.issue]; return e && ((sc(e.pid) === 'full' && okScr(u, e.pid, e.menu, e.screen)) || (sc(e.pid) === 'task' && (e.dev === u.id || e.orig === u.id))); });
    }
  }
  return [];
}

const ALL_ST = ['جديد', 'مسند', 'جاري العمل', 'جاهز لإعادة الاختبار', 'قيد إعادة الاختبار', 'مغلق', 'مؤجل'];
function allowedStatuses(u, e) {
  if (isAdm(u)) return ALL_ST;
  const s = e.status, o = [s];
  if (e.dev === u.id) {
    if (['جديد', 'مسند', 'مؤجل'].includes(s)) o.push('جاري العمل');
    if (s === 'جاري العمل') o.push('جاهز لإعادة الاختبار', 'مؤجل');
    if (s === 'جاهز لإعادة الاختبار') o.push('جاري العمل');
  }
  if (can(u, 'rt') && (s === 'جاهز لإعادة الاختبار' || s === 'قيد إعادة الاختبار')) o.push('مغلق', 'جاري العمل', 'قيد إعادة الاختبار');
  if (s === 'مغلق' && can(u, 'ro')) o.push('جديد', 'جاري العمل');
  return [...new Set(o)];
}
const canOwn = (u, e) => isAdm(u) || can(u, 'as') || (e.dev === u.id && can(u, 'dl'));
function entryUpdateError(u, old, nw) {
  if (isAdm(u)) return null;
  const sc = scope(u, old.pid); if (!sc) return 'غير مصرح';
  if (sc === 'full' && !okScr(u, old.pid, old.menu, old.screen)) return 'غير مصرح';
  const ch = [...new Set([...Object.keys(old), ...Object.keys(nw)])].filter(k => JSON.stringify(old[k]) !== JSON.stringify(nw[k]));
  if (sc !== 'full' && !(sc === 'task' && old.dev === u.id)) return 'غير مصرح';
  for (const k of ch) {
    if (['sev', 'due', 'tgt'].includes(k)) { if (!u.plan) return 'لا تملك صلاحية تحديد المواعيد والأولويات'; }
    else if (['dev', 'orig', 'fup'].includes(k)) { if (!canOwn(u, old)) return 'لا تملك صلاحية تغيير المسؤول'; }
    else if (k === 'status') {
      if (!allowedStatuses(u, old).includes(nw.status) && !(ch.includes('dev') && nw.status === 'مسند' && canOwn(u, old))) return 'انتقال الحالة غير مسموح لك';
    }
    else if (['rt', 'lt', 'lta'].includes(k)) { if (!can(u, 'rt')) return 'لا تملك صلاحية إعادة الاختبار'; }
    else if (k === 'rel') { if (!can(u, 'rl')) return 'غير مصرح'; }
    else return 'غير مصرح بتعديل ' + k;
  }
  return null;
}
function blocking(body) {
  return Object.values(D.entries).filter(e => e.pid === body.pid && e.menu === body.menu && e.screen === body.screen && (!body.rel || (e.rel || '') === body.rel) && e.req !== false && e.status !== 'مغلق');
}

/* يعيد رسالة خطأ أو يطبّق التعديل */
function mutate(u, c, id, op, body) {
  const old = id ? D[c][id] : undefined;
  const E = m => ({ error: m });
  delete body.id;
  switch (c) {
    case 'users': {
      if (!isAdm(u)) return E('للأدمن فقط');
      if (op === 'delete') { if (id === u.id) return E('لا يمكنك حذف نفسك'); delete D.users[id]; return {}; }
      const nw = op === 'patch' ? merge(old || {}, body) : body;
      if (!nw.name || !/^\d{4}$/.test(String(nw.pin))) return E('الاسم وكلمة سر من 4 أرقام مطلوبان');
      nw.pin = String(nw.pin);
      if (Object.entries(D.users).some(([k, x]) => k !== id && norm(x.name) === norm(nw.name))) return E('الاسم موجود');
      if (old && old.role === 'admin' && (nw.role !== 'admin' || nw.off) && !Object.entries(D.users).some(([k, x]) => k !== id && x.role === 'admin' && !x.off)) return E('يجب بقاء أدمن واحد على الأقل');
      D.users[id] = nw; return {};
    }
    case 'programs': case 'settings': if (!isAdm(u)) return E('للأدمن فقط'); if (op === 'delete') return E('الحذف غير مسموح، استخدم الأرشفة'); D[c][id] = op === 'patch' ? merge(old || {}, body) : body; return {};
    case 'releases': {
      const nw = op === 'patch' ? merge(old || {}, body) : body;
      if (op === 'delete') return E('الحذف غير مسموح');
      if (!(isAdm(u) || (can(u, 'rl') && scope(u, nw.pid) === 'full'))) return E('لا تملك صلاحية إدارة الإصدارات');
      if (Object.entries(D.releases).some(([k, r]) => k !== id && r.pid === nw.pid && norm(r.name) === norm(nw.name))) return E('اسم الإصدار موجود في هذا البرنامج');
      D.releases[id] = nw; return {};
    }
    case 'entries': {
      if (op === 'delete') return E('الحذف غير مسموح');
      if (op === 'create') {
        const sc = scope(u, body.pid);
        if (!isAdm(u) && !(sc === 'full' && okScr(u, body.pid, body.menu, body.screen) && (base(u) === 'tester' || (body.of && can(u, 'ro'))))) return E('لا تملك صلاحية إضافة ملاحظات');
        if (!String(body.desc || '').trim() || !String(body.type || '').trim()) return E('الوصف والنوع إلزاميان');
        if (!prioNames().includes(body.sev)) return E('أولوية غير معروفة');
        if (body.dev && !can(u, 'as')) return E('لا تملك صلاحية الإسناد');
        body.by = u.id; body.at = Date.now(); body.status = body.dev ? 'مسند' : 'جديد'; body.desc = String(body.desc).slice(0, 4000);
        D.entries[id] = body; return {};
      }
      if (!old) return E('غير موجود');
      const nw = op === 'patch' ? merge(old, body) : body;
      const err = entryUpdateError(u, old, nw); if (err) return E(err);
      D.entries[id] = nw; return {};
    }
    case 'ready': {
      if (op === 'delete') return isAdm(u) ? (delete D.ready[id], {}) : E('للأدمن فقط');
      if (scope(u, body.pid) !== 'full' || !okScr(u, body.pid, body.menu, body.screen)) return E('غير مصرح');
      const d = body.decision;
      if (d === 'جاهزة') { if (!can(u, 'ap')) return E('لا تملك صلاحية الاعتماد'); if (blocking(body).length) return E('توجد ملاحظات إلزامية لم يعتمدها الاختبار'); }
      else if (d === 'باستثناء') { if (!can(u, 'ex')) return E('لا تملك صلاحية الاعتماد باستثناء'); if (!String(body.reason || '').trim()) return E('السبب إلزامي'); }
      else if (d === 'ملغاة') { if (!(can(u, 'ap') || can(u, 'ex') || can(u, 'rt') || base(u) === 'tester')) return E('غير مصرح'); }
      else return E('قرار غير معروف');
      body.by = u.id; body.at = Date.now(); D.ready[id] = body; return {};
    }
    case 'scrstat': {
      if (op === 'delete') return isAdm(u) ? (delete D.scrstat[id], {}) : E('للأدمن فقط');
      if (scope(u, body.pid) !== 'full' || !(isAdm(u) || base(u) === 'tester' || u.plan)) return E('غير مصرح');
      body.by = u.id; body.at = Date.now(); D.scrstat[id] = body; return {};
    }
    case 'retests': {
      const e = D.entries[body.issue]; if (op !== 'create' || !e) return E('غير مصرح');
      if (!can(u, 'rt') || !scope(u, e.pid)) return E('لا تملك صلاحية إعادة الاختبار');
      body.tester = u.id; body.at = Date.now(); body.pid = e.pid; D.retests[id] = body; return {};
    }
    case 'assigns': {
      const e = D.entries[body.issue]; if (op !== 'create' || !e) return E('غير مصرح');
      if (!(can(u, 'as') || can(u, 'dl')) || !scope(u, e.pid)) return E('لا تملك صلاحية الإسناد');
      body.by = u.id; body.at = Date.now(); body.pid = e.pid; D.assigns[id] = body; return {};
    }
    case 'history': {
      if (op !== 'create') return E('السجل لا يُعدّل');
      if (body.pid && !scope(u, body.pid)) return E('غير مصرح');
      body.by = u.id; body.at = Date.now(); D.history[id] = body;
      const ks = Object.keys(D.history); if (ks.length > 20000) delete D.history[ks[0]];
      return {};
    }
  }
  return E('غير موجود');
}

/* ---------- الجلسات والدخول ---------- */
const tries = new Map();
const sessUser = req => {
  const t = cookie(req).sid, s = t && D.sessions[t];
  if (!s || s.exp < Date.now()) return null;
  const x = D.users[s.uid]; if (!x || x.off) return null;
  return { id: s.uid, ...x };
};
const clients = new Set();
const ver = {};
const broadcast = c => { ver[c] = (ver[c] || 0) + 1; const m = `data: ${JSON.stringify({ c })}\n\n`; clients.forEach(r => { try { r.write(m); } catch (e) { clients.delete(r); } }); };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'), p = url.pathname;
    if (p === '/healthz') return send(res, 200, { ok: true });
    if (p.startsWith('/api/')) {
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'qmt') return send(res, 403, { error: 'طلب مرفوض' });
      if (p === '/api/login' && req.method === 'POST') {
        const b = await readBody(req), key = ipOf(req) + '|' + norm(b.name), t = tries.get(key) || { n: 0, until: 0 };
        if (Date.now() < t.until) return send(res, 429, { error: 'محاولات كثيرة، حاول بعد 10 دقائق' });
        const f = Object.entries(D.users).find(([k, x]) => norm(x.name) === norm(b.name) && !x.off);
        if (!f || !same(f[1].pin, b.pin)) { t.n++; if (t.n >= 5) { t.until = Date.now() + 6e5; t.n = 0; } tries.set(key, t); return send(res, 401, { error: 'الاسم أو كلمة السر غير صحيحة، أو الحساب معطل' }); }
        tries.delete(key);
        const tok = crypto.randomBytes(24).toString('base64url');
        D.sessions[tok] = { uid: f[0], exp: Date.now() + SESSION_MS }; save();
        const secure = SECURE || (TRUST && req.headers['x-forwarded-proto'] === 'https');
        return send(res, 200, { id: f[0], name: f[1].name, role: f[1].role }, { 'Set-Cookie': `sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}` });
      }
      if (p === '/api/logout' && req.method === 'POST') { const t = cookie(req).sid; if (t) { delete D.sessions[t]; save(); } return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' }); }
      const u = sessUser(req);
      if (p === '/api/me') return send(res, 200, u ? { id: u.id, name: u.name, role: u.role } : {});
      if (!u) return send(res, 401, { error: 'يلزم تسجيل الدخول' });
      if (p === '/api/v') return send(res, 200, ver);
      if (p === '/api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('retry: 3000\n\n'); clients.add(res); const k = setInterval(() => res.write(': ping\n\n'), 25000);
        req.on('close', () => { clearInterval(k); clients.delete(res); }); return;
      }
      const m = p.match(/^\/api\/c\/([a-z]+)(?:\/(.+))?$/);
      if (m && COLS.includes(m[1])) {
        const c = m[1], id = m[2] && decodeURIComponent(m[2]);
        if (req.method === 'GET' && !id) return send(res, 200, readColl(u, c));
        if (req.method === 'GET') { const d = readColl(u, c).find(x => x.id === id); return d ? send(res, 200, d.data) : send(res, 404, { error: 'غير موجود' }); }
        const body = await readBody(req);
        const op = req.method === 'POST' ? 'create' : req.method === 'PUT' ? 'set' : req.method === 'PATCH' ? 'patch' : req.method === 'DELETE' ? 'delete' : '';
        if (!op) return send(res, 405, { error: 'غير مدعوم' });
        const nidv = op === 'create' ? nid() : id;
        if (!nidv) return send(res, 400, { error: 'معرّف مطلوب' });
        const r = mutate(u, c, nidv, op === 'create' ? 'create' : op, isObj(body) ? body : {});
        if (r.error) return send(res, 403, { error: r.error });
        save(); broadcast(c); return send(res, 200, { id: nidv });
      }
      return send(res, 404, { error: 'غير موجود' });
    }
    // ملفات الواجهة
    let f = path.join(PUB, p === '/' ? 'index.html' : path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC });
    fs.createReadStream(f).pipe(res);
  } catch (e) { send(res, 400, { error: e.message || 'خطأ' }); }
});
if (require.main === module) server.listen(PORT, () => {
  const ips = Object.values(require('os').networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\nQMT يعمل الآن. اترك هذه النافذة مفتوحة.\n  على هذا الجهاز:        http://localhost:' + PORT);
  ips.forEach(ip => console.log('  لباقي أجهزة الشبكة:    http://' + ip + ':' + PORT));
  console.log('');
});
module.exports = { server };
