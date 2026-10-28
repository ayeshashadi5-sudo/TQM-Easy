#!/usr/bin/env node
'use strict';
/* يحوّل بيانات التطبيق الحالية إلى INSERTs متوافقة مع sql/schema.sql
   node tools/export-sql.js [مصدر JSON] [ملف الإخراج]
   المصدر الافتراضي: data/data.json إن وُجد، وإلا seed/current.json */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..');
const dflt = [path.join(root, 'data', 'data.json'), path.join(root, 'seed', 'current.json')].find(f => fs.existsSync(f));
const src = process.argv[2] || dflt, out = process.argv[3] || path.join(root, 'sql', 'data.sql');
const D = JSON.parse(fs.readFileSync(src, 'utf8'));
if (Array.isArray(D.entries)) D.entries = Object.fromEntries(D.entries.map(e => [e.id, e]));
const g = c => D[c] || {};
const q = v => v === undefined || v === null || v === '' ? 'NULL' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const qq = v => v === undefined || v === null ? 'NULL' : q(String(v));
const hid = (p, s) => p + '_' + crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const rows = [], ins = (t, o) => rows.push(`INSERT INTO ${t} (${Object.keys(o).join(', ')}) VALUES (${Object.values(o).join(', ')});`);
const users = g('users'), progs = g('programs'), cfg = g('settings').main || {};
const U = id => users[id] ? q(id) : 'NULL';

const BASE = { admin: 'أدمن', mgmt: 'إدارة عليا', dev: 'مطور', tester: 'مختبر', viewer: 'مشاهد' };
for (const [k, n] of Object.entries(BASE)) ins('roles', { id: q(k), name: q(n), base_role: q(k), is_builtin: 'TRUE' });
for (const r of cfg.roles || []) ins('roles', { id: q(r.k), name: q(r.n), base_role: q(r.base), is_builtin: 'FALSE' });
const roleIds = new Set([...Object.keys(BASE), ...(cfg.roles || []).map(r => r.k)]);

(cfg.prios || [{ n: 'خطير', d: 1, w: 4 }, { n: 'مرتفع', d: 3, w: 3 }, { n: 'وسط', d: 7, w: 2 }, { n: 'سريع', d: 2, w: 1 }, { n: 'بسيط', d: 14, w: 1 }]).forEach((p, i) => ins('priorities', { name: q(p.n), target_days: p.d || 0, weight: p.w || 1, sort_order: i }));
(cfg.types || ['وظيفي', 'تصميم', 'أداء', 'بيانات', 'أمان', 'تقرير']).forEach((t, i) => ins('issue_types', { name: q(t), sort_order: i }));
Object.entries(cfg.req || {}).filter(([, v]) => v).forEach(([k]) => ins('required_fields', { field: q(k) }));
const PRIO = new Set((cfg.prios || [{ n: 'خطير' }, { n: 'مرتفع' }, { n: 'وسط' }, { n: 'سريع' }, { n: 'بسيط' }]).map(p => p.n));

for (const [id, u] of Object.entries(users)) ins('users', { id: q(id), name: q(u.name), pin: q(String(u.pin)), role_id: q(roleIds.has(u.role) ? u.role : 'viewer'), is_disabled: !!u.off });
const PERMS = ['plan', 'as', 'dl', 'rf', 'rt', 'ap', 'ex', 'ro', 'rl'];
for (const [id, u] of Object.entries(users)) PERMS.filter(p => u[p]).forEach(p => ins('user_permissions', { user_id: q(id), permission: q(p) }));

const scrId = {}, menuId = {};
Object.entries(progs).forEach(([id, p], i) => {
  ins('programs', { id: q(id), name: q(p.name), url: q(p.url), db_name: q(p.db), login_info: q(p.login), icon: q(p.icon && p.icon.length < 60 ? p.icon : null), due_date: q(p.due), is_archived: !!p.archived, sort_order: p.order || i });
  const a = p.arch || { m: [], s: [] };
  Object.entries(p.menus || {}).forEach(([m, xs], mi) => {
    const mid = hid('mn', id + '|' + m); menuId[id + '|' + m] = mid;
    ins('menus', { id: q(mid), program_id: q(id), name: q(m), is_archived: (a.m || []).includes(m), sort_order: mi });
    xs.forEach((x, xi) => { const sid = hid('sc', id + '|' + m + '|' + x); scrId[id + '|' + m + '|' + x] = sid; ins('screens', { id: q(sid), menu_id: q(mid), name: q(x), is_archived: (a.s || []).includes(m + '|' + x), sort_order: xi }); });
  });
});
for (const [id, u] of Object.entries(users)) {
  (u.progs || []).filter(p => progs[p]).forEach(p => ins('user_program_access', { user_id: q(id), program_id: q(p), level: q('full') }));
  (u.pv || []).filter(p => progs[p] && !(u.progs || []).includes(p)).forEach(p => ins('user_program_access', { user_id: q(id), program_id: q(p), level: q('stats') }));
  for (const [pid, l] of Object.entries(u.sl || {})) (l || []).forEach(k => { const s = scrId[pid + '|' + k]; if (s) ins('user_screen_access', { user_id: q(id), screen_id: q(s) }); });
}
const relId = {};
for (const [id, r] of Object.entries(g('releases'))) { if (!progs[r.pid]) continue; relId[r.pid + '|' + r.name] = id; ins('releases', { id: q(id), program_id: q(r.pid), name: q(r.name), is_active: !!r.active }); }
const R = (pid, name) => relId[pid + '|' + name] ? q(relId[pid + '|' + name]) : 'NULL';
const ent = g('entries'), okE = new Set();
const E = Object.entries(ent).filter(([, e]) => progs[e.pid] && scrId[e.pid + '|' + e.menu + '|' + e.screen]).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
for (const [id, e] of E) {
  okE.add(id);
  ins('issues', { id: q(id), program_id: q(e.pid), screen_id: q(scrId[e.pid + '|' + e.menu + '|' + e.screen]), release_id: R(e.pid, e.rel), issue_type: q(e.type), description: q(e.desc || ''), priority: q(PRIO.has(e.sev) ? e.sev : [...PRIO][2]), status: q(e.status), is_required: e.req !== false, assignee_id: U(e.dev), original_assignee_id: U(e.orig), keeps_followup: !!e.fup, due_date: q(e.due), target_date: q(e.tgt), retest_count: (RT0(id) || 0), last_test_result: q(e.lt), last_test_at: e.lta ? e.lta : 'NULL', created_by: U(e.by), created_at: e.at || 0, repeat_of: ent[e.of] ? q(e.of) : 'NULL' });
}
function RT0(id) { return Object.values(g('retests')).filter(r => r.issue === id).length; }
for (const [id, r] of Object.entries(g('retests'))) if (okE.has(r.issue)) ins('issue_retests', { id: q(id), issue_id: q(r.issue), tester_id: U(r.tester), result: q(r.res), comment: q(r.c), tested_at: r.at || 0 });
for (const [id, a] of Object.entries(g('assigns'))) if (okE.has(a.issue)) ins('issue_assignments', { id: q(id), issue_id: q(a.issue), from_user_id: U(a.from), to_user_id: U(a.to), by_user_id: U(a.by), reason: q(a.reason), keeps_followup: a.policy === 'retain', is_first: !!a.first, assigned_at: a.at || 0 });
for (const [id, d] of Object.entries(g('ready'))) { const s = scrId[d.pid + '|' + d.menu + '|' + d.screen]; if (s) ins('screen_readiness', { id: q(id), program_id: q(d.pid), screen_id: q(s), release_id: R(d.pid, d.rel), decision: q(d.decision), reason: q(d.reason), decided_by: U(d.by), decided_at: d.at || 'NULL', covered_issue_ids: q((d.iss || []).join(',')) }); }
for (const [id, d] of Object.entries(g('scrstat'))) { const s = scrId[d.pid + '|' + d.menu + '|' + d.screen]; if (s) ins('screen_status', { id: q(id), program_id: q(d.pid), screen_id: q(s), release_id: R(d.pid, d.rel), stage: q(d.stage), due_date: q(d.due), set_by: U(d.by), set_at: d.at || 'NULL' }); }
for (const [id, h] of Object.entries(g('history'))) ins('audit_log', { id: q(id), at: h.at || 0, user_id: U(h.by), program_id: progs[h.pid] ? q(h.pid) : 'NULL', issue_id: okE.has(h.eid) ? q(h.eid) : 'NULL', action: q(h.f || ''), old_value: q(h.o), new_value: q(h.n) });

fs.writeFileSync(out, '-- تم التوليد من ' + path.basename(src) + ' بتاريخ ' + new Date().toISOString() + '\nBEGIN;\n' + rows.join('\n') + '\nCOMMIT;\n');
console.log('تم إنشاء', out, '(' + rows.length + ' سطر)');
