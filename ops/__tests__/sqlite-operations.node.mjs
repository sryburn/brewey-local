import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat, copyFile, readFile, mkdir, cp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { backupDatabase } from '../backup-sqlite.mjs'
const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
async function sandbox(fn) {
  const folder = await mkdtemp(join(tmpdir(), 'brewey-ops-test-'))
  try { await fn(folder) } finally { await rm(folder, { recursive: true, force: true }) }
}
test('shipped backup CLI works with the container source layout', async () => sandbox(async folder => {
  const app = join(folder, 'app'), source = join(folder, 'source.sqlite'), output = join(folder, 'backup.sqlite')
  await mkdir(join(app, 'ops'), { recursive: true })
  await cp(resolve(projectRoot, 'frontend/src/lib'), join(app, 'src/lib'), { recursive: true })
  await cp(resolve(projectRoot, 'frontend/src/types'), join(app, 'src/types'), { recursive: true })
  await copyFile(resolve(projectRoot, 'frontend/scripts/backup-sqlite.mjs'), join(app, 'ops/backup-sqlite.mjs'))
  await symlink(resolve(projectRoot, 'frontend/node_modules'), join(app, 'node_modules'), 'dir')
  const db = new DatabaseSync(source)
  db.exec("CREATE TABLE recipes(id TEXT PRIMARY KEY); INSERT INTO recipes VALUES('synthetic');")
  db.close()
  const child = spawnSync(process.execPath, [join(app, 'ops/backup-sqlite.mjs'), '--database', source, '--output', output], { encoding: 'utf8' })
  assert.ifError(child.error)
  assert.equal(child.status, 0, child.stderr)
  assert.equal(JSON.parse(child.stdout).restore_verified, true)
  const restored = new DatabaseSync(output, { readOnly: true })
  assert.equal(restored.prepare('SELECT id FROM recipes').get().id, 'synthetic'); restored.close()
}))
test('online backup includes uncheckpointed WAL commits and independently opens a self-contained restore', async () => sandbox(async folder => {
  const source = join(folder, 'live.sqlite'), target = join(folder, 'backups', 'snapshot.sqlite'), plain = join(folder, 'plain-copy.sqlite')
  const live = new DatabaseSync(source)
  try {
    live.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE recipes(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id)); PRAGMA user_version=1; PRAGMA wal_checkpoint(TRUNCATE);')
    live.exec("INSERT INTO users VALUES('synthetic-user'); INSERT INTO recipes VALUES('synthetic-recipe','synthetic-user');")
    assert.ok((await stat(source + '-wal')).size > 0)
    await copyFile(source, plain)
    const naive = new DatabaseSync(plain, { readOnly: true })
    assert.equal(naive.prepare('SELECT count(*) AS n FROM recipes').get().n, 0); naive.close()
    const result = await backupDatabase(source, target)
    assert.equal(result.restore_verified, true); assert.equal(result.counts.users, 1); assert.equal(result.counts.recipes, 1)
    assert.equal((await stat(target)).mode & 0o777, 0o600); assert.equal((await stat(join(folder, 'backups'))).mode & 0o777, 0o700)
    await assert.rejects(stat(target + '-wal'))
    const restored = new DatabaseSync(target, { readOnly: true })
    assert.equal(restored.prepare('SELECT id FROM recipes').get().id, 'synthetic-recipe'); restored.close()
    const before = await readFile(target)
    await assert.rejects(backupDatabase(source, target))
    assert.deepEqual(await readFile(target), before)
    assert.equal(live.prepare('SELECT count(*) AS n FROM recipes').get().n, 1)
  } finally { live.close() }
}))
test('backup rejects invalid foreign-key relationships without publishing', async () => sandbox(async folder => {
  const source = join(folder, 'broken.sqlite'), target = join(folder, 'backup.sqlite'), db = new DatabaseSync(source)
  db.exec("PRAGMA foreign_keys=OFF; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE recipes(user_id TEXT REFERENCES users(id)); INSERT INTO recipes VALUES('missing');")
  db.close()
  await assert.rejects(backupDatabase(source, target)); await assert.rejects(stat(target))
}))
