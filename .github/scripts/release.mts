import { setTimeout as waitFor } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';

export interface RepositoryParameters {
  owner: string;
  repo: string;
}

export interface RepositoryContext {
  repo: RepositoryParameters;
}

export interface PullListParameters extends RepositoryParameters {
  state: 'open';
  base: string;
  head: string;
  per_page: number;
}

interface PullParameters extends RepositoryParameters {
  pull_number: number;
}

interface PullFilesParameters extends PullParameters {
  per_page: number;
}

interface GitReferenceParameters extends RepositoryParameters {
  ref: string;
}

interface ReleaseRepository {
  id: number;
  full_name: string;
}

interface ReleaseBranch {
  ref: string;
  sha: string;
  repo: ReleaseRepository | null;
}

export interface ReleasePullRequest {
  number: number;
  state: string;
  draft: boolean;
  user: { login: string; type: string } | null;
  title: string;
  body: string | null;
  labels: Array<{ name?: string }>;
  head: ReleaseBranch;
  base: ReleaseBranch;
}

export interface ReleaseChangedFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

interface GitHubResponse<T> {
  data: T;
}

interface ReleaseFileContent {
  type: string;
  encoding?: string;
  content?: string;
  sha: string;
}

export interface ReleaseFileUpdateParameters extends RepositoryParameters {
  path: string;
  branch: string;
  sha: string;
  message: string;
  content: string;
}

export interface ReleaseMergeParameters extends PullParameters {
  sha: string;
  merge_method: 'squash';
  commit_title: string;
  commit_message: string;
}

export interface ReleaseMergeResponse {
  merged: boolean;
  sha?: string | null;
  message?: string;
}

export interface GitHubLookupClient {
  rest?: { pulls: { list?: unknown } };
  paginate?: (
    endpoint: unknown,
    parameters: PullListParameters
  ) => Promise<Array<{ number?: unknown }>>;
}

export interface GitHubReleaseClient {
  rest: {
    pulls: {
      get(parameters: PullParameters): Promise<GitHubResponse<ReleasePullRequest>>;
      listFiles: unknown;
      merge(parameters: ReleaseMergeParameters): Promise<GitHubResponse<ReleaseMergeResponse>>;
    };
    git: {
      getRef(
        parameters: GitReferenceParameters
      ): Promise<GitHubResponse<{ object: { sha: string } }>>;
    };
    repos: {
      compareCommitsWithBasehead(
        parameters: RepositoryParameters & { basehead: string }
      ): Promise<GitHubResponse<{ behind_by: number; status: string }>>;
      getContent(
        parameters: RepositoryParameters & { path: string; ref: string }
      ): Promise<GitHubResponse<ReleaseFileContent | ReleaseFileContent[]>>;
      createOrUpdateFileContents(
        parameters: ReleaseFileUpdateParameters
      ): Promise<
        GitHubResponse<{ commit: { sha?: string; parents?: Array<{ sha: string }> } | null }>
      >;
    };
  };
  paginate(endpoint: unknown, parameters: PullFilesParameters): Promise<ReleaseChangedFile[]>;
}

export type ReleaseWait = (milliseconds: number) => Promise<unknown>;

export interface ReleaseOptions {
  github: GitHubReleaseClient;
  context: RepositoryContext;
  core?: { info?(message: string): void };
  prNumber: number;
  expectedBaseSha: string;
}

export interface PrepareReleaseOptions extends ReleaseOptions {
  wait?: ReleaseWait;
}

export interface MergeReleaseOptions extends ReleaseOptions {
  expectedHeadSha: string;
}

interface BunWorkspace {
  name: unknown;
  version?: unknown;
  [key: string]: unknown;
}

interface BunLock {
  lockfileVersion: unknown;
  configVersion: unknown;
  workspaces: Record<string, BunWorkspace>;
  [key: string]: unknown;
}

interface ReadReleaseFile {
  text: string;
  sha: string;
}

interface ValidatedRelease {
  version: string;
  expectedLock: string;
  releaseLock: ReadReleaseFile;
}

export interface PreparedRelease {
  prNumber: number;
  headSha: string;
  baseSha: string;
  version: string;
}

export interface MergedRelease {
  merged: true;
  sha: string;
  version: string;
}

const RELEASE_BRANCH = 'release-please--branches--main--components--stock-checker';
const MANIFEST_PATH = '.release-please-manifest.json';
const WORKSPACE_NAMES = {
  'apps/api': '@stock-checker/api',
  'apps/mcp': '@stock-checker/mcp',
  'apps/web': '@stock-checker/web',
  'packages/automation': '@stock-checker/automation',
  'packages/core': '@stock-checker/core',
};
const PACKAGE_PATHS = [
  'package.json',
  ...Object.keys(WORKSPACE_NAMES).map((path) => `${path}/package.json`),
];
const RELEASE_FILES = new Set(['CHANGELOG.md', MANIFEST_PATH, ...PACKAGE_PATHS]);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA = /^[a-f0-9]{40}$/;

class ChangedHeadError extends Error {
  readonly headSha: string;
  readonly pr: ReleasePullRequest;

  constructor(pr: ReleasePullRequest) {
    super('Release pull request head changed');
    this.headSha = pr.head.sha;
    this.pr = pr;
  }
}

class StaleBaseError extends Error {
  readonly pr: ReleasePullRequest;

  constructor(pr: ReleasePullRequest) {
    super('Release pull request base is stale');
    this.pr = pr;
  }
}

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requireVersion(version: unknown): string {
  requireCondition(
    typeof version === 'string' && SEMVER.test(version),
    `Invalid release version: ${version}`
  );
  return version;
}

function requireSha(sha: unknown, name: string): asserts sha is string {
  requireCondition(typeof sha === 'string' && SHA.test(sha), `Invalid ${name} SHA`);
}

function isNewerVersion(version: string, previousVersion: string): boolean {
  const current = version.split('.').map(BigInt);
  const previous = previousVersion.split('.').map(BigInt);
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] !== previous[index]) return current[index] > previous[index];
  }
  return false;
}

// Bun's generated text lock contains trailing commas. Remove only commas outside
// strings for validation; the updater preserves all original bytes except versions.
function parseLock(text: string): BunLock {
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

function updateWorkspaceLock(text: string, previousVersion: unknown, version: unknown): string {
  previousVersion = requireVersion(previousVersion);
  version = requireVersion(version);
  const lock = parseLock(text);
  requireCondition(
    lock.lockfileVersion === 1 && lock.configVersion === 1,
    'Unsupported Bun lockfile format'
  );
  requireCondition(
    lock.workspaces && typeof lock.workspaces === 'object',
    'Missing lockfile workspaces'
  );
  requireCondition(
    isDeepStrictEqual(
      Object.keys(lock.workspaces).sort(),
      ['', ...Object.keys(WORKSPACE_NAMES)].sort()
    ),
    'Unexpected lockfile workspaces'
  );
  requireCondition(lock.workspaces[''].name === 'stock-checker', 'Unexpected root workspace');
  requireCondition(
    !Object.hasOwn(lock.workspaces[''], 'version'),
    'Unexpected root lockfile version'
  );
  const sections = [
    ...text.matchAll(
      /("workspaces"\s*:\s*\{)([\s\S]*?)(\r?\n[ \t]*\}\s*,\s*\r?\n[ \t]*"packages"\s*:)/g
    ),
  ];
  requireCondition(sections.length === 1, 'Unsupported lockfile workspace layout');
  const section = sections[0];
  let body = section[2];
  for (const [path, name] of Object.entries(WORKSPACE_NAMES)) {
    const workspace = lock.workspaces[path];
    requireCondition(workspace.name === name, `Unexpected workspace name: ${path}`);
    requireCondition(
      workspace.version === previousVersion,
      `Unexpected workspace version: ${path}`
    );
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `("${escapedPath}"\\s*:\\s*\\{\\s*"name"\\s*:\\s*"${escapedName}"\\s*,\\s*"version"\\s*:\\s*")([^"]*)(")`,
      'g'
    );
    const matches = [...body.matchAll(pattern)];
    requireCondition(
      matches.length === 1 && matches[0][2] === previousVersion,
      `Unsupported workspace version layout: ${path}`
    );
    body = body.replace(
      pattern,
      (_match: string, prefix: string, _oldVersion: string, suffix: string) =>
        `${prefix}${version}${suffix}`
    );
  }
  const updated =
    text.slice(0, section.index) +
    section[1] +
    body +
    section[3] +
    text.slice(section.index + section[0].length);
  const result = parseLock(updated);
  for (const path of Object.keys(WORKSPACE_NAMES)) {
    requireCondition(
      result.workspaces[path].version === version,
      `Workspace version update failed: ${path}`
    );
    result.workspaces[path].version = previousVersion;
  }
  requireCondition(isDeepStrictEqual(result, lock), 'Lockfile update changed non-version data');
  return updated;
}

function repoParameters(context: RepositoryContext): RepositoryParameters {
  requireCondition(context?.repo?.owner && context?.repo?.repo, 'Missing repository context');
  return { owner: context.repo.owner, repo: context.repo.repo };
}

async function findReleasePrNumber({
  github,
  context,
  prOutput,
}: {
  github: GitHubLookupClient;
  context: RepositoryContext;
  prOutput?: unknown;
}): Promise<number | undefined> {
  const repository = repoParameters(context);
  let number: unknown;
  if (prOutput !== undefined && prOutput !== '') {
    requireCondition(typeof prOutput === 'string', 'Invalid Release Please pull request output');
    number = (JSON.parse(prOutput) as { number?: unknown }).number;
  } else {
    const pullRequests = await github.paginate!(github.rest!.pulls.list, {
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
  requireCondition(
    typeof number === 'number' && Number.isSafeInteger(number) && number > 0,
    'Invalid release pull request number'
  );
  return number;
}

async function getPullRequest(
  github: GitHubReleaseClient,
  repository: RepositoryParameters,
  prNumber: number,
  expectedBaseSha: string,
  expectedHeadSha?: string
): Promise<ReleasePullRequest> {
  requireCondition(
    Number.isSafeInteger(prNumber) && prNumber > 0,
    'Invalid release pull request number'
  );
  requireSha(expectedBaseSha, 'base');
  if (expectedHeadSha !== undefined) requireSha(expectedHeadSha, 'head');
  const { data: pr } = await github.rest.pulls.get({ ...repository, pull_number: prNumber });
  requireCondition(pr.number === prNumber, 'Unexpected release pull request number');
  requireCondition(pr.state === 'open' && !pr.draft, 'Release pull request is not open and ready');
  requireCondition(
    pr.user?.login === 'github-actions[bot]' && pr.user?.type === 'Bot',
    'Unexpected release pull request author'
  );
  const fullName = `${repository.owner}/${repository.repo}`.toLowerCase();
  requireCondition(
    pr.head?.repo?.full_name?.toLowerCase() === fullName &&
      pr.base?.repo?.full_name?.toLowerCase() === fullName,
    'Release pull request must use the local repository'
  );
  requireCondition(
    pr.head.repo.id === pr.base.repo.id,
    'Release pull request repository IDs differ'
  );
  requireCondition(
    pr.base.ref === 'main' && pr.head.ref === RELEASE_BRANCH,
    'Unexpected release pull request branch'
  );
  requireCondition(
    pr.labels.some((label) => label.name === 'autorelease: pending'),
    'Missing pending release label'
  );
  requireSha(pr.head.sha, 'pull request head');
  if (pr.base.sha !== expectedBaseSha) throw new StaleBaseError(pr);
  if (expectedHeadSha !== undefined && pr.head.sha !== expectedHeadSha)
    throw new ChangedHeadError(pr);
  const { data: main } = await github.rest.git.getRef({ ...repository, ref: 'heads/main' });
  requireCondition(
    main.object.sha === expectedBaseSha,
    'Main advanced; retry release on the current main commit'
  );
  const { data: head } = await github.rest.git.getRef({
    ...repository,
    ref: `heads/${RELEASE_BRANCH}`,
  });
  requireCondition(head.object.sha === pr.head.sha, 'Release branch changed during validation');
  return pr;
}

async function getInitialPullRequest(
  github: GitHubReleaseClient,
  repository: RepositoryParameters,
  prNumber: number,
  expectedBaseSha: string,
  wait: ReleaseWait
): Promise<ReleasePullRequest> {
  requireCondition(
    Number.isSafeInteger(prNumber) && prNumber > 0,
    'Invalid release pull request number'
  );
  requireSha(expectedBaseSha, 'base');
  const readReferences = async () => {
    const { data: main } = await github.rest.git.getRef({ ...repository, ref: 'heads/main' });
    requireCondition(
      main.object.sha === expectedBaseSha,
      'Main advanced; retry release on the current main commit'
    );
    const { data: branch } = await github.rest.git.getRef({
      ...repository,
      ref: `heads/${RELEASE_BRANCH}`,
    });
    requireSha(branch.object.sha, 'release branch');
    return branch.object.sha;
  };
  const headSha = await readReferences();
  const { data: comparison } = await github.rest.repos.compareCommitsWithBasehead({
    ...repository,
    basehead: `${expectedBaseSha}...${headSha}`,
  });
  requireCondition(
    comparison.behind_by === 0 && ['ahead', 'identical'].includes(comparison.status),
    'Release branch does not contain the current main commit'
  );
  const version = requireVersion(
    (
      JSON.parse((await readFile(github, repository, 'package.json', headSha)).text) as Record<
        string,
        unknown
      >
    ).version
  );
  let staleSnapshot:
    | { headSha: string; baseSha: string; title: string; body: string | null }
    | undefined;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    requireCondition(
      (await readReferences()) === headSha,
      'Release branch changed while waiting for initial pull request'
    );
    let pr: ReleasePullRequest;
    try {
      pr = await getPullRequest(github, repository, prNumber, expectedBaseSha, headSha);
    } catch (error) {
      if (!(error instanceof StaleBaseError) && !(error instanceof ChangedHeadError)) throw error;
      pr = error.pr;
    }
    const titleVersion = /^chore\(main\): release (\d+\.\d+\.\d+)$/.exec(pr.title || '')?.[1];
    requireCondition(titleVersion, 'Release pull request title version mismatch');
    requireVersion(titleVersion);
    validateReleaseMetadata(pr, titleVersion);
    if (pr.base.sha === expectedBaseSha && pr.head.sha === headSha && titleVersion === version)
      return pr;
    requireCondition(
      titleVersion === version || isNewerVersion(version, titleVersion),
      'Unexpected initial release metadata version'
    );
    staleSnapshot ??= {
      headSha: pr.head.sha,
      baseSha: pr.base.sha,
      title: pr.title,
      body: pr.body,
    };
    requireCondition(
      [headSha, staleSnapshot.headSha].includes(pr.head.sha),
      'Release pull request changed while waiting for initial snapshot'
    );
    requireCondition(
      [expectedBaseSha, staleSnapshot.baseSha].includes(pr.base.sha),
      'Release pull request base changed while waiting for initial snapshot'
    );
    requireCondition(
      titleVersion === version ||
        (pr.title === staleSnapshot.title && pr.body === staleSnapshot.body),
      'Release metadata changed while waiting for initial snapshot'
    );
    if (attempt === 5)
      throw new Error('Timed out waiting for initial release pull request snapshot');
    await wait(1000);
  }
  throw new Error('Timed out waiting for initial release pull request snapshot');
}

async function waitForLockCommit(
  github: GitHubReleaseClient,
  repository: RepositoryParameters,
  prNumber: number,
  expectedBaseSha: string,
  previousHeadSha: string,
  expectedHeadSha: string,
  version: string,
  wait: ReleaseWait
): Promise<ReleasePullRequest> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data: branch } = await github.rest.git.getRef({
      ...repository,
      ref: `heads/${RELEASE_BRANCH}`,
    });
    requireCondition(
      branch.object.sha === expectedHeadSha,
      'Release branch changed while waiting for lockfile commit'
    );
    try {
      const pr = await getPullRequest(
        github,
        repository,
        prNumber,
        expectedBaseSha,
        expectedHeadSha
      );
      validateReleaseMetadata(pr, version);
      return pr;
    } catch (error) {
      // Only our own commit's previous PR snapshot can lag behind the branch ref.
      // Unexpected heads and all other validation/API errors fail immediately.
      if (!(error instanceof ChangedHeadError) || error.headSha !== previousHeadSha) throw error;
      if (attempt === 5)
        throw new Error('Timed out waiting for release pull request lockfile commit');
      await wait(1000);
    }
  }
  throw new Error('Timed out waiting for release pull request lockfile commit');
}

async function readFile(
  github: GitHubReleaseClient,
  repository: RepositoryParameters,
  path: string,
  ref: string
): Promise<ReadReleaseFile> {
  const { data } = await github.rest.repos.getContent({ ...repository, path, ref });
  requireCondition(
    !Array.isArray(data) &&
      data.type === 'file' &&
      data.encoding === 'base64' &&
      typeof data.content === 'string',
    `Cannot read release file: ${path}`
  );
  return { text: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
}

function compareVersionChange(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  key: string,
  file: string
): { previousVersion: string; version: string } {
  const previousVersion = requireVersion(previous[key]);
  const version = requireVersion(next[key]);
  requireCondition(
    isDeepStrictEqual({ ...previous, [key]: version }, next),
    `Non-version changes in ${file}`
  );
  return { previousVersion, version };
}

function validateReleaseMetadata(pr: ReleasePullRequest, version: string): void {
  requireCondition(
    pr.title === `chore(main): release ${version}`,
    'Release pull request title version mismatch'
  );
  requireCondition(typeof pr.body === 'string', 'Missing release pull request body');
  const headings = [...pr.body.matchAll(/^##[ \t]+([^\r\n]+)\r?$/gm)];
  const versionPattern = '(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)';
  const headerPattern = new RegExp(
    `^(?:\\[(${versionPattern})\\](?:\\([^\\s()]+\\))?|(${versionPattern}))(?=[ \\t]|$)`
  );
  const releaseHeaders = headings.map((heading) => headerPattern.exec(heading[1])).filter(Boolean);
  const firstHeader = headings[0] && headerPattern.exec(headings[0][1]);
  requireCondition(
    firstHeader && releaseHeaders.length === 1 && (firstHeader[1] || firstHeader[2]) === version,
    'Release pull request body version mismatch'
  );
}

async function validateReleaseFiles(
  github: GitHubReleaseClient,
  repository: RepositoryParameters,
  pr: ReleasePullRequest,
  expectedBaseSha: string
): Promise<ValidatedRelease> {
  const files = await github.paginate(github.rest.pulls.listFiles, {
    ...repository,
    pull_number: pr.number,
    per_page: 100,
  });
  const paths = new Set<string>();
  for (const file of files) {
    requireCondition(
      (RELEASE_FILES.has(file.filename) || file.filename === 'bun.lock') &&
        !file.previous_filename &&
        ['added', 'modified'].includes(file.status),
      `Unexpected release file: ${file.filename}`
    );
    requireCondition(!paths.has(file.filename), `Duplicate release file: ${file.filename}`);
    paths.add(file.filename);
  }
  for (const path of [...PACKAGE_PATHS, MANIFEST_PATH]) {
    requireCondition(paths.has(path), `Missing release version change: ${path}`);
  }
  let version: string | undefined;
  let previousVersion: string | undefined;
  for (const path of [...PACKAGE_PATHS, MANIFEST_PATH]) {
    const previous = JSON.parse(
      (await readFile(github, repository, path, expectedBaseSha)).text
    ) as Record<string, unknown>;
    const next = JSON.parse((await readFile(github, repository, path, pr.head.sha)).text) as Record<
      string,
      unknown
    >;
    const change = compareVersionChange(
      previous,
      next,
      path === MANIFEST_PATH ? '.' : 'version',
      path
    );
    version ??= change.version;
    previousVersion ??= change.previousVersion;
    requireCondition(
      change.version === version && change.previousVersion === previousVersion,
      `Release version mismatch in ${path}`
    );
  }
  // PACKAGE_PATHS always includes the root package, so both versions were read.
  requireCondition(isNewerVersion(version!, previousVersion!), 'Release version must increase');
  validateReleaseMetadata(pr, version!);
  const baseLock = await readFile(github, repository, 'bun.lock', expectedBaseSha);
  const releaseLock = await readFile(github, repository, 'bun.lock', pr.head.sha);
  const expectedLock = updateWorkspaceLock(baseLock.text, previousVersion, version);
  requireCondition(
    releaseLock.text === baseLock.text || releaseLock.text === expectedLock,
    'Unexpected changes in release lockfile'
  );
  requireCondition(
    !paths.has('bun.lock') || releaseLock.text === expectedLock,
    'Release lockfile diff is not a workspace version update'
  );
  return { version: version!, expectedLock, releaseLock };
}

async function prepareRelease({
  github,
  context,
  core,
  prNumber,
  expectedBaseSha,
  wait = waitFor,
}: PrepareReleaseOptions): Promise<PreparedRelease> {
  const repository = repoParameters(context);
  let pr = await getInitialPullRequest(github, repository, prNumber, expectedBaseSha, wait);
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
    requireCondition(
      data.commit.parents?.length === 1 && data.commit.parents[0].sha === pr.head.sha,
      'Release branch changed while updating lockfile'
    );
    pr = await waitForLockCommit(
      github,
      repository,
      prNumber,
      expectedBaseSha,
      pr.head.sha,
      data.commit.sha,
      release.version,
      wait
    );
    await validateReleaseFiles(github, repository, pr, expectedBaseSha);
  }
  core?.info?.(`Prepared release ${release.version} at ${pr.head.sha}`);
  return { prNumber, headSha: pr.head.sha, baseSha: expectedBaseSha, version: release.version };
}

async function mergeRelease({
  github,
  context,
  core,
  prNumber,
  expectedHeadSha,
  expectedBaseSha,
}: MergeReleaseOptions): Promise<MergedRelease> {
  const repository = repoParameters(context);
  let pr = await getPullRequest(github, repository, prNumber, expectedBaseSha, expectedHeadSha);
  const release = await validateReleaseFiles(github, repository, pr, expectedBaseSha);
  requireCondition(
    release.releaseLock.text === release.expectedLock,
    'Release lockfile is not synchronized'
  );
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

export { findReleasePrNumber, mergeRelease, prepareRelease, updateWorkspaceLock };
