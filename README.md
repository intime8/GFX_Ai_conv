# GFX Ai Conv

Local Windows converter with a small drag-and-drop interface.

## Modes

- **PNG**: converts supported image/video sources to `.png`.
- **H.264 MP4**: converts supported video sources to `.mp4` with H.264 video, BT.709/sRGB-friendly color metadata, integer duration from 4 to 15 seconds, and optional 16 px dimension alignment.

FFmpeg is bundled with the app through `ffmpeg-static`.

## Local Development

```powershell
npm.cmd install
npm.cmd run dev
```

## Build Locally

```powershell
npm.cmd run dist
```

The Windows installer and unpacked zip are written to `dist/`.

## GitHub Release Build

Push a version tag to build a release automatically:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

GitHub Actions will build the Windows installer `.exe` and unpacked `.zip`, then attach them to a GitHub Release.

## Updates

The app checks the latest GitHub Release at startup and from the update button in the header. In this first version it opens the release page for download instead of silently installing updates.

## Windows Downloads

- Use the `installer` `.exe` for normal installation.
- Use the `unpacked` `.zip` if you want to run without installing.

The Electron portable self-extracting target is intentionally not used because it can crash on some Windows systems when launched from a temporary extraction folder.

## Notes

H.264 is normally a lossy delivery codec. The default video quality is set to visually lossless CRF 16. A lossless H.264 option is available, but files can become much larger and may be less convenient for downstream tools.
