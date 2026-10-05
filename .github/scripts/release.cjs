const { isDeepStrictEqual } = require('node:util');
const { setTimeout: waitFor } = require('node:timers/promises');

const RELEASE_BRANCH = 'release-please--branches--main--components--stock-checker';
const MANIFEST_PATH = '.release-please-manifest.json';
const WORKSPACE_NAMES = {
  'apps/api': '@stock-checker/api',
  'apps/mcp': '@stock-checker/mcp',
  'apps/web': '@stock-checker/web',
  'packages/core': '@stock-checker/core',
};
const PACKAGE_PATHS = ['package.json', ...Object.keys(WORKSPACE_NAMES).map((path) => `${path}/package.json`)];
const RELEASE_FILES = new Set(['CHANGELOG.md', MANIFEST_PATH, ...PACKAGE_PATHS]);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA = /^[a-f0-9]{40}$/;

class ChangedHeadError extends Error {
  constructor(headSha) {
    super('Release pull request head changed');
    this.headSha = headSha;
  }
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function requireVersion(version) {
  requireCondition(typeof version === 'string' && SEMVER.test(version), `Invalid release version: ${version}`);
  return version;
}

function requireSha(sha, name) {
  requireCondition(typeof sha === 'string' && SHA.test(sha), `Invalid ${name} SHA`);
}

function isNewerVersion(version, previousVersion) {
  const current = version.split('.').map(BigInt);
  const previous = previousVersion.split('.').map(BigInt);
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] !== previous[index]) return current[index] > previous[index];
  }
  return false;
}

// Bun's generated text lock contains trailing commas. Remove only commas outside
// strings for validation; the updater preserves all original bytes except versions.
function parseLock(text) {
  let json = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (!inString && character === ',') {
      let next = index + 1;
      while (/\s/.test(text[next] || '') && next < text.length) next += 1;
      if (text[next] === '}' || text[next] === ']') continue;
    }
    json += character;
    if (inString && escaped) escaped = false;
    else if (inString && character === '\\') escaped = true;
    else if (character === '"') inString = !inString;
  }
  return JSON.parse(json);
}

function updateWorkspaceLock(text, previousVersion, version) {
  requireVersion(previousVersion);
  requireVersion(version);
  const lock = parseLock(text);
  requireCondition(lock.lockfileVersion === 1 && lock.configVersion === 1, 'Unsupported Bun lockfile format');
  requireCondition(lock.workspaces && typeof lock.workspaces === 'object', 'Missing lockfile workspaces');
  requireCondition(
    isDeepStrictEqual(Object.keys(lock.workspaces).sort(), ['', ...Object.keys(WORKSPACE_NAMES)].sort()),
    'Unexpected lockfile workspaces',
  );
  requireCondition(lock.workspaces[''].name === 'stock-checker', 'Unexpected root workspace');
  requireCondition(!Object.hasOwn(lock.workspaces[''], 'version'), 'Unexpected root lockfile version');
  const sections = [...text.matchAll(/("workspaces"\s*:\s*\{)([\s\S]*?)(\r?\n[ \t]*\}\s*,\s*\r?\n[ \t]*"packages"\s*:)/g)];
  requireCondition(sections.length === 1, 'Unsupported lockfile workspace layout');
  const section = sections[0];
  let body = section[2];
  for (const [path, name] of Object.entries(WORKSPACE_NAMES)) {
    const workspace = lock.workspaces[path];
    requireCondition(workspace.name === name, `Unexpected workspace name: ${path}`);
    requireCondition(workspace.version === previousVersion, `Unexpected workspace version: ${path}`);
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`("${escapedPath}"\\s*:\\s*\\{\\s*"name"\\s*:\\s*"${escapedName}"\\s*,\\s*"version"\\s*:\\s*")([^"]*)(")`, 'g');
    const matches = [...body.matchAll(pattern)];
    requireCondition(matches.length === 1 && matches[0][2] === previousVersion, `Unsupported workspace version layout: ${path}`);
    body = body.replace(pattern, (_match, prefix, _oldVersion, suffix) => `${prefix}${version}${suffix}`);
  }
  const updated = text.slice(0, section.index) + section[1] + body + section[3] + text.slice(section.index + section[0].length);
  const result = parseLock(updated);
  for (const path of Object.keys(WORKSPACE_NAMES)) {
    requireCondition(result.workspaces[path].version === version, `Workspace version update failed: ${path}`);
    result.workspaces[path].version = previousVersion;
  }
  requireCondition(isDeepStrictEqual(result, lock), 'Lockfile update changed non-version data');
  return updated;
}

function repoParameters(context) {
  requireCondition(context?.repo?.owner && context?.repo?.repo, 'Missing repository context');
  return { owner: context.repo.owner, repo: context.repo.repo };
}

async function findReleasePrNumber({ github, context, prOutput }) {
  const repository = repoParameters(context);
  let number;
  if (prOutput !== undefined && prOutput !== '') {
    requireCondition(typeof prOutput === 'string', 'Invalid Release Please pull request output');
    number = JSON.parse(prOutput).number;
  } else {
    const pullRequests = await github.paginate(github.rest.pulls.list, {
      ...repository,
      state: 'open',
      base: 'main',
      head: `${repository.owner}:${RELEASE_BRANCH}`,
      per_page: 100,
    });
    requireCondition(pullRequests.length <= 1, 'Multiple pending release pull requests');
    if (pullRequests.length === 0) return undefined;
    number = pullRequests[0].number;
  }
  requireCondition(Number.isSafeInteger(number) && number > 0, 'Invalid release pull request number');
  return number;
}

async function getPullRequest(github, repository, prNumber, expectedBaseSha, expectedHeadSha) {
  requireCondition(Number.isSafeInteger(prNumber) && prNumber > 0, 'Invalid release pull request number');
  requireSha(expectedBaseSha, 'base');
  if (expectedHeadSha !== undefined) requireSha(expectedHeadSha, 'head');
  const { data: pr } = await github.rest.pulls.get({ ...repository, pull_number: prNumber });
  requireCondition(pr.number === prNumber, 'Unexpected release pull request number');
  requireCondition(pr.state === 'open' && !pr.draft, 'Release pull request is not open and ready');
  requireCondition(pr.user?.login === 'github-actions[bot]' && pr.user?.type === 'Bot', 'Unexpected release pull request author');
  const fullName = `${repository.owner}/${repository.repo}`.toLowerCase();
  requireCondition(pr.head?.repo?.full_name?.toLowerCase() === fullName && pr.base?.repo?.full_name?.toLowerCase() === fullName, 'Release pull request must use the local repository');
  requireCondition(pr.head.repo.id === pr.base.repo.id, 'Release pull request repository IDs differ');
  requireCondition(pr.base.ref === 'main' && pr.head.ref === RELEASE_BRANCH, 'Unexpected release pull request branch');
  requireCondition(pr.labels.some((label) => label.name === 'autorelease: pending'), 'Missing pending release label');
  requireSha(pr.head.sha, 'pull request head');
  requireCondition(pr.base.sha === expectedBaseSha, 'Release pull request base is stale');
  if (expectedHeadSha !== undefined && pr.head.sha !== expectedHeadSha) throw new ChangedHeadError(pr.head.sha);
  const { data: main } = await github.rest.git.getRef({ ...repository, ref: 'heads/main' });
  requireCondition(main.object.sha === expectedBaseSha, 'Main advanced; retry release on the current main commit');
  const { data: head } = await github.rest.git.getRef({ ...repository, ref: `heads/${RELEASE_BRANCH}` });
  requireCondition(head.object.sha === pr.head.sha, 'Release branch changed during validation');
  return pr;
}

async function waitForLockCommit(github, repository, prNumber, expectedBaseSha, previousHeadSha, expectedHeadSha, version, wait) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data: branch } = await github.rest.git.getRef({ ...repository, ref: `heads/${RELEASE_BRANCH}` });
    requireCondition(branch.object.sha === expectedHeadSha, 'Release branch changed while waiting for lockfile commit');
    try {
      const pr = await getPullRequest(github, repository, prNumber, expectedBaseSha, expectedHeadSha);
      validateReleaseMetadata(pr, version);
      return pr;
    } catch (error) {
      // Only our own commit's previous PR snapshot can lag behind the branch ref.
      // Unexpected heads and all other validation/API errors fail immediately.
      if (!(error instanceof ChangedHeadError) || error.headSha !== previousHeadSha) throw error;
      if (attempt === 5) throw new Error('Timed out waiting for release pull request lockfile commit');
      await wait(1000);
    }
  }
}

async function readFile(github, repository, path, ref) {
  const { data } = await github.rest.repos.getContent({ ...repository, path, ref });
  requireCondition(!Array.isArray(data) && data.type === 'file' && data.encoding === 'base64' && typeof data.content === 'string', `Cannot read release file: ${path}`);
  return { text: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
}

function compareVersionChange(previous, next, key, file) {
  const previousVersion = requireVersion(previous[key]);
  const version = requireVersion(next[key]);
  requireCondition(isDeepStrictEqual({ ...previous, [key]: version }, next), `Non-version changes in ${file}`);
  return { previousVersion, version };
}

function validateReleaseMetadata(pr, version) {
  requireCondition(pr.title === `chore(main): release ${version}`, 'Release pull request title version mismatch');
  requireCondition(typeof pr.body === 'string', 'Missing release pull request body');
  const headings = [...pr.body.matchAll(/^##[ \t]+([^\r\n]+)\r?$/gm)];
  const versionPattern = '(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)';
  const headerPattern = new RegExp(`^(?:\\[(${versionPattern})\\](?:\\([^\\s()]+\\))?|(${versionPattern}))(?=[ \\t]|$)`);
  const releaseHeaders = headings.map((heading) => headerPattern.exec(heading[1])).filter(Boolean);
  const firstHeader = headings[0] && headerPattern.exec(headings[0][1]);
  requireCondition(firstHeader && releaseHeaders.length === 1 && (firstHeader[1] || firstHeader[2]) === version, 'Release pull request body version mismatch');
}

async function validateReleaseFiles(github, repository, pr, expectedBaseSha) {
  const files = await github.paginate(github.rest.pulls.listFiles, { ...repository, pull_number: pr.number, per_page: 100 });
  const paths = new Set();
  for (const file of files) {
    requireCondition((RELEASE_FILES.has(file.filename) || file.filename === 'bun.lock') && !file.previous_filename && ['added', 'modified'].includes(file.status), `Unexpected release file: ${file.filename}`);
    requireCondition(!paths.has(file.filename), `Duplicate release file: ${file.filename}`);
    paths.add(file.filename);
  }
  for (const path of [...PACKAGE_PATHS, MANIFEST_PATH]) {
    requireCondition(paths.has(path), `Missing release version change: ${path}`);
  }
  let version;
  let previousVersion;
  for (const path of [...PACKAGE_PATHS, MANIFEST_PATH]) {
    const previous = JSON.parse((await readFile(github, repository, path, expectedBaseSha)).text);
    const next = JSON.parse((await readFile(github, repository, path, pr.head.sha)).text);
    const change = compareVersionChange(previous, next, path === MANIFEST_PATH ? '.' : 'version', path);
    version ??= change.version;
    previousVersion ??= change.previousVersion;
    requireCondition(change.version === version && change.previousVersion === previousVersion, `Release version mismatch in ${path}`);
  }
  requireCondition(isNewerVersion(version, previousVersion), 'Release version must increase');
  validateReleaseMetadata(pr, version);
  const baseLock = await readFile(github, repository, 'bun.lock', expectedBaseSha);
  const releaseLock = await readFile(github, repository, 'bun.lock', pr.head.sha);
  const expectedLock = updateWorkspaceLock(baseLock.text, previousVersion, version);
  requireCondition(releaseLock.text === baseLock.text || releaseLock.text === expectedLock, 'Unexpected changes in release lockfile');
  requireCondition(!paths.has('bun.lock') || releaseLock.text === expectedLock, 'Release lockfile diff is not a workspace version update');
  return { version, expectedLock, releaseLock };
}

async function prepareRelease({ github, context, core, prNumber, expectedBaseSha, wait = waitFor }) {
  const repository = repoParameters(context);
  let pr = await getPullRequest(github, repository, prNumber, expectedBaseSha);
  const release = await validateReleaseFiles(github, repository, pr, expectedBaseSha);
  pr = await getPullRequest(github, repository, prNumber, expectedBaseSha, pr.head.sha);
  validateReleaseMetadata(pr, release.version);
  if (release.releaseLock.text !== release.expectedLock) {
    const { data } = await github.rest.repos.createOrUpdateFileContents({
      ...repository,
      path: 'bun.lock',
      branch: RELEASE_BRANCH,
      sha: release.releaseLock.sha,
      message: 'chore: sync release workspace lockfile',
      content: Buffer.from(release.expectedLock, 'utf8').toString('base64'),
    });
    requireSha(data.commit?.sha, 'lockfile commit');
    requireCondition(data.commit.parents?.length === 1 && data.commit.parents[0].sha === pr.head.sha, 'Release branch changed while updating lockfile');
    pr = await waitForLockCommit(github, repository, prNumber, expectedBaseSha, pr.head.sha, data.commit.sha, release.version, wait);
    await validateReleaseFiles(github, repository, pr, expectedBaseSha);
  }
  core?.info?.(`Prepared release ${release.version} at ${pr.head.sha}`);
  return { prNumber, headSha: pr.head.sha, baseSha: expectedBaseSha, version: release.version };
}

async function mergeRelease({ github, context, core, prNumber, expectedHeadSha, expectedBaseSha }) {
  const repository = repoParameters(context);
  let pr = await getPullRequest(github, repository, prNumber, expectedBaseSha, expectedHeadSha);
  const release = await validateReleaseFiles(github, repository, pr, expectedBaseSha);
  requireCondition(release.releaseLock.text === release.expectedLock, 'Release lockfile is not synchronized');
  pr = await getPullRequest(github, repository, prNumber, expectedBaseSha, expectedHeadSha);
  validateReleaseMetadata(pr, release.version);
  const { data } = await github.rest.pulls.merge({
    ...repository,
    pull_number: prNumber,
    sha: expectedHeadSha,
    merge_method: 'squash',
    commit_title: pr.title,
    commit_message: 'Release Please automated release.',
  });
  requireCondition(data.merged === true, `Release merge failed: ${data.message || 'not merged'}`);
  requireSha(data.sha, 'merge commit');
  core?.info?.(`Merged release ${release.version} at ${data.sha}`);
  return { merged: true, sha: data.sha, version: release.version };
}

module.exports = { findReleasePrNumber, prepareRelease, mergeRelease, updateWorkspaceLock };
