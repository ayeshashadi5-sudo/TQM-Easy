#!/usr/bin/env node
'use strict';
/* يتحقق أن schema.sql و data.sql يعملان فعلًا على SQLite (مضمن في Node 22+) */
const fs = require('fs'), path = require('path'); const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8'));
db.exec(fs.readFileSync(path.join(__dirname, '..', 'sql', 'data.sql'), 'utf8'));
const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
for (const n of t) console.log(n.padEnd(22), db.prepare(`SELECT count(*) c FROM ${n}`).get().c);
const bad = db.prepare('PRAGMA foreign_key_check').all(); console.log('foreign key violations:', bad.length);
if (bad.length) process.exit(1);
