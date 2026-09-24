#!/usr/bin/env node
/**
 * next-parallel.mjs - ktore story z docs/BACKLOG.csv mozna robic ROWNOLEGLE teraz.
 *
 * Story jest "gotowe", gdy ma Status = To Do, a wszystkie jego `Depends On` sa Done.
 * Gotowe story z definicji nie blokuja sie nawzajem (zadne nie czeka na inne
 * niedokonczone). Skrypt bierze je w kolejnosci z pliku (to jest kolejnosc
 * budowy wg PROJECT_MANAGER.md) i sklada z nich paczke dla N agentow.
 *
 * Dodatkowa regula: najwyzej JEDNO story z migracja DB na paczke (lacznie ze
 * story In Progress). Dwie migracje wygenerowane rownolegle dostaja ten sam
 * numer (000N_*.sql) i koliduja w db/migrations/meta/_journal.json.
 * Wykrywanie jest heurystyczne (Area=BE, Type!=Test, slowo migration/table
 * w tytule/opisie albo definicja tabeli typu `nazwa(kol UNIQUE, ...)`).
 * Heurystyke uzupelniasz flaga --mark-migration, wylaczasz regule --allow-migrations.
 *
 * Uzycie (z katalogu repo):
 *   node scripts/next-parallel.mjs                 # paczka dla 2 agentow
 *   node scripts/next-parallel.mjs --agents 3
 *   node scripts/next-parallel.mjs --plan          # cala sekwencja rund do konca backlogu
 *   node scripts/next-parallel.mjs --json          # wynik maszynowy (np. dla agenta PM)
 *   node scripts/next-parallel.mjs --allow-migrations
 *   node scripts/next-parallel.mjs --mark-migration 5.1,6.1   # recznie oznacz story z migracja
 *   node scripts/next-parallel.mjs --csv sciezka/do/BACKLOG.csv
 *
 * Brak zaleznosci - tylko Node 22.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- Argumenty ------------------------------------------------------------------

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = {
    agents: 2,
    plan: false,
    json: false,
    allowMigrations: false,
    markMigration: [],
    csv: resolve(repoRoot, 'docs', 'BACKLOG.csv'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--agents' || a === '-n') opts.agents = Number(argv[++i]);
    else if (a === '--plan') opts.plan = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--allow-migrations') opts.allowMigrations = true;
    else if (a === '--csv') opts.csv = resolve(argv[++i]);
    else if (a === '--mark-migration') opts.markMigration = String(argv[++i] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    } else fail(`Nieznany argument: ${a} (zobacz --help)`);
  }
  if (!Number.isInteger(opts.agents) || opts.agents < 1) fail('--agents musi byc liczba calkowita >= 1');
  return opts;
}

function fail(msg) {
  console.error(`BLAD: ${msg}`);
  process.exit(1);
}

// --- CSV (RFC 4180: cudzyslowy, przecinki i nowe linie w polach) -----------------

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const [header, ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// --- Model backlogu --------------------------------------------------------------

// "migration"/"table" albo definicja tabeli w stylu `nazwa_tabeli(kolumna ... pk|UNIQUE|FK`.
const MIGRATION_RE = /\bmigrations?\b|\btables?\b|\b[a-z]+_[a-z_]+\s*\([a-z_]+[^)]*\b(pk|UNIQUE|FK)\b/i;

function loadBacklog(file, markMigration = []) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { fail(`Nie moge odczytac ${file}`); }
  const rows = parseCsv(text);
  const required = ['ID', 'Title', 'Depends On', 'Status'];
  for (const col of required) if (!(col in (rows[0] ?? {}))) fail(`Brak kolumny "${col}" w ${file}`);

  const stories = rows.map((r, order) => ({
    id: r['ID'],
    title: r['Title'],
    epic: r['Epic'] ?? '',
    type: r['Type'] ?? '',
    area: r['Area'] ?? '',
    priority: r['Priority'] ?? '',
    estimate: r['Estimate'] ?? '',
    status: r['Status'],
    deps: r['Depends On']
      .split(/[,;]/)
      .map((d) => d.trim())
      .filter((d) => d && !/^[—–-]+$/.test(d)),
    migration: markMigration.includes(r['ID']) || r['Area'] === 'BE' && r['Type'] !== 'Test' && MIGRATION_RE.test(`${r['Title']} ${r['Description'] ?? ''}`),
    order,
  }));

  const byId = new Map(stories.map((s) => [s.id, s]));
  const warnings = [];
  for (const s of stories) {
    for (const d of s.deps) if (!byId.has(d)) warnings.push(`${s.id} zalezy od nieistniejacego ${d}`);
    if (!['To Do', 'In Progress', 'Done', 'Blocked'].includes(s.status)) warnings.push(`${s.id} ma nieznany status "${s.status}"`);
  }
  detectCycles(stories, byId);
  return { stories, byId, warnings };
}

function detectCycles(stories, byId) {
  const state = new Map(); // 1 = w trakcie, 2 = gotowe
  const visit = (s, path) => {
    if (state.get(s.id) === 2) return;
    if (state.get(s.id) === 1) fail(`Cykl zaleznosci: ${[...path, s.id].join(' -> ')}`);
    state.set(s.id, 1);
    for (const d of s.deps) if (byId.has(d)) visit(byId.get(d), [...path, s.id]);
    state.set(s.id, 2);
  };
  for (const s of stories) visit(s, []);
}

/** Ile niezrobionych story (posrednio lub bezposrednio) czeka na dane story. */
function downstreamCount(id, stories) {
  const seen = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const s of stories) {
      if (s.status !== 'Done' && !seen.has(s.id) && s.deps.includes(cur)) {
        seen.add(s.id);
        stack.push(s.id);
      }
    }
  }
  return seen.size;
}

// --- Wybor paczki ----------------------------------------------------------------

function isReady(s, done) {
  return s.status === 'To Do' && s.deps.every((d) => done.has(d));
}

/**
 * Sklada paczke do `slots` story. `busyMigration` = czy migracja jest juz w toku
 * (np. story In Progress). Zwraca { batch, deferred }.
 */
function pickBatch(ready, slots, busyMigration, allowMigrations) {
  const batch = [];
  const deferred = [];
  let migrationTaken = busyMigration;
  for (const s of ready) {
    if (batch.length >= slots) { deferred.push({ story: s, reason: 'brak wolnego agenta' }); continue; }
    if (s.migration && migrationTaken && !allowMigrations) {
      deferred.push({ story: s, reason: 'druga migracja DB w tej rundzie' });
      continue;
    }
    if (s.migration) migrationTaken = true;
    batch.push(s);
  }
  return { batch, deferred };
}

function snapshot(backlog, opts) {
  const { stories } = backlog;
  const done = new Set(stories.filter((s) => s.status === 'Done').map((s) => s.id));
  const inProgress = stories.filter((s) => s.status === 'In Progress');
  const blocked = stories.filter((s) => s.status === 'Blocked');
  const ready = stories.filter((s) => isReady(s, done));
  const slots = Math.max(0, opts.agents - inProgress.length);
  const { batch, deferred } = pickBatch(ready, slots, inProgress.some((s) => s.migration), opts.allowMigrations);

  // Co odblokuje sie po zamknieciu tej paczki (i story In Progress).
  const doneAfter = new Set([...done, ...batch.map((s) => s.id), ...inProgress.map((s) => s.id)]);
  const unlocked = stories.filter((s) => s.status === 'To Do' && !done.has(s.id) && !ready.includes(s) && isReady(s, doneAfter));

  return { done, inProgress, blocked, ready, slots, batch, deferred, unlocked };
}

/** Symulacja rund: kazda runda = paczka dla N agentow, po rundzie wszystko w niej jest Done. */
function fullPlan(backlog, opts) {
  const { stories } = backlog;
  const done = new Set(stories.filter((s) => s.status === 'Done').map((s) => s.id));
  // Story In Progress traktujemy jako zajete w rundzie 1.
  let carry = stories.filter((s) => s.status === 'In Progress');
  const remaining = new Set(stories.filter((s) => s.status === 'To Do').map((s) => s.id));
  const rounds = [];
  while (remaining.size || carry.length) {
    const ready = stories.filter((s) => remaining.has(s.id) && s.deps.every((d) => done.has(d)));
    const slots = Math.max(0, opts.agents - carry.length);
    const { batch } = pickBatch(ready, slots, carry.some((s) => s.migration), opts.allowMigrations);
    if (!batch.length && !carry.length) {
      rounds.push({ stuck: [...remaining] });
      break;
    }
    rounds.push({ inProgress: carry, batch });
    for (const s of [...carry, ...batch]) { done.add(s.id); remaining.delete(s.id); }
    carry = [];
  }
  return rounds;
}

// --- Branche git i polecenie worktree ----------------------------------------------

function localBranches() {
  try {
    return execFileSync('git', ['-C', repoRoot, 'branch', '--list', '--format=%(refname:short)'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function slugify(title) {
  return title
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-').slice(0, 5).join('-');
}

function worktreeHint(s, branches) {
  const esc = s.id.replace(/\./g, '\\.');
  const re = new RegExp(`^(feat|fix|chore|refactor|test|docs)/${esc}-([a-z0-9-]+)$`);
  for (const b of branches) {
    const m = b.match(re);
    if (m) return { branch: b, cmd: `.\\scripts\\worktree.ps1 new -Story ${s.id} -Name ${m[2]} -Type ${m[1]}` };
  }
  const type = s.type === 'Infra' ? 'chore' : s.type === 'Test' ? 'test' : 'feat';
  const typeArg = type === 'feat' ? '' : ` -Type ${type}`;
  return { branch: null, cmd: `.\\scripts\\worktree.ps1 new -Story ${s.id} -Name ${slugify(s.title)}${typeArg}` };
}

// --- Wyjscie ---------------------------------------------------------------------

const line = (s) => `${s.id.padEnd(5)} ${s.title.slice(0, 52).padEnd(52)} ${s.area.padEnd(4)} ${s.priority.padEnd(3)} ${s.estimate.padStart(4)}`;
const flags = (s, stories) => {
  const f = [`odblokowuje ${downstreamCount(s.id, stories)}`];
  if (s.migration) f.push('MIGRACJA DB');
  return `[${f.join(', ')}]`;
};

function printSnapshot(backlog, snap, opts) {
  const { stories } = backlog;
  const branches = localBranches();
  const todo = stories.filter((s) => s.status !== 'Done').length;
  console.log(`Backlog: ${stories.length} story, ${snap.done.size} Done, ${todo} do zrobienia. Agenci: ${opts.agents}.\n`);

  if (snap.inProgress.length) {
    console.log('W toku (zajmuja agentow):');
    for (const s of snap.inProgress) console.log(`  ${line(s)} ${s.migration ? '[MIGRACJA DB]' : ''}`);
    console.log('');
  }

  if (!snap.batch.length) {
    console.log(snap.slots === 0 ? 'Wszyscy agenci sa zajeci story In Progress.' : 'Brak story gotowych do startu.');
  } else {
    console.log('Do zrobienia ROWNOLEGLE teraz:');
    for (const s of snap.batch) {
      const hint = worktreeHint(s, branches);
      console.log(`  ${line(s)} ${flags(s, stories)}`);
      if (hint.branch) console.log(`        branch juz istnieje: ${hint.branch}`);
      console.log(`        ${hint.cmd}`);
    }
  }

  if (snap.deferred.length) {
    console.log('\nTez gotowe, ale odlozone:');
    for (const { story, reason } of snap.deferred) console.log(`  ${line(story)} - ${reason}`);
  }

  if (snap.unlocked.length) {
    console.log('\nOdblokuja sie po zamknieciu powyzszej paczki:');
    for (const s of snap.unlocked) console.log(`  ${line(s)}`);
  }

  if (snap.blocked.length) {
    console.log('\nStatus Blocked (pominiete):');
    for (const s of snap.blocked) console.log(`  ${line(s)}`);
  }
}

function printPlan(backlog, rounds, opts) {
  console.log(`Plan rund dla ${opts.agents} agentow (kazda runda = story robione jednoczesnie):\n`);
  rounds.forEach((r, i) => {
    if (r.stuck) {
      console.log(`Runda ${i + 1}: NIE DA SIE KONTYNUOWAC - story czekaja na Blocked/nieistniejace zaleznosci: ${r.stuck.join(', ')}`);
      return;
    }
    const hours = r.batch.reduce((sum, s) => sum + (parseFloat(s.estimate) || 0), 0);
    console.log(`Runda ${i + 1}${hours ? `  (~${hours}h pracy)` : ''}`);
    for (const s of r.inProgress) console.log(`  ${line(s)}  (w toku)`);
    for (const s of r.batch) console.log(`  ${line(s)}${s.migration ? '  [MIGRACJA DB]' : ''}`);
  });
}

function toJson(s, stories) {
  const { order, ...rest } = s;
  return { ...rest, unlocks: downstreamCount(s.id, stories) };
}

// --- main ------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));
const backlog = loadBacklog(opts.csv, opts.markMigration);

if (opts.json) {
  const snap = snapshot(backlog, opts);
  const out = {
    agents: opts.agents,
    inProgress: snap.inProgress.map((s) => toJson(s, backlog.stories)),
    batch: snap.batch.map((s) => ({ ...toJson(s, backlog.stories), worktree: worktreeHint(s, localBranches()) })),
    deferred: snap.deferred.map(({ story, reason }) => ({ ...toJson(story, backlog.stories), reason })),
    unlockedNext: snap.unlocked.map((s) => s.id),
    warnings: backlog.warnings,
  };
  if (opts.plan) out.plan = fullPlan(backlog, opts).map((r) => (r.stuck ? { stuck: r.stuck } : { inProgress: r.inProgress.map((s) => s.id), batch: r.batch.map((s) => s.id) }));
  console.log(JSON.stringify(out, null, 2));
} else {
  if (backlog.warnings.length) {
    console.log('Ostrzezenia backlogu:');
    for (const w of backlog.warnings) console.log(`  - ${w}`);
    console.log('');
  }
  if (opts.plan) printPlan(backlog, fullPlan(backlog, opts), opts);
  else printSnapshot(backlog, snapshot(backlog, opts), opts);
}
