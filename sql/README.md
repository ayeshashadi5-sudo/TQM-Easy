# قاعدة بيانات SQL

`schema.sql` يعرّف الجداول، و`data.sql` يحوي **البيانات الحالية كاملة** (26 مستخدمًا، 12 برنامجًا، 156 ملاحظة، سجل التدقيق، قرارات الجاهزية...).

## الجداول
| الجدول | محتواه |
|---|---|
| `roles`, `users`, `user_permissions` | الأدوار (الأساسية والمخصصة) والمستخدمون وصلاحياتهم الدقيقة |
| `programs`, `user_program_access` | البرامج، وصول كامل أو إحصائيات فقط |
| `menus`, `screens`, `user_screen_access` | القوائم والشاشات (معرّفات ثابتة) وحصر الشاشات الظاهرة لكل مستخدم |
| `releases` | الإصدارات لكل برنامج |
| `issues` | الملاحظات (النوع، الأولوية، الحالة، إلزامية، المسؤول الأصلي والحالي، المواعيد) |
| `issue_retests`, `issue_assignments` | محاولات إعادة الاختبار وسجل الإسناد والتفويض |
| `screen_readiness`, `screen_status` | قرار الجاهزية لكل شاشة وإصدار، ومرحلة الشاشة |
| `priorities`, `issue_types`, `required_fields` | الإعدادات |
| `audit_log` | سجل التدقيق (لا يُحدَّث ولا يُحذف) |

## التشغيل
```bash
# PostgreSQL
createdb tqm && psql tqm -f sql/schema.sql -f sql/data.sql

# SQLite (للتجربة)
sqlite3 tqm.db < sql/schema.sql && sqlite3 tqm.db < sql/data.sql
```
**جُرّب هنا على SQLite فقط** (`node tools/check-sql.js`: كل الجداول تمتلئ و0 مخالفات مفاتيح أجنبية). المخطط يستخدم أنواعًا قياسية تعمل في PostgreSQL، لكني لم أشغله على PostgreSQL فعليًا. لـ MySQL يلزم تغيير `TEXT PRIMARY KEY` إلى `VARCHAR(64)`.

## إعادة توليد `data.sql` من أحدث بيانات
```bash
node tools/export-sql.js                 # يقرأ data/data.json أو seed/current.json
node tools/export-sql.js data/data.json sql/data.sql
```

## ملاحظة مهمة
الخادم الحالي (`server.js`) ما زال يخزن في ملف JSON. ملفات SQL هنا جاهزة لقاعدتك، لكن تحويل الخادم ليقرأ ويكتب في SQL مباشرة خطوة منفصلة تحتاج اختيار المحرك (PostgreSQL أو غيره) ومكان الاستضافة.
**لا ترفعي `sql/data.sql` ولا `seed/current.json` إلى GitHub**: فيهما كلمات السر وبيانات دخول البرامج (مُستثنيان في `.gitignore`).
