const state = {
  mode: "png",
  outputDir: "",
  files: new Map(),
  converting: false
};

const modeButtons = document.querySelectorAll(".mode-button");
const outputDirInput = document.querySelector("#outputDir");
const chooseOutputButton = document.querySelector("#chooseOutput");
const dropzone = document.querySelector("#dropzone");
const filePicker = document.querySelector("#filePicker");
const fileList = document.querySelector("#fileList");
const videoSettings = document.querySelector("#videoSettings");
const durationInput = document.querySelector("#durationInput");
const align16Input = document.querySelector("#align16Input");
const qualityInput = document.querySelector("#qualityInput");
const openOutputButton = document.querySelector("#openOutput");
const toast = document.querySelector("#toast");
const versionLabel = document.querySelector("#versionLabel");
const updateButton = document.querySelector("#updateButton");

init();

async function init() {
  bindEvents();
  await hydrateVersion();
  checkUpdates(false);

  window.gfxConv.onConversionProgress((update) => {
    const current = state.files.get(update.id);

    if (!current) {
      return;
    }

    state.files.set(update.id, {
      ...current,
      ...update
    });
    renderFileList();
  });
}

function bindEvents() {
  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      modeButtons.forEach((item) => item.classList.toggle("active", item === button));
      videoSettings.classList.toggle("hidden", state.mode !== "video");
    });
  });

  chooseOutputButton.addEventListener("click", async () => {
    const selectedDir = await window.gfxConv.chooseOutputDir();

    if (!selectedDir) {
      return;
    }

    state.outputDir = selectedDir;
    outputDirInput.value = selectedDir;
  });

  openOutputButton.addEventListener("click", () => {
    if (!state.outputDir) {
      showToast("Choose an output folder first.");
      return;
    }

    window.gfxConv.openPath(state.outputDir);
  });

  updateButton.addEventListener("click", () => checkUpdates(true));

  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
  });

  dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragover");
    await addFiles(event.dataTransfer.files);
  });

  filePicker.addEventListener("change", async () => {
    await addFiles(filePicker.files);
    filePicker.value = "";
  });
}

async function hydrateVersion() {
  const version = await window.gfxConv.getVersion();
  versionLabel.textContent = `v${version}`;
}

async function addFiles(fileListLike) {
  if (!state.outputDir) {
    showToast("Choose an output folder first.");
    return;
  }

  const files = Array.from(fileListLike || [])
    .map((file) => ({
      id: crypto.randomUUID(),
      path: window.gfxConv.getFilePath(file),
      name: file.name,
      status: "queued"
    }))
    .filter((file) => file.path);

  if (files.length === 0) {
    showToast("No readable files were added.");
    return;
  }

  files.forEach((file) => state.files.set(file.id, file));
  renderFileList();
  await startConversion(files);
}

async function startConversion(files) {
  state.converting = true;
  setControlsDisabled(true);

  try {
    await window.gfxConv.convertFiles({
      mode: state.mode,
      outputDir: state.outputDir,
      files,
      settings: getSettings()
    });
  } catch (error) {
    showToast(error.message || "Conversion failed.");
  } finally {
    state.converting = false;
    setControlsDisabled(false);
  }
}

function getSettings() {
  return {
    durationSeconds: durationInput.value,
    align16: align16Input.checked,
    quality: qualityInput.value === "lossless" ? "lossless" : "visual"
  };
}

function setControlsDisabled(disabled) {
  chooseOutputButton.disabled = disabled;
  modeButtons.forEach((button) => {
    button.disabled = disabled;
  });
}

function renderFileList() {
  const items = Array.from(state.files.values()).reverse();

  if (items.length === 0) {
    fileList.innerHTML = "";
    return;
  }

  fileList.innerHTML = items.map((file) => {
    const detail = file.error || file.outputPath || file.path;
    const action = file.outputPath
      ? `<button type="button" data-open="${escapeHtml(file.outputPath)}">Open</button>`
      : "";

    return `
      <li class="file-item">
        <div>
          <div class="file-name" title="${escapeHtml(file.path)}">${escapeHtml(file.name || file.path)}</div>
          <div class="file-detail" title="${escapeHtml(detail || "")}">${escapeHtml(detail || "")}</div>
        </div>
        <span class="pill ${escapeHtml(file.status)}">${escapeHtml(file.status)}</span>
        ${action}
      </li>
    `;
  }).join("");

  fileList.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      window.gfxConv.openPath(button.dataset.open);
    });
  });
}

async function checkUpdates(showNoUpdate) {
  updateButton.disabled = true;

  try {
    const result = await window.gfxConv.checkUpdates();

    if (!result.ok) {
      if (showNoUpdate) {
        showToast(`Update check failed: ${result.error}`);
      }
      return;
    }

    if (result.hasUpdate && result.releaseUrl) {
      showToast(`Update available: ${result.releaseName || result.latestVersion}`);
      await window.gfxConv.openExternal(result.releaseUrl);
      return;
    }

    if (showNoUpdate) {
      showToast("You are on the latest version.");
    }
  } finally {
    updateButton.disabled = false;
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 4200);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
