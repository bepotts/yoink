// Prepares verified yt-dlp resources and explicitly updates the tracked release manifest.
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  writeFile,
  copyFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = path.join(root, 'vendor/yt-dlp/manifest.json');
const assets = {
  'darwin-x64': 'yt-dlp_macos',
  'darwin-arm64': 'yt-dlp_macos',
  'darwin-universal': 'yt-dlp_macos',
  'win32-x64': 'yt-dlp.exe',
  'win32-arm64': 'yt-dlp_arm64.exe',
  'win32-ia32': 'yt-dlp_x86.exe',
  'linux-x64': 'yt-dlp_linux',
  'linux-arm64': 'yt-dlp_linux_aarch64',
};

// Fetches upstream release files with bounded waits and explicit HTTP failures.
async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok)
    throw new Error(`yt-dlp download failed: HTTP ${response.status} (${url})`);
  return Buffer.from(await response.arrayBuffer());
}

// Computes the release digest before an executable is cached or run.
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Selects and verifies target resources.
 * @param {string} platform Target Electron platform.
 * @param {string} arch Target Electron architecture.
 */
export async function prepareYtDlp(
  platform = process.platform,
  arch = process.arch,
) {
  const asset = assets[`${platform}-${arch}`];
  if (!asset)
    throw new Error(`Bundled yt-dlp does not support ${platform}-${arch}.`);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const expected = manifest.sha256[asset];
  if (!/^[a-f0-9]{64}$/.test(expected ?? ''))
    throw new Error(`Missing yt-dlp checksum for ${asset}.`);
  const directory = path.join(
    root,
    'vendor/yt-dlp/bin',
    `${platform}-${arch}`,
    'yt-dlp',
  );
  const executable = path.join(
    directory,
    platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
  );
  await mkdir(directory, { recursive: true });
  const metadata = await readFile(path.join(directory, 'version.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  const sameVersion = metadata?.version === manifest.version;
  const cached = await readFile(executable).catch(() => null);
  if (!cached || digest(cached) !== expected) {
    const bytes = await fetchBytes(
      `https://github.com/yt-dlp/yt-dlp/releases/download/${manifest.version}/${asset}`,
    );
    if (digest(bytes) !== expected)
      throw new Error(`yt-dlp checksum mismatch for ${asset}.`);
    const temporary = `${executable}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o755 });
    await rename(temporary, executable);
  }
  if (platform !== 'win32') await chmod(executable, 0o755);
  for (const name of ['LICENSE', 'THIRD_PARTY_LICENSES.txt']) {
    const destination = path.join(directory, name);
    const cachedNotice = await readFile(destination).catch(() => null);
    if (!cachedNotice || !sameVersion) {
      await writeFile(
        destination,
        await fetchBytes(
          `https://raw.githubusercontent.com/yt-dlp/yt-dlp/${manifest.version}/${name}`,
        ),
      );
    }
  }
  await copyFile(manifestPath, path.join(directory, 'version.json'));
  console.log(`Prepared yt-dlp ${manifest.version} for ${platform}-${arch}`);
  return directory;
}

// Refreshes all supported platform pins from a specific official GitHub release.
async function updateManifest(version) {
  if (!version || !/^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/.test(version)) {
    throw new Error('Usage: npm run yt-dlp:update -- YYYY.MM.DD');
  }
  const sums = (
    await fetchBytes(
      `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/SHA2-256SUMS`,
    )
  ).toString('utf8');
  const sha256 = {};
  for (const asset of new Set(Object.values(assets))) {
    const line = sums
      .split('\n')
      .find(
        (entry) => entry.trim().split(/\s+/)[1]?.replace(/^\*/, '') === asset,
      );
    const checksum = line?.trim().split(/\s+/)[0];
    if (!/^[a-f0-9]{64}$/.test(checksum ?? ''))
      throw new Error(`Missing official checksum for ${asset}.`);
    sha256[asset] = checksum;
  }
  await writeFile(
    manifestPath,
    `${JSON.stringify({ version, sha256 }, null, 2)}\n`,
  );
  console.log(
    `Pinned yt-dlp ${version}. Review and commit vendor/yt-dlp/manifest.json, then rebuild.`,
  );
}

// Runs preparation or a deliberate version update when invoked as an npm command.
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  try {
    if (process.argv[2] === 'update') await updateManifest(process.argv[3]);
    else await prepareYtDlp();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
