import { readdir, readFile, access, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../../.agents/notes/', import.meta.url));
export const lifecycles = ['proposed', 'implemented', 'rejected'];

// Resolve Markdown links by path segment. Preserve POSIX, drive and UNC roots;
// clamp `..` at the root and resolve absolute targets independently.
export function resolveTarget(baseDir, target) {
  const parse = value => {
    const normalized = value.replaceAll('\\', '/');
    if (normalized.startsWith('//')) {
      const segments = normalized.slice(2).split('/').filter(Boolean);
      const share = segments.splice(0, 2);
      return { prefix: `//${share.join('/')}/`, stack: segments };
    }
    if (/^[A-Za-z]:\//.test(normalized)) return { prefix: normalized.slice(0, 3), stack: normalized.slice(3).split('/').filter(Boolean) };
    if (normalized.startsWith('/')) return { prefix: '/', stack: normalized.slice(1).split('/').filter(Boolean) };
    return { prefix: '', stack: normalized.split('/').filter(Boolean) };
  };
  const normalizedTarget = target.replaceAll('\\', '/');
  const absolute = normalizedTarget.startsWith('/') || /^[A-Za-z]:\//.test(normalizedTarget);
  const parsed = parse(absolute ? normalizedTarget : baseDir);
  const stack = parsed.stack.slice();
  for (const segment of (absolute ? [] : normalizedTarget.split('/'))) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { if (stack.length) stack.pop(); continue; }
    stack.push(segment);
  }
  return parsed.prefix + stack.join('/');
}

const dateOK = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;

export async function collect() {
  const errors = [], records = [], documents = [];
  let categories = [], recordRoots = [];
  try {
    const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
    if (config.version !== 1 || !Array.isArray(config.categories)) throw Error('expected version 1 and categories array');
    if (Object.hasOwn(config, 'recordFormat')) throw Error('recordFormat is no longer supported; all records use the README format');
    const ids = new Set();
    for (const category of config.categories) {
      if (!category || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category.id ?? '') || ![category.name, category.scope].every(value => typeof value === 'string' && value.trim() && !/[\r\n]/.test(value)) || ids.has(category.id)) throw Error('categories require unique slug ids, names and scopes');
      ids.add(category.id);
    }
    categories = config.categories;
    if (config.recordRoots !== undefined) {
      if (!Array.isArray(config.recordRoots)) throw Error('recordRoots must be an array');
      const paths = new Set(), contexts = new Set();
      for (const owner of config.recordRoots) {
        if (!owner || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(owner.path ?? '') || [...lifecycles, 'templates'].includes(owner.path) || paths.has(owner.path)) throw Error('recordRoots require unique top-level directory slugs');
        if (typeof owner.name !== 'string' || !owner.name.trim() || /[\r\n]/.test(owner.name)) throw Error('recordRoots require names');
        if (owner.context !== null && (typeof owner.context !== 'string' || !owner.context.trim() || /[\r\n]/.test(owner.context))) throw Error('recordRoots require a context identifier or null for shared');
        if (contexts.has(owner.context)) throw Error('each context or shared scope must have one record root');
        const stat = await lstat(path.join(root, owner.path)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw Error('recordRoots must be real directories within Notes, not links or files');
        paths.add(owner.path);
        contexts.add(owner.context);
      }
      if (config.recordRoots.some(owner => owner.context !== null)) {
        if (typeof config.contextMap !== 'string' || !config.contextMap.trim()) throw Error('contextMap required for context record roots');
        await access(resolveTarget(path.dirname(path.dirname(root)), config.contextMap));
      }
      recordRoots = config.recordRoots;
    }
  } catch (error) { errors.push(`config.json: ${error.message}`); }

  const categoryIds = categories.map(category => category.id);
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full).replaceAll('\\', '/');
      const parts = relative.split('/');
      if (entry.isSymbolicLink()) { errors.push(`${relative}: symbolic links are not supported in Notes`); continue; }
      if (entry.isDirectory()) {
        if (entry.name === 'templates' && (await readdir(full)).length === 0) continue;
        const scoped = recordRoots.some(owner => owner.path === parts[0]);
        const local = scoped ? parts.slice(1) : parts;
        if (local.length === 1 && !lifecycles.includes(entry.name)) errors.push(`${relative}: unknown lifecycle directory`);
        if (local.length === 2 && !categoryIds.includes(entry.name)) errors.push(`${relative}: unknown project category`);
        if (local.length > 2) errors.push(`${relative}: nested record directory not supported`);
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) documents.push(full);
    }
  }
  await walk(root);

  for (const full of documents.sort()) {
    const relative = path.relative(root, full).replaceAll('\\', '/');
    const owner = recordRoots.find(candidate => relative.startsWith(candidate.path + '/'));
    const localRelative = owner ? relative.slice(owner.path.length + 1) : relative;
    if (localRelative === 'INDEX.md') { errors.push(`${relative}: generated indexes are no longer used`); continue; }
    const text = await readFile(full, 'utf8');
    const parts = localRelative.split('/');
    if (relative !== 'README.md' && relative !== 'AGENTS.md') {
      const filename = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.exec(parts[2] ?? '');
      if (parts.length !== 3 || !lifecycles.includes(parts[0]) || !categoryIds.includes(parts[1]) || !filename) { errors.push(`${relative}: invalid lifecycle, category or filename`); continue; }
      const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
      const metadata = {};
      if (!header) errors.push(`${relative}: missing metadata`);
      for (const line of (header?.[1] ?? '').split(/\r?\n/)) {
        const field = /^([a-z]+): (.+)$/.exec(line);
        if (!field || Object.hasOwn(metadata, field[1])) { errors.push(`${relative}: invalid or duplicate metadata field`); continue; }
        metadata[field[1]] = field[2].trim();
      }
      if (!metadata.title) errors.push(`${relative}: title required`);
      if (metadata.status !== parts[0]) errors.push(`${relative}: status must match lifecycle directory`);
      for (const key of ['created', 'updated']) if (!dateOK(metadata[key])) errors.push(`${relative}: invalid ${key}`);
      if (metadata.created !== filename[1]) errors.push(`${relative}: filename date differs from created`);
      if (metadata.updated < metadata.created) errors.push(`${relative}: updated precedes created`);
      if (!metadata.approval) errors.push(`${relative}: approval evidence or pending statement required`);
      if (metadata.status === 'implemented' && !metadata.verification) errors.push(`${relative}: verification reference or explanation required`);
      if (metadata.status === 'rejected' && !metadata.reason) errors.push(`${relative}: rejection reason required`);
      if (!/^# .+/m.test(text.slice(header?.[0].length ?? 0))) errors.push(`${relative}: document title required`);

      const keys = ['title', 'status', 'created', 'updated', 'approval', 'verification', 'reason'];
      const actual = (header?.[1] ?? '').split(/\r?\n/).map(line => /^([a-z]+): /.exec(line)?.[1]).filter(Boolean);
      const allowed = keys.filter(key => Object.hasOwn(metadata, key));
      const expected = keys.slice(0, 5).concat(metadata.status === 'implemented' ? ['verification'] : metadata.status === 'rejected' ? ['reason'] : []);
      if (actual.join(',') !== expected.join(',')) errors.push(`${relative}: metadata fields must use the documented keys and order`);
      if (actual.some(key => !keys.includes(key))) errors.push(`${relative}: unknown metadata field`);
      if (metadata.status !== 'implemented' && metadata.verification) errors.push(`${relative}: verification belongs to implemented records`);
      if (metadata.status !== 'rejected' && metadata.reason) errors.push(`${relative}: reason belongs to rejected records`);
      if (allowed.length !== expected.length) errors.push(`${relative}: metadata fields do not match the record lifecycle`);
      const prose = text.slice(header?.[0].length ?? 0).replace(/```[\s\S]*?```/g, '');
      const lines = prose.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (lines[0] !== `# Agent Note：${metadata.title}`) errors.push(`${relative}: title must match metadata`);
      const sections = lines.filter(line => line.startsWith('## '));
      if (sections[0] !== '## 问题') errors.push(`${relative}: first section must be ## 问题`);
      const required = metadata.status === 'proposed' ? ['提案', '备选方案', '验收条件', '风险'] : metadata.status === 'implemented' ? ['决定', '备选方案', '后果', '验证'] : ['备选方案'];
      for (const heading of required.filter(value => value !== '备选方案')) if (!sections.includes(`## ${heading}`)) errors.push(`${relative}: missing section ## ${heading}`);
      if (!sections.includes('## 备选方案')) {
        const exception = '<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->';
        if (!prose.includes(exception) || metadata.created >= '2026-09-22') errors.push(`${relative}: missing section ## 备选方案 or valid pre-format exception`);
      }
      if (metadata.status === 'implemented' && sections.some(section => ['## 提案', '## 计划', '## 迁移计划', '## 验收条件'].includes(section))) errors.push(`${relative}: implemented record contains proposal section`);
      records.push({ ...metadata, category: parts[1], relative, recordRoot: owner?.path ?? '' });
    }

    const body = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '');
    for (const match of body.matchAll(/\[[^\]]*\]\((<[^>]+>|[^\s)]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '').split('#')[0];
      if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
      try { await access(resolveTarget(path.dirname(full), decodeURIComponent(target))); }
      catch { errors.push(`${relative}: broken local link ${target}`); }
    }
  }
  const names = new Set();
  for (const record of records) {
    const name = path.basename(record.relative);
    if (names.has(name)) errors.push(`${record.relative}: duplicate record filename`);
    names.add(name);
  }
  return { records, categories, recordRoots, errors };
}

// Read-only navigation; directories remain the source of the listing.
export function directoryNavigation(records, recordRoots, selection = {}) {
  const owners = recordRoots.filter(owner => selection.kind === undefined || (selection.kind === 'context' && owner.context === selection.id) || (selection.kind === 'shared' && owner.context === null));
  const lines = [];
  for (const owner of owners) {
    const rows = records.filter(record => record.recordRoot === owner.path);
    const notesPath = path.relative(process.cwd(), root).replaceAll('\\', '/') || '.';
    const label = owner.context === null ? 'shared' : `context:${owner.context}`;
    lines.push(`${owner.name} [${label}]: ${notesPath}/${owner.path}/ (${rows.length})`);
    for (const lifecycle of lifecycles) {
      for (const category of [...new Set(rows.filter(record => record.status === lifecycle).map(record => record.category))].sort()) lines.push(`  ${owner.path}/${lifecycle}/${category}/`);
    }
  }
  if (selection.kind === undefined || selection.kind === 'legacy') {
    const rows = records.filter(record => !record.recordRoot);
    if (rows.length || !recordRoots.length) {
      const notesPath = path.relative(process.cwd(), root).replaceAll('\\', '/') || '.';
      lines.push(`legacy: ${notesPath}/ (${rows.length})`);
      for (const lifecycle of lifecycles) {
        for (const category of [...new Set(rows.filter(record => record.status === lifecycle).map(record => record.category))].sort()) lines.push(`  ${lifecycle}/${category}/`);
      }
    }
  }
  return lines;
}
