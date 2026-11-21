# Bundled yt-dlp

`manifest.json` pins the official release version and SHA-256 checksums for each supported executable. Forge prepares the target binary automatically for development and packaging, verifies its checksum, and includes it outside `app.asar` with its version metadata and upstream license notices. Generated binaries in `bin/` are ignored by Git. Checksums verify upstream files before packaging; macOS code signing may change the packaged executable. Its signing entitlement permits loading its embedded Python libraries.

To update: run `npm run yt-dlp:update -- YYYY.MM.DD`, review and commit the manifest, then rebuild. Run `npm run yt-dlp:prepare` to prepare the current platform manually. Runtime downloads always use the bundled binary; there is no system-PATH fallback or runtime self-update.

Standalone binaries are available for macOS x64/arm64, Windows x64/arm64/ia32, and Linux glibc x64/arm64. FFmpeg, FFprobe, and Deno are also prepared and bundled from `vendor/media-tools/manifest.json`. Downloaded executables require no user-installed Python, FFmpeg, or JavaScript runtime.
