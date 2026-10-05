const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { findReleasePrNumber, prepareRelease, mergeRelease, updateWorkspaceLock } = require('./release.cjs');

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const LOCK_SHA = 'c'.repeat(40);
const MERGE_SHA = 'd'.repeat(40);
const RELEASE_BRANCH = 'release-please--branches--main--components--stock-checker';
const context = { repo: { owner: 'gracefullight', repo: 'stock-checker' } };
const workspaceNames = {
  'apps/api': '@stock-checker/api',
  'apps/mcp': '@stock-checker/mcp',
  'apps/web': '@stock-checker/web',
  'packages/core': '@stock-checker/core',
};

test('release PR lookup uses a valid action output without querying GitHub', async () => {
  assert.equal(await findReleasePrNumber({ github: {}, context, prOutput: '{"number":42}' }), 42);
});

test('release PR lookup rejects malformed action output and invalid numbers', async () => {
  for (const prOutput of ['{', '{}', 'null', '{"number":"42"}', '{"number":0}', '{"number":-1}', '{"number":1.5}']) {
    await assert.rejects(findReleasePrNumber({ github: {}, context, prOutput }));
  }
});

test('release PR lookup resumes an existing canonical branch when the action is a no-op', async () => {
  const list = () => {};
  const calls = [];
  const github = {
    rest: { pulls: { list } },
    paginate: async (method, parameters) => {
      calls.push({ method, parameters });
      return [{ number: 42 }];
    },
  };
  assert.equal(await findReleasePrNumber({ github, context, prOutput: '' }), 42);
  assert.deepEqual(calls, [{
    method: list,
    parameters: { owner: 'gracefullight', repo: 'stock-checker', state: 'open', base: 'main', head: `gracefullight:${RELEASE_BRANCH}`, per_page: 100 },
  }]);
});

test('release PR lookup returns undefined when no pending release exists', async () => {
  const github = { rest: { pulls: { list: () => {} } }, paginate: async () => [] };
  assert.equal(await findReleasePrNumber({ github, context }), undefined);
});

test('release PR lookup rejects ambiguous or invalid existing pull requests', async () => {
  for (const pullRequests of [[{ number: 42 }, { number: 43 }], [{ number: '42' }], [{ number: 0 }]]) {
    const github = { rest: { pulls: { list: () => {} } }, paginate: async () => pullRequests };
    await assert.rejects(findReleasePrNumber({ github, context }));
  }
});

function lockFixture(version = '0.0.0') {
  const workspaces = [
    '    "": { "name": "stock-checker", "devDependencies": { "vitest": "^5.0.3", }, },',
    ...Object.entries(workspaceNames).map(([path, name]) =>
      `    "${path}": {\n      "name": "${name}",\n      "version": "${version}",\n      "dependencies": { "@stock-checker/core": "workspace:*", "fixture": "0.0.0", },\n    },`,
    ),
  ];
  return `{\n  "lockfileVersion": 1,\n  "configVersion": 1,\n  "workspaces": {\n${workspaces.join('\n')}\n  },\n  "packages": {\n    "fixture": ["fixture@0.0.0", "", {}, "sha512-,}\\\"quoted"],\n  },\n}\n`;
}

function apiFixture({ synchronized = false } = {}) {
  const repository = { id: 1, full_name: 'gracefullight/stock-checker' };
  const baseFiles = {
    'package.json': JSON.stringify({ name: 'stock-checker', version: '0.0.0', private: true, scripts: { test: 'node --test' } }),
    '.release-please-manifest.json': JSON.stringify({ '.': '0.0.0' }),
    'bun.lock': lockFixture(),
  };
  for (const [path, name] of Object.entries(workspaceNames)) {
    baseFiles[`${path}/package.json`] = JSON.stringify({ name, version: '0.0.0', private: true, dependencies: { fixture: '^1.0.0' } });
  }
  const headFiles = Object.fromEntries(Object.entries(baseFiles).map(([path, text]) => {
    if (path === 'bun.lock') return [path, synchronized ? updateWorkspaceLock(text, '0.0.0', '0.1.0') : text];
    const json = JSON.parse(text);
    json[path === '.release-please-manifest.json' ? '.' : 'version'] = '0.1.0';
    return [path, JSON.stringify(json)];
  }));
  headFiles['CHANGELOG.md'] = '# Changelog\n\n## 0.1.0\n';
  const state = {
    pr: {
      number: 42,
      state: 'open',
      draft: false,
      user: { login: 'github-actions[bot]', type: 'Bot' },
      title: 'chore(main): release 0.1.0',
      body: ':robot: I have created a release *beep* *boop*\n---\n\n## 0.1.0 (2026-10-05)\n\n### Features\n\n* Release fixture\n',
      labels: [{ name: 'autorelease: pending' }],
      base: { ref: 'main', sha: BASE_SHA, repo: repository },
      head: { ref: RELEASE_BRANCH, sha: HEAD_SHA, repo: repository },
    },
    baseFiles,
    headFiles,
    files: Object.keys(headFiles).filter((path) => path !== 'bun.lock' || synchronized).map((filename) => ({ filename, status: filename === 'CHANGELOG.md' ? 'added' : 'modified' })),
    mainSha: BASE_SHA,
    branchSha: HEAD_SHA,
    writes: [],
    merges: [],
    pullReads: 0,
    mergeResult: { merged: true, sha: MERGE_SHA, message: 'Pull Request successfully merged' },
  };
  const github = {
    rest: {
      pulls: {
        get: async () => {
          state.pullReads += 1;
          state.beforePullRead?.(state);
          return { data: structuredClone(state.pr) };
        },
        listFiles: () => {},
        merge: async (parameters) => {
          state.merges.push(parameters);
          if (state.mergeError) throw state.mergeError;
          return { data: state.mergeResult };
        },
      },
      git: {
        getRef: async ({ ref }) => ({ data: { object: { sha: ref === 'heads/main' ? state.mainSha : state.branchSha } } }),
      },
      repos: {
        getContent: async ({ path, ref }) => {
          const files = ref === BASE_SHA ? state.baseFiles : state.headFiles;
          assert.ok(ref === BASE_SHA || ref === state.pr.head.sha, `Unexpected content ref: ${ref}`);
          assert.ok(Object.hasOwn(files, path), `Unknown content path: ${path}`);
          return { data: { type: 'file', encoding: 'base64', content: Buffer.from(files[path]).toString('base64'), sha: 'f'.repeat(40) } };
        },
        createOrUpdateFileContents: async (parameters) => {
          state.writes.push(parameters);
          state.headFiles['bun.lock'] = Buffer.from(parameters.content, 'base64').toString('utf8');
          state.files.push({ filename: 'bun.lock', status: 'modified' });
          const parent = state.writeParent || state.pr.head.sha;
          state.pr.head.sha = LOCK_SHA;
          state.branchSha = LOCK_SHA;
          return { data: { commit: { sha: LOCK_SHA, parents: [{ sha: parent }] } } };
        },
      },
    },
    paginate: async () => structuredClone(state.files),
  };
  return { state, github };
}

function prepareOptions(fixture) {
  return { github: fixture.github, context, prNumber: 42, expectedBaseSha: BASE_SHA };
}

function mergeOptions(fixture) {
  return { ...prepareOptions(fixture), expectedHeadSha: HEAD_SHA };
}

test('lock updater changes four workspace versions and preserves dependency data and bytes', () => {
  const original = lockFixture();
  const updated = updateWorkspaceLock(original, '0.0.0', '0.1.0');
  assert.equal(updated, original.replaceAll('"version": "0.0.0"', '"version": "0.1.0"'));
  assert.equal(updateWorkspaceLock(updated, '0.1.0', '0.1.0'), updated);
  assert.equal(updateWorkspaceLock(original.replaceAll('\n', '\r\n'), '0.0.0', '0.1.0'), updated.replaceAll('\n', '\r\n'));
});

test('lock updater handles the repository Bun lockfile without changing anything else', () => {
  const original = readFileSync(new URL('../../bun.lock', `file://${__filename}`), 'utf8');
  const current = JSON.parse(readFileSync(new URL('../../package.json', `file://${__filename}`), 'utf8')).version;
  const [major, minor, patch] = current.split('.');
  const next = `${major}.${minor}.${BigInt(patch) + 1n}`;
  const updated = updateWorkspaceLock(original, current, next);
  assert.equal(updated, original.replaceAll(`"version": "${current}"`, `"version": "${next}"`));
});

for (const [name, change] of [
  ['missing workspace', (text) => text.replace('"apps/api"', '"apps/other"')],
  ['wrong workspace name', (text) => text.replace('"@stock-checker/api"', '"untrusted-package"')],
  ['mismatched version', (text) => text.replace('"version": "0.0.0"', '"version": "0.2.0"')],
  ['unexpected root version', (text) => text.replace('"name": "stock-checker",', '"name": "stock-checker", "version": "0.0.0",')],
  ['unsupported format', (text) => text.replace('"lockfileVersion": 1', '"lockfileVersion": 2')],
  ['duplicate version', (text) => text.replace('"version": "0.0.0",', '"version": "0.0.0", "version": "0.0.0",')],
]) {
  test(`lock updater rejects ${name}`, () => assert.throws(() => updateWorkspaceLock(change(lockFixture()), '0.0.0', '0.1.0')));
}

test('prepare rejects unchanged and decreased release versions', async () => {
  for (const previous of ['0.1.0', '1.0.0']) {
    const fixture = apiFixture();
    for (const [path, content] of Object.entries(fixture.state.baseFiles)) {
      if (path === 'bun.lock') fixture.state.baseFiles[path] = lockFixture(previous);
      else fixture.state.baseFiles[path] = content.replace('0.0.0', previous);
    }
    await assert.rejects(prepareRelease(prepareOptions(fixture)), /must increase/);
    assert.equal(fixture.state.writes.length, 0);
  }
});

test('prepare rejects malformed PR numbers and SHAs before reading GitHub', async () => {
  const fixture = apiFixture();
  await assert.rejects(prepareRelease({ ...prepareOptions(fixture), prNumber: '42' }), /number/);
  await assert.rejects(prepareRelease({ ...prepareOptions(fixture), expectedBaseSha: 'main' }), /SHA/);
  assert.equal(fixture.state.pullReads, 0);
});

test('lock updater rejects prerelease, leading-zero, missing and malformed versions', () => {
  for (const version of ['01.0.0', '1.0', '1.0.0-beta.1', 'v1.0.0', '', undefined]) {
    assert.throws(() => updateWorkspaceLock(lockFixture(), '0.0.0', version), /Invalid release version/);
  }
});

test('prepare verifies release files and updates only the release branch lockfile', async () => {
  const fixture = apiFixture();
  const result = await prepareRelease(prepareOptions(fixture));
  assert.deepEqual(result, { prNumber: 42, headSha: LOCK_SHA, baseSha: BASE_SHA, version: '0.1.0' });
  assert.equal(fixture.state.writes.length, 1);
  assert.equal(fixture.state.writes[0].path, 'bun.lock');
  assert.equal(fixture.state.writes[0].branch, RELEASE_BRANCH);
  assert.equal(fixture.state.writes[0].sha, 'f'.repeat(40));
  assert.equal(fixture.state.merges.length, 0);
});

test('prepare retries an already synchronized release without an extra commit', async () => {
  const fixture = apiFixture({ synchronized: true });
  const result = await prepareRelease(prepareOptions(fixture));
  assert.equal(result.headSha, HEAD_SHA);
  assert.equal(fixture.state.writes.length, 0);
});

test('prepare accepts the linked release header used after the first release', async () => {
  const fixture = apiFixture({ synchronized: true });
  fixture.state.pr.body = fixture.state.pr.body.replace('## 0.1.0', '## [0.1.0](https://github.com/gracefullight/stock-checker/compare/v0.0.0...v0.1.0)');
  assert.equal((await prepareRelease(prepareOptions(fixture))).version, '0.1.0');
});

for (const [name, change] of [
  ['wrong pull request number', (state) => { state.pr.number = 43; }],
  ['fork', (state) => { state.pr.head.repo = { id: 2, full_name: 'attacker/stock-checker' }; }],
  ['human author', (state) => { state.pr.user.login = 'gracefullight'; }],
  ['non-bot author type', (state) => { state.pr.user.type = 'User'; }],
  ['wrong branch', (state) => { state.pr.head.ref = 'arbitrary-feature'; }],
  ['wrong base branch', (state) => { state.pr.base.ref = 'development'; }],
  ['draft', (state) => { state.pr.draft = true; }],
  ['closed pull request', (state) => { state.pr.state = 'closed'; }],
  ['missing pending label', (state) => { state.pr.labels = []; }],
  ['stale pull request base', (state) => { state.pr.base.sha = MERGE_SHA; }],
  ['advanced main', (state) => { state.mainSha = MERGE_SHA; }],
  ['changed branch ref', (state) => { state.branchSha = MERGE_SHA; }],
  ['unexpected file', (state) => { state.files.push({ filename: '.github/workflows/release.yml', status: 'modified' }); }],
  ['renamed file', (state) => { state.files[0].previous_filename = '.github/workflows/release.yml'; }],
  ['deleted file', (state) => { state.files[0].status = 'removed'; }],
  ['missing version file', (state) => { state.files = state.files.filter((file) => file.filename !== 'apps/api/package.json'); }],
  ['mismatched package version', (state) => { state.headFiles['apps/api/package.json'] = state.headFiles['apps/api/package.json'].replace('0.1.0', '0.2.0'); }],
  ['mismatched title version', (state) => { state.pr.title = 'chore(main): release 9.9.9'; }],
  ['unexpected title format', (state) => { state.pr.title = 'Release 0.1.0'; }],
  ['mismatched body version', (state) => { state.pr.body = state.pr.body.replace('## 0.1.0', '## 9.9.9'); }],
  ['missing body', (state) => { state.pr.body = null; }],
  ['missing body header', (state) => { state.pr.body = 'Release 0.1.0'; }],
  ['duplicate release headers', (state) => { state.pr.body += '\n## 9.9.9 (2026-10-05)\n'; }],
  ['unexpected first header', (state) => { state.pr.body = `## Other release\n${state.pr.body}`; }],
  ['modified package scripts', (state) => { state.headFiles['package.json'] = state.headFiles['package.json'].replace('node --test', 'curl attacker'); }],
  ['modified dependencies', (state) => { state.headFiles['apps/api/package.json'] = state.headFiles['apps/api/package.json'].replace('^1.0.0', '^2.0.0'); }],
  ['unexpected manifest data', (state) => { state.headFiles['.release-please-manifest.json'] = JSON.stringify({ '.': '0.1.0', unsafe: '0.1.0' }); }],
  ['modified lock dependencies', (state) => { state.headFiles['bun.lock'] = state.headFiles['bun.lock'].replace('fixture@0.0.0', 'fixture@9.9.9'); }],
  ['old base lock versions', (state) => { state.baseFiles['bun.lock'] = lockFixture('0.2.0'); }],
]) {
  test(`prepare rejects ${name} before mutating GitHub`, async () => {
    const fixture = apiFixture();
    change(fixture.state);
    await assert.rejects(prepareRelease(prepareOptions(fixture)));
    assert.equal(fixture.state.writes.length, 0);
    assert.equal(fixture.state.merges.length, 0);
  });
}

test('prepare detects branch races before writing the lockfile', async () => {
  const fixture = apiFixture();
  fixture.state.beforePullRead = (state) => {
    if (state.pullReads === 2) state.pr.head.sha = state.branchSha = MERGE_SHA;
  };
  await assert.rejects(prepareRelease(prepareOptions(fixture)), /head changed/);
  assert.equal(fixture.state.writes.length, 0);
});

test('prepare detects branch races during the GitHub content update', async () => {
  const fixture = apiFixture();
  fixture.state.writeParent = MERGE_SHA;
  await assert.rejects(prepareRelease(prepareOptions(fixture)), /changed while updating lockfile/);
  assert.equal(fixture.state.merges.length, 0);
});

test('merge uses the validated SHA and squash method with a literal commit message', async () => {
  const fixture = apiFixture({ synchronized: true });
  const result = await mergeRelease(mergeOptions(fixture));
  assert.deepEqual(result, { merged: true, sha: MERGE_SHA, version: '0.1.0' });
  assert.deepEqual(fixture.state.merges[0], {
    owner: 'gracefullight', repo: 'stock-checker', pull_number: 42,
    sha: HEAD_SHA, merge_method: 'squash',
    commit_title: 'chore(main): release 0.1.0', commit_message: 'Release Please automated release.',
  });
});

test('merge rejects an unsynchronized lockfile', async () => {
  const fixture = apiFixture();
  await assert.rejects(mergeRelease(mergeOptions(fixture)), /not synchronized/);
  assert.equal(fixture.state.merges.length, 0);
});

test('merge rejects a changed head or main after validation', async () => {
  for (const race of ['head', 'main']) {
    const fixture = apiFixture({ synchronized: true });
    fixture.state.beforePullRead = (state) => {
      if (state.pullReads === 2) {
        if (race === 'head') state.pr.head.sha = state.branchSha = MERGE_SHA;
        else state.mainSha = MERGE_SHA;
      }
    };
    await assert.rejects(mergeRelease(mergeOptions(fixture)));
    assert.equal(fixture.state.merges.length, 0);
  }
});

test('merge reruns provenance and allowlist checks', async () => {
  const fixture = apiFixture({ synchronized: true });
  fixture.state.files.push({ filename: 'apps/mcp/src/server.ts', status: 'modified' });
  await assert.rejects(mergeRelease(mergeOptions(fixture)), /Unexpected release file/);
  assert.equal(fixture.state.merges.length, 0);
});

test('merge rejects a title edit during validation even if the head SHA is unchanged', async () => {
  const fixture = apiFixture({ synchronized: true });
  fixture.state.beforePullRead = (state) => {
    if (state.pullReads === 2) state.pr.title = 'chore(main): release 9.9.9';
  };
  await assert.rejects(mergeRelease(mergeOptions(fixture)), /title version mismatch/);
  assert.equal(fixture.state.merges.length, 0);
});

test('merge rejects a body version edit during validation even if the head SHA is unchanged', async () => {
  const fixture = apiFixture({ synchronized: true });
  fixture.state.beforePullRead = (state) => {
    if (state.pullReads === 2) state.pr.body = state.pr.body.replace('## 0.1.0', '## 9.9.9');
  };
  await assert.rejects(mergeRelease(mergeOptions(fixture)), /body version mismatch/);
  assert.equal(fixture.state.merges.length, 0);
});

test('merge propagates API failures and rejects unmerged or invalid-SHA responses', async () => {
  for (const failure of ['api', 'not-merged', 'missing-sha']) {
    const fixture = apiFixture({ synchronized: true });
    if (failure === 'api') fixture.state.mergeError = new Error('HTTP 409 merge conflict');
    else if (failure === 'not-merged') fixture.state.mergeResult = { merged: false, message: 'Merge blocked' };
    else fixture.state.mergeResult.sha = null;
    await assert.rejects(mergeRelease(mergeOptions(fixture)));
  }
});
