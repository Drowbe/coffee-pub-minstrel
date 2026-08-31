#!/usr/bin/env node
/*
 * wiki-sync.mjs — mirror the publish set of documentation/ into flat GitHub-wiki pages.
 *
 * PORTED FROM BLACKSMITH, and deliberately kept near-identical to
 * coffee-pub-blacksmith/tools/wiki-sync.mjs. That file was written to be copied; the only lines a
 * satellite is meant to change are WIKI_URL, THIS_MODULE, PUBLISH, HOME_SRC, label() and the
 * sidebar groups. Keeping everything else byte-similar means a fix made in either copy stays
 * legible in the other -- resist "tidying" the parts that look unused here.
 *
 * The wiki is a pure mirror: each published doc becomes a top-level page named by its basename
 * (architecture-cues.md -> page "architecture-cues"), so there are no colons and no subdirectories. Inter-doc links
 * are rewritten from repo paths (../architecture/foo.md) to wiki page names (foo); links to code files, or
 * to docs not in the publish set, are downgraded to plain text so the wiki has no broken red links.
 *
 * Source docs are never modified. The publish/downgrade decision is made fresh each run from the
 * PUBLISH list below, so adding a held doc to that list later auto-links every reference to it —
 * no source edits needed.
 *
 * Usage:
 *   node tools/wiki-sync.mjs build              # write reviewable pages to tools/.wiki-build/
 *   node tools/wiki-sync.mjs publish            # build, clone the wiki, mirror, commit (NO push)
 *   node tools/wiki-sync.mjs publish <path>     # same, but use an existing wiki clone at <path>
 *
 * After publish: review the staged commit, then push it yourself:
 *   git -C <wiki-path> push
 *
 * Env: WIKI_URL overrides the wiki git URL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'documentation');
const OUT = path.join(ROOT, 'tools', '.wiki-build');
const WIKI_URL = process.env.WIKI_URL || 'https://github.com/Drowbe/coffee-pub-minstrel.wiki.git';

// ---- Publish set. Add held docs here as they are finished and verified clean. ----
const PUBLISH = [
  // Architecture
  'architecture/architecture-minstrel.md',
  'architecture/architecture-window.md',
  'architecture/architecture-dashboard.md',
  'architecture/architecture-playlists.md',
  'architecture/architecture-soundscenes.md',
  'architecture/architecture-cues.md',
  'architecture/architecture-automation.md',
  'architecture/architecture-storage.md',
];

// Held out of the publish set (documented so intent is explicit; move into PUBLISH when ready):
//   Home:        user-guide.md IS the Home page (see HOME_SRC) rather than a separate entry.
//   Internal:    todo.md, plans/* -- working notes, not consumer docs.
//   Scaffolding: guides/SETUP_PROMPT.md, guides/getting-started.md came from the Coffee Pub
//                starter template and describe how to BUILD a new module, not how Minstrel works.
//                Publishing them would strand anyone reaching them from the wiki sidebar.
//   Internal:    guides/best-practices.md, guides/blacksmith-apis.md -- house coding notes and a
//                link list. Useful in-repo, not worth a wiki page.

const HOME_SRC = 'user-guide.md';

const pageName = (p) => path.basename(p, '.md');
const publishedPages = new Set([...PUBLISH.map(pageName), 'Home']);

// Clean sidebar label: strip the architecture- prefix, kebab -> Sentence case.
function label(rel) {
  if (rel === 'architecture/architecture-minstrel.md') return 'Minstrel overall';
  if (rel === 'architecture/architecture-soundscenes.md') return 'Sound scenes';
  if (rel === 'architecture/architecture-window.md') return 'Window and rendering';
  const base = pageName(rel).replace(/^(api|architecture|design|guide)-/, '');
  const spaced = base.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ---- Fence-aware link rewriting ----
// ---- Cross-module links: ONE PREDICATE ENFORCES ALL THREE DIRECTIONS ----
//
// Suite rule (Blacksmith TODO-GLOBAL Ground Rule 2), stated as directions:
//   satellite -> Blacksmith   ALLOWED. Blacksmith is a required dependency of every satellite, so the
//                             coupling already exists and is mandatory; the link only makes it legible.
//   Blacksmith -> satellite   REFUSED. Couples the hub to something optional that may not be installed.
//   satellite -> satellite    REFUSED. Two optional things, neither guaranteed present.
//
// The rule used to live only in prose, and prose is why it was misapplied at least once. The predicate
// below is the whole of it: rewrite only when the TARGET is the hub and WE are not the hub.
//
// MINSTREL IS A SATELLITE, so THIS_MODULE !== HUB and the first direction is LIVE here: a link to
// coffee-pub-blacksmith/documentation/**.md becomes a link into the Blacksmith wiki. The other two
// directions stay refused by the same predicate. The THIS_MODULE check looks dead in this copy --
// it is not; it is exactly what lets this file stay identical to the hub's.
//
// FRAGILITY WORTH KNOWING: an inbound link targets a page NAME from the hub PUBLISH list. A doc that
// leaves PUBLISH, or is renamed, silently 404s every inbound link in the suite. PUBLISH is therefore a
// contract with the satellites, not just a local choice.
const HUB = 'coffee-pub-blacksmith';
const THIS_MODULE = 'coffee-pub-minstrel';
const HUB_WIKI = 'https://github.com/Drowbe/coffee-pub-blacksmith/wiki';
const SIBLING_DOC = /coffee-pub-([a-z]+)[\\/]documentation[\\/](?:[^)]*[\\/])?([^/\\)]+)\.md(#.+)?$/i;

function siblingWikiUrl(target) {
  const m = target.match(SIBLING_DOC);
  if (!m) return null;
  const targetModule = `coffee-pub-${m[1].toLowerCase()}`;
  if (targetModule !== HUB) return null;      // -> satellite: refused, whoever is asking
  if (THIS_MODULE === HUB) return null;       // hub -> anywhere: refused
  return `${HUB_WIKI}/${m[2]}${m[3] || ''}`;
}

const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const CODE_LINK = /\.(js|mjs|css|hbs|json|txt|webp|png)(#.*)?$/i;
const CODE_PATH = /(scripts|styles|templates|resources)\//;

function rewriteLinks(md, srcRel) {
  const lines = md.split(/\r?\n/);
  let inFence = false;
  const downgraded = [];
  const rewritten = lines.map((line) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;
    return line.replace(LINK, (whole, text, target) => {
      if (/^(https?:|mailto:|#)/i.test(target)) return whole;        // external / same-page anchor
      // Checked BEFORE the code/asset downgrade: a cross-module doc path contains `documentation/`,
      // which is not a code path, but the ordering is stated rather than assumed because a future
      // CODE_PATH entry could otherwise swallow these silently.
      const hub = siblingWikiUrl(target);
      if (hub) return `[${text}](${hub})`;
      if (CODE_LINK.test(target) || CODE_PATH.test(target)) {         // code / asset -> plain text
        downgraded.push(`${srcRel}: code -> text  (${target})`);
        return text;
      }
      const m = target.match(/([^/]+)\.md(#.+)?$/i);                 // .md doc link
      if (m) {
        const name = m[1];
        const anchor = m[2] || '';
        // If the visible text is just a bare filename, drop its .md too.
        const clean = /^[\w-]+\.md$/.test(text) ? text.replace(/\.md$/, '') : text;
        if (publishedPages.has(name)) return `[${clean}](${name}${anchor})`;
        downgraded.push(`${srcRel}: unpublished -> text  (${target})`);
        return clean;
      }
      return whole;
    });
  });
  return { md: rewritten.join('\n'), downgraded };
}

function readRewriteWrite(rel, outName) {
  const md = fs.readFileSync(path.join(DOCS, rel), 'utf8');
  const { md: out, downgraded } = rewriteLinks(md, rel);
  fs.writeFileSync(path.join(OUT, outName), out);
  return downgraded;
}

function buildSidebar() {
  const group = (prefix) =>
    PUBLISH.filter((p) => p.startsWith(prefix))
      .map((rel) => `- [${label(rel)}](${pageName(rel)})`)
      .join('\n');
  // Top-level docs (no api/ or architecture/ prefix) go under Reference.
  const topLevel = PUBLISH.filter((p) => !p.includes('/'))
    .map((rel) => `- [${label(rel)}](${pageName(rel)})`)
    .join('\n');
  return [
    '### Getting started',
    '- [Home](Home)',
    ...(topLevel ? [topLevel] : []),
    '',
    '### Architecture',
    group('architecture/'),
    '',
    '### Elsewhere',
    '- [Blacksmith wiki](https://github.com/Drowbe/coffee-pub-blacksmith/wiki)',
    '',
  ].join('\n');
}

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const downgrades = [];
  for (const rel of PUBLISH) downgrades.push(...readRewriteWrite(rel, `${pageName(rel)}.md`));
  downgrades.push(...readRewriteWrite(HOME_SRC, 'Home.md'));
  fs.writeFileSync(path.join(OUT, '_Sidebar.md'), buildSidebar());

  console.log(`Built ${PUBLISH.length} pages + Home + _Sidebar into ${path.relative(ROOT, OUT)}/`);
  const unique = [...new Set(downgrades)].sort();
  if (unique.length) {
    console.log(`\n${unique.length} link(s) downgraded to plain text (target not published):`);
    for (const d of unique) console.log('  ' + d);
    console.log('These auto-become links again once their target is added to PUBLISH.');
  }
}

function publish(wikiPathArg) {
  build();

  let wiki = wikiPathArg;
  if (!wiki) {
    wiki = path.join(ROOT, 'tools', '.wiki-repo');
    if (fs.existsSync(path.join(wiki, '.git'))) {
      // REUSE THE CLONE, NEVER DELETE IT. `fs.rmSync` cannot remove a git object store on Windows --
      // its contents are read-only and `force: true` does not clear the attribute, so publish died
      // with EPERM. Fetch-and-reset reaches the same clean slate, and faster. The GitHub Action runs
      // on Linux and never hit this; it bit a sibling porting the script -- this repo IS that case,
      // developed on Windows, so this branch is the normal path here rather than the edge.
      console.log(`\nReusing wiki clone: ${wiki}`);
      execFileSync('git', ['-C', wiki, 'fetch', 'origin'], { stdio: 'inherit' });
      const head = execFileSync('git', ['-C', wiki, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
      execFileSync('git', ['-C', wiki, 'reset', '--hard', `origin/${head}`], { stdio: 'inherit' });
      execFileSync('git', ['-C', wiki, 'clean', '-fd'], { stdio: 'inherit' });
    } else {
      fs.rmSync(wiki, { recursive: true, force: true });
      console.log(`\nCloning wiki: ${WIKI_URL}`);
      execFileSync('git', ['clone', WIKI_URL, wiki], { stdio: 'inherit' });
    }
  } else if (!fs.existsSync(path.join(wiki, '.git'))) {
    console.error(`Not a git clone: ${wiki}`);
    process.exit(1);
  }

  // Mirror: remove existing pages (keep .git), copy the fresh build in.
  for (const f of fs.readdirSync(wiki)) {
    if (f === '.git') continue;
    fs.rmSync(path.join(wiki, f), { recursive: true, force: true });
  }
  for (const f of fs.readdirSync(OUT)) {
    fs.copyFileSync(path.join(OUT, f), path.join(wiki, f));
  }

  execFileSync('git', ['-C', wiki, 'add', '-A'], { stdio: 'inherit' });
  const status = execFileSync('git', ['-C', wiki, 'status', '--porcelain'], { encoding: 'utf8' });
  if (!status.trim()) {
    console.log('\nWiki already up to date — nothing to commit.');
    return;
  }
  execFileSync('git', ['-C', wiki, 'commit', '-m', 'Sync wiki from documentation/'], { stdio: 'inherit' });
  console.log(`\nStaged + committed in ${wiki}`);
  console.log('Review the commit, then push it yourself:');
  console.log(`  git -C "${wiki}" push`);
}

const mode = process.argv[2] || 'build';
if (mode === 'build') build();
else if (mode === 'publish') publish(process.argv[3]);
else {
  console.error('usage: node tools/wiki-sync.mjs [build | publish [wikiClonePath]]');
  process.exit(1);
}
