const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ffmpegStaticPath = require("ffmpeg-static");

const REPO_OWNER = "intime8";
const REPO_NAME = "GFX_Ai_conv";
const appDataRoot = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const stableUserDataPath = path.join(appDataRoot, "GFX Ai Conv");
const logDir = path.join(stableUserDataPath, "logs");
const settingsPath = path.join(stableUserDataPath, "settings.json");
const DEFAULT_SETTINGS = {
  mode: "png",
  outputDir: "",
  video: {
    durationSeconds: 4,
    align16: true,
    quality: "visual"
  }
};

app.disableHardwareAcceleration();
fs.mkdirSync(stableUserDataPath, { recursive: true });
app.setPath("userData", stableUserDataPath);
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disable-gpu-program-cache");

fs.mkdirSync(logDir, { recursive: true });

process.on("uncaughtException", (error) => {
  writeCrashLog("uncaughtException", error);
  dialog.showErrorBox("GFX Ai Conv crashed", error.stack || error.message || String(error));
  app.quit();
});

process.on("unhandledRejection", (reason) => {
  writeCrashLog("unhandledRejection", reason);
});

function resolveBundledBinary(binaryPath) {
  if (!binaryPath) {
    return binaryPath;
  }

  return binaryPath.replace("app.asar", "app.asar.unpacked");
}

const ffmpegPath = resolveBundledBinary(ffmpegStaticPath);
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();

    if (!win) {
      return;
    }

    if (win.isMinimized()) {
      win.restore();
    }

    win.focus();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: "#f5f6f8",
    title: "GFX Ai Conv",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) {
    return;
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("dialog:chooseOutputDir", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose output folder",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("shell:openPath", async (_event, targetPath) => {
  if (!targetPath) {
    return;
  }

  await shell.openPath(targetPath);
});

ipcMain.handle("shell:openExternal", async (_event, url) => {
  if (!url) {
    return;
  }

  await shell.openExternal(url);
});

ipcMain.handle("app:getVersion", () => app.getVersion());

ipcMain.handle("settings:get", () => loadSettings());

ipcMain.handle("settings:save", (_event, settings) => {
  const nextSettings = sanitizeSettings(settings);
  saveSettings(nextSettings);
  return nextSettings;
});

ipcMain.handle("updates:check", async () => {
  const currentVersion = app.getVersion();
  const latestUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

  try {
    const response = await fetch(latestUrl, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": `${REPO_NAME}/${currentVersion}`
      }
    });

    if (response.status === 404) {
      return {
        ok: true,
        hasUpdate: false,
        currentVersion,
        message: "No GitHub Releases yet."
      };
    }

    if (!response.ok) {
      throw new Error(`GitHub responded with ${response.status}`);
    }

    const release = await response.json();
    const latestVersion = normalizeVersion(release.tag_name || release.name || "");

    return {
      ok: true,
      currentVersion,
      latestVersion,
      hasUpdate: isNewerVersion(latestVersion, currentVersion),
      releaseUrl: release.html_url,
      releaseName: release.name || release.tag_name
    };
  } catch (error) {
    return {
      ok: false,
      currentVersion,
      error: error.message
    };
  }
});

ipcMain.handle("convert:files", async (event, payload) => {
  const files = Array.isArray(payload.files) ? payload.files : [];
  const outputDir = payload.outputDir;
  const mode = payload.mode;
  const settings = payload.settings || {};

  if (!outputDir || !fs.existsSync(outputDir)) {
    throw new Error("Output folder does not exist.");
  }

  if (!["png", "video"].includes(mode)) {
    throw new Error("Unknown conversion mode.");
  }

  const results = [];

  for (const file of files) {
    const inputPath = file.path;
    const id = file.id;

    if (!inputPath || !fs.existsSync(inputPath)) {
      const errorResult = { id, inputPath, status: "error", error: "Input file does not exist." };
      event.sender.send("convert:progress", errorResult);
      results.push(errorResult);
      continue;
    }

    event.sender.send("convert:progress", { id, inputPath, status: "converting" });

    try {
      const outputPath = await convertOne(inputPath, outputDir, mode, settings);
      const doneResult = { id, inputPath, outputPath, status: "done" };
      event.sender.send("convert:progress", doneResult);
      results.push(doneResult);
    } catch (error) {
      const failResult = { id, inputPath, status: "error", error: error.message };
      event.sender.send("convert:progress", failResult);
      results.push(failResult);
    }
  }

  return results;
});

async function convertOne(inputPath, outputDir, mode, settings) {
  if (mode === "png") {
    const outputPath = uniqueOutputPath(outputDir, inputPath, ".png");
    const args = [
      "-hide_banner",
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-update",
      "1",
      "-compression_level",
      "6",
      outputPath
    ];

    await runFfmpeg(args);
    return outputPath;
  }

  const outputPath = uniqueOutputPath(outputDir, inputPath, ".mp4", "_h264");
  const duration = clampInteger(settings.durationSeconds, 4, 15, 4);
  const filters = buildVideoFilters(Boolean(settings.align16));
  const qualityArgs = settings.quality === "lossless"
    ? ["-preset", "slow", "-crf", "0"]
    : ["-preset", "slow", "-crf", "16"];

  const args = [
    "-hide_banner",
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    inputPath,
    "-t",
    String(duration),
    "-map",
    "0:v:0",
    "-an",
    "-vf",
    filters,
    "-c:v",
    "libx264",
    ...qualityArgs,
    "-pix_fmt",
    "yuv420p",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "iec61966-2-1",
    "-colorspace",
    "bt709",
    "-movflags",
    "+faststart",
    outputPath
  ];

  await runFfmpeg(args);
  return outputPath;
}

function buildVideoFilters(align16) {
  const scale = align16
    ? "scale=trunc(iw/16)*16:trunc(ih/16)*16:flags=lanczos"
    : "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos";

  return `${scale},format=yuv420p`;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(compactFfmpegError(stderr) || `FFmpeg exited with code ${code}.`));
    });
  });
}

function uniqueOutputPath(outputDir, inputPath, extension, suffix = "") {
  const parsed = path.parse(inputPath);
  const safeName = parsed.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "converted";
  let candidate = path.join(outputDir, `${safeName}${suffix}${extension}`);
  let index = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(outputDir, `${safeName}${suffix}_${index}${extension}`);
    index += 1;
  }

  return candidate;
}

function compactFfmpegError(stderr) {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.slice(-8).join("\n");
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);

  if (Number.isNaN(number)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, number));
}

function normalizeVersion(version) {
  return String(version || "").replace(/^v/i, "").trim();
}

function isNewerVersion(latest, current) {
  const latestParts = normalizeVersion(latest).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const currentParts = normalizeVersion(current).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(latestParts.length, currentParts.length);

  for (let index = 0; index < length; index += 1) {
    const latestPart = latestParts[index] || 0;
    const currentPart = currentParts[index] || 0;

    if (latestPart > currentPart) {
      return true;
    }

    if (latestPart < currentPart) {
      return false;
    }
  }

  return false;
}

function loadSettings() {
  try {
    if (!fs.existsSync(settingsPath)) {
      return { ...DEFAULT_SETTINGS, video: { ...DEFAULT_SETTINGS.video } };
    }

    const raw = fs.readFileSync(settingsPath, "utf8");
    return sanitizeSettings(JSON.parse(raw));
  } catch (error) {
    writeCrashLog("settingsLoad", error);
    return { ...DEFAULT_SETTINGS, video: { ...DEFAULT_SETTINGS.video } };
  }
}

function saveSettings(settings) {
  const tmpPath = `${settingsPath}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, settingsPath);
}

function sanitizeSettings(settings) {
  const incoming = settings && typeof settings === "object" ? settings : {};
  const incomingVideo = incoming.video && typeof incoming.video === "object" ? incoming.video : {};
  const mode = incoming.mode === "video" ? "video" : "png";
  const outputDir = typeof incoming.outputDir === "string" ? incoming.outputDir : "";
  const quality = incomingVideo.quality === "lossless" ? "lossless" : "visual";

  return {
    mode,
    outputDir,
    video: {
      durationSeconds: clampInteger(incomingVideo.durationSeconds, 4, 15, DEFAULT_SETTINGS.video.durationSeconds),
      align16: incomingVideo.align16 !== false,
      quality
    }
  };
}

function writeCrashLog(kind, error) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const message = error && error.stack ? error.stack : String(error);
    const body = `[${new Date().toISOString()}] ${kind}\n${message}\n`;
    fs.writeFileSync(path.join(logDir, `${timestamp}-${kind}.log`), body, "utf8");
  } catch (_error) {
    // Nothing else is safe to do here.
  }
}
