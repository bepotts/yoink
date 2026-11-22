// Prepares checksum-pinned FFmpeg, FFprobe, and Deno resources for offline-ready installs.
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = path.join(root, 'vendor/media-tools/manifest.json');
const targets = {
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
};

// Hashes a downloaded archive or executable before it is used.
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Downloads a bounded upstream resource and rejects HTTP failures.
async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok)
    throw new Error(
      `Media tool download failed: HTTP ${response.status} (${url})`,
    );
  return Buffer.from(await response.arrayBuffer());
}

// Returns bytes only if they match the committed release digest.
async function verifiedAsset(tool, name) {
  const checksum = tool.sha256[name];
  if (!/^[a-f0-9]{64}$/.test(checksum ?? ''))
    throw new Error(`Missing media tool checksum: ${name}`);
  const bytes = await fetchBytes(
    `https://github.com/${tool.repository}/releases/download/${tool.version}/${name}`,
  );
  if (digest(bytes) !== checksum)
    throw new Error(`Media tool checksum mismatch: ${name}`);
  return bytes;
}

// Reuses verified files or atomically replaces them from the pinned upstream release.
async function prepareFile(tool, name, destination, executable = false) {
  const cached = await readFile(destination).catch(() => null);
  if (!cached || digest(cached) !== tool.sha256[name]) {
    const bytes = await verifiedAsset(tool, name);
    await writeFile(`${destination}.tmp`, bytes);
    await rename(`${destination}.tmp`, destination);
  }
  if (executable && process.platform !== 'win32')
    await chmod(destination, 0o755);
}

// Extracts the standalone Deno executable after validating its entire release archive.
async function prepareDeno(tool, target, destination, filename) {
  const name = `deno-${target}.zip`;
  const metadataPath = `${destination}.json`;
  const metadata = await readFile(metadataPath, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  const cached = await readFile(destination).catch(() => null);
  if (
    !cached ||
    metadata?.archive !== tool.sha256[name] ||
    digest(cached) !== metadata?.binary
  ) {
    const bytes = await verifiedAsset(tool, name);
    const binary = unzipSync(bytes, {
      filter: (entry) => entry.name === filename,
    })[filename];
    if (!binary) throw new Error(`Deno archive does not contain ${filename}.`);
    await writeFile(`${destination}.tmp`, binary);
    await rename(`${destination}.tmp`, destination);
    await writeFile(
      metadataPath,
      JSON.stringify({ archive: tool.sha256[name], binary: digest(binary) }),
    );
  }
  if (process.platform !== 'win32') await chmod(destination, 0o755);
}

/** Prepares native tools for each supported app target, including both universal Mac slices.
 * @param {string} platform Target Electron platform.
 * @param {string} arch Target Electron architecture.
 */
export async function prepareMediaTools(
  platform = process.platform,
  arch = process.arch,
) {
  const architectures =
    platform === 'darwin' && arch === 'universal' ? ['x64', 'arm64'] : [arch];
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const directory = path.join(
    root,
    'vendor/media-tools/bin',
    `${platform}-${arch}`,
    'media-tools',
  );
  for (const architecture of architectures) {
    const target = targets[`${platform}-${architecture}`];
    if (!target)
      throw new Error(
        `Bundled media tools do not support ${platform}-${architecture}.`,
      );
    const native = path.join(directory, architecture);
    await mkdir(native, { recursive: true });
    // Windows ARM64 runs the standalone x64 FFmpeg build using built-in OS emulation.
    const ffmpegTarget =
      platform === 'win32' ? 'win32-x64' : `${platform}-${architecture}`;
    const suffix = platform === 'win32' ? '.exe' : '';
    for (const name of ['ffmpeg', 'ffprobe']) {
      await prepareFile(
        manifest.ffmpeg,
        `${name}-${ffmpegTarget}`,
        path.join(native, `${name}${suffix}`),
        true,
      );
    }
    for (const name of ['LICENSE', 'README']) {
      await prepareFile(
        manifest.ffmpeg,
        `${ffmpegTarget}.${name}`,
        path.join(native, `FFMPEG.${name}`),
      );
    }
    await prepareDeno(
      manifest.deno,
      target,
      path.join(native, `deno${suffix}`),
      `deno${suffix}`,
    );
  }
  const licensePath = path.join(directory, 'DENO.LICENSE.md');
  const cachedManifest = await readFile(
    path.join(directory, 'version.json'),
    'utf8',
  )
    .then(JSON.parse)
    .catch(() => null);
  const license = await readFile(licensePath).catch(() => null);
  if (!license || cachedManifest?.deno.version !== manifest.deno.version) {
    await writeFile(
      licensePath,
      await fetchBytes(
        `https://raw.githubusercontent.com/denoland/deno/${manifest.deno.version}/LICENSE.md`,
      ),
    );
  }
  await copyFile(manifestPath, path.join(directory, 'version.json'));
  console.log(
    `Prepared FFmpeg ${manifest.ffmpeg.version} and Deno ${manifest.deno.version} for ${platform}-${arch}`,
  );
  return directory;
}

// Updates all existing platform asset pins for one tool from an explicit upstream release.
async function updateManifest(name, version) {
  if (
    !['ffmpeg', 'deno'].includes(name) ||
    !/^[bv]\d+\.\d+\.\d+$/.test(version ?? '')
  ) {
    throw new Error(
      'Usage: npm run media-tools:update -- ffmpeg bX.Y.Z | deno vX.Y.Z',
    );
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const tool = manifest[name];
  const release = JSON.parse(
    (
      await fetchBytes(
        `https://api.github.com/repos/${tool.repository}/releases/tags/${version}`,
      )
    ).toString(),
  );
  const sha256 = {};
  for (const asset of Object.keys(tool.sha256)) {
    const checksum = release.assets
      .find((entry) => entry.name === asset)
      ?.digest?.replace(/^sha256:/, '');
    if (!/^[a-f0-9]{64}$/.test(checksum ?? ''))
      throw new Error(`Missing upstream checksum: ${asset}`);
    sha256[asset] = checksum;
  }
  manifest[name] = { ...tool, version, sha256 };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Pinned ${name} ${version}. Review and commit vendor/media-tools/manifest.json, then rebuild.`,
  );
}

// Prepares the host toolchain or refreshes a deliberately selected dependency version.
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  try {
    if (process.argv[2] === 'update')
      await updateManifest(process.argv[3], process.argv[4]);
    else await prepareMediaTools();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
