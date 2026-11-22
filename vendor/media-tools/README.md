# Bundled media tools

`manifest.json` pins FFmpeg/FFprobe and Deno releases with SHA-256 checksums. Forge downloads and verifies the target resources during development and packaging. These tools and their notices are installed outside `app.asar`; users install no additional software. yt-dlp is given explicit FFmpeg and Deno locations and uses its bundled EJS scripts without fetching remote components.

Update pins with `npm run media-tools:update -- ffmpeg bX.Y.Z` or `npm run media-tools:update -- deno vX.Y.Z`. Review and commit the manifest, then rebuild. `npm run media-tools:prepare` prepares this machine's dependencies manually. Generated resources in `bin/` are Git-ignored.

Supported targets: macOS Intel/Apple Silicon (including universal builds), Linux glibc x64/arm64, and Windows x64/arm64. Windows ARM64 uses native Deno and the x64 FFmpeg binaries through Windows' built-in emulation. There is no 32-bit Deno distribution, so complete 32-bit app builds are rejected.

FFmpeg's upstream build license and README are included per architecture; Deno's license and both projects' release pins accompany the resources. Upstream source: <https://github.com/eugeneware/ffmpeg-static> and <https://github.com/denoland/deno>. Source links and build information for FFmpeg are recorded in its bundled README. macOS code signing may change executable bytes after download verification.
