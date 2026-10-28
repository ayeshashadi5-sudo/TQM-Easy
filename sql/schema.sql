-- TQM easy · مخطط قاعدة البيانات (متوافق مع PostgreSQL و SQLite و MySQL 8 مع تعديلات بسيطة)
-- كل المعرفات نصية، والأوقات BIGINT (ملّي ثانية Unix) كما في التطبيق، وتواريخ الاستحقاق نص YYYY-MM-DD.

CREATE TABLE roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  base_role   TEXT NOT NULL CHECK (base_role IN ('admin','mgmt','dev','tester','viewer')),
  is_builtin  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  pin          TEXT NOT NULL CHECK (length(pin) = 4),
  role_id      TEXT NOT NULL REFERENCES roles(id),
  is_disabled  BOOLEAN NOT NULL DEFAULT FALSE
);

-- صلاحيات دقيقة: plan, as, dl, rf, rt, ap, ex, ro, rl
CREATE TABLE user_permissions (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL,
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE programs (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  url          TEXT,
  db_name      TEXT,
  login_info   TEXT,
  icon         TEXT,
  due_date     TEXT,
  is_archived  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE user_program_access (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id  TEXT NOT NULL REFERENCES programs(id),
  level       TEXT NOT NULL CHECK (level IN ('full','stats')),
  PRIMARY KEY (user_id, program_id)
);

CREATE TABLE menus (
  id           TEXT PRIMARY KEY,
  program_id   TEXT NOT NULL REFERENCES programs(id),
  name         TEXT NOT NULL,
  is_archived  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (program_id, name)
);

CREATE TABLE screens (
  id           TEXT PRIMARY KEY,
  menu_id      TEXT NOT NULL REFERENCES menus(id),
  name         TEXT NOT NULL,
  is_archived  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (menu_id, name)
);

-- حصر الشاشات الظاهرة لمستخدم (لا صفوف = يرى كل شاشات برنامجه)
CREATE TABLE user_screen_access (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  screen_id  TEXT NOT NULL REFERENCES screens(id),
  PRIMARY KEY (user_id, screen_id)
);

CREATE TABLE releases (
  id          TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id),
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (program_id, name)
);

CREATE TABLE priorities (
  name         TEXT PRIMARY KEY,
  target_days  REAL NOT NULL DEFAULT 0,
  weight       INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE issue_types (
  name        TEXT PRIMARY KEY,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- الحقول الإلزامية عند إضافة ملاحظة (غير الوصف والنوع): pr, dv, du
CREATE TABLE required_fields (field TEXT PRIMARY KEY);

CREATE TABLE issues (
  id                    TEXT PRIMARY KEY,
  program_id            TEXT NOT NULL REFERENCES programs(id),
  screen_id             TEXT NOT NULL REFERENCES screens(id),
  release_id            TEXT REFERENCES releases(id),
  issue_type            TEXT,
  description           TEXT NOT NULL,
  priority              TEXT NOT NULL REFERENCES priorities(name),
  status                TEXT NOT NULL CHECK (status IN ('جديد','مسند','جاري العمل','جاهز لإعادة الاختبار','قيد إعادة الاختبار','مغلق','مؤجل')),
  is_required           BOOLEAN NOT NULL DEFAULT TRUE,
  assignee_id           TEXT REFERENCES users(id),
  original_assignee_id  TEXT REFERENCES users(id),
  keeps_followup        BOOLEAN NOT NULL DEFAULT FALSE,
  due_date              TEXT,
  target_date           TEXT,
  retest_count          INTEGER NOT NULL DEFAULT 0,
  last_test_result      TEXT,
  last_test_at          BIGINT,
  created_by            TEXT REFERENCES users(id),
  created_at            BIGINT NOT NULL,
  repeat_of             TEXT REFERENCES issues(id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE issue_retests (
  id         TEXT PRIMARY KEY,
  issue_id   TEXT NOT NULL REFERENCES issues(id),
  tester_id  TEXT REFERENCES users(id),
  result     TEXT NOT NULL CHECK (result IN ('نجح','فشل')),
  comment    TEXT,
  tested_at  BIGINT NOT NULL
);

CREATE TABLE issue_assignments (
  id             TEXT PRIMARY KEY,
  issue_id       TEXT NOT NULL REFERENCES issues(id),
  from_user_id   TEXT REFERENCES users(id),
  to_user_id     TEXT REFERENCES users(id),
  by_user_id     TEXT REFERENCES users(id),
  reason         TEXT,
  keeps_followup BOOLEAN NOT NULL DEFAULT FALSE,
  is_first       BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_at    BIGINT NOT NULL
);

-- قرار الجاهزية لكل شاشة ولكل إصدار (منفصل عن حالة الاختبار)
CREATE TABLE screen_readiness (
  id                TEXT PRIMARY KEY,
  program_id        TEXT NOT NULL REFERENCES programs(id),
  screen_id         TEXT NOT NULL REFERENCES screens(id),
  release_id        TEXT REFERENCES releases(id),
  decision          TEXT NOT NULL CHECK (decision IN ('جاهزة','باستثناء','ملغاة')),
  reason            TEXT,
  decided_by        TEXT REFERENCES users(id),
  decided_at        BIGINT,
  covered_issue_ids TEXT
);

-- مرحلة الشاشة وموعدها (تعديل يدوي فوق الحساب التلقائي)
CREATE TABLE screen_status (
  id          TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id),
  screen_id   TEXT NOT NULL REFERENCES screens(id),
  release_id  TEXT REFERENCES releases(id),
  stage       TEXT,
  due_date    TEXT,
  set_by      TEXT REFERENCES users(id),
  set_at      BIGINT
);

-- سجل التدقيق: لا يُحدَّث ولا يُحذف
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  at          BIGINT NOT NULL,
  user_id     TEXT REFERENCES users(id),
  program_id  TEXT REFERENCES programs(id),
  issue_id    TEXT REFERENCES issues(id),
  action      TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT
);

CREATE INDEX ix_issues_program   ON issues(program_id, status);
CREATE INDEX ix_issues_screen    ON issues(screen_id);
CREATE INDEX ix_issues_assignee  ON issues(assignee_id, status);
CREATE INDEX ix_retests_issue    ON issue_retests(issue_id);
CREATE INDEX ix_assign_issue     ON issue_assignments(issue_id);
CREATE INDEX ix_audit_issue      ON audit_log(issue_id, at);
CREATE INDEX ix_audit_program    ON audit_log(program_id, at);
CREATE INDEX ix_readiness_screen ON screen_readiness(screen_id, release_id);
