// Applies supabase/migrations/*.sql to your Supabase database. Safe to re-run: applied files are skipped.
// Usage: npm run db:setup
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '..');
const migrationsDir = path.resolve(webDir, '../supabase/migrations');

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = { ...readEnvFile(path.join(webDir, '.env')), ...readEnvFile(path.join(webDir, '.env.db')), ...process.env };

const url = env.DATABASE_URL;
if (!url || url.includes('YOUR-PASSWORD') || url.includes('YOURREF')) {
  console.error(`\nDATABASE_URL is not set.\n
1. Supabase dashboard -> Connect -> copy the "Session pooler" connection string.
2. Create web/.env.db (copy web/.env.db.example) and paste it as DATABASE_URL.
3. Run: npm run db:setup\n`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
} catch (e) {
  console.error('\nCould not connect to the database:', e.message);
  if (/ENOTFOUND|ENETUNREACH|EAI_AGAIN/.test(String(e.code || e.message)))
    console.error('Tip: use the "Session pooler" string from Connect (host contains "pooler.supabase.com"), not the direct db.<ref>.supabase.co one.');
  if (/password/i.test(e.message)) console.error('Tip: use your database password; URL-encode special characters (@ -> %40).');
  process.exit(1);
}

try {
  await client.query(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now());
                      alter table public.schema_migrations enable row level security;`);
  const done = new Set((await client.query('select name from public.schema_migrations')).rows.map(r => r.name));
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (done.has(file)) { console.log(`skip   ${file} (already applied)`); continue; }
    process.stdout.write(`apply  ${file} ... `);
    try {
      await client.query('begin');
      await client.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
      await client.query('insert into public.schema_migrations(name) values ($1)', [file]);
      await client.query('commit');
      console.log('ok');
    } catch (e) {
      await client.query('rollback');
      console.log('FAILED');
      console.error(`\n${file}: ${e.message}${e.position ? ` (at character ${e.position})` : ''}`);
      process.exit(1);
    }
  }

  await client.query("notify pgrst, 'reload schema'");
  console.log('Schema cache reloaded.');

  const adminEmail = env.ADMIN_EMAIL;
  if (adminEmail) {
    const u = await client.query('select id from auth.users where lower(email) = lower($1)', [adminEmail]);
    if (!u.rows.length) {
      console.log(`\nAdmin: no Supabase user with email ${adminEmail}. Create it in Authentication -> Users, then run this again.`);
    } else {
      await client.query(
        `insert into public.profiles(id, full_name, role) values ($1, $2, 'super_admin')
         on conflict (id) do update set role = 'super_admin'`,
        [u.rows[0].id, env.ADMIN_NAME || 'Academy Admin']);
      console.log(`Admin: ${adminEmail} is now super_admin.`);
    }
  } else {
    console.log('\nTip: set ADMIN_EMAIL in web/.env.db to make that user the academy admin automatically.');
  }

  const t = await client.query("select table_name from information_schema.tables where table_schema='public' order by 1");
  console.log('\nTables:', t.rows.map(r => r.table_name).join(', '));
  console.log('\nDone. Start the app with: npm run dev');
} finally {
  await client.end();
}
