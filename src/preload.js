const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("gfxConv", {
  chooseOutputDir: () => ipcRenderer.invoke("dialog:chooseOutputDir"),
  convertFiles: (payload) => ipcRenderer.invoke("convert:files", payload),
  openPath: (targetPath) => ipcRenderer.invoke("shell:openPath", targetPath),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  checkUpdates: () => ipcRenderer.invoke("updates:check"),
  getFilePath: (file) => webUtils.getPathForFile(file),
  onConversionProgress: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on("convert:progress", listener);
    return () => ipcRenderer.removeListener("convert:progress", listener);
  }
});
