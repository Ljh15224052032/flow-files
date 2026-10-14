import { useState } from "react";
import { check as checkForAppUpdate } from "@tauri-apps/plugin-updater";
import type { UiLanguage } from "../types";

export type AppUpdateInfo = {
  version: string;
  currentVersion: string;
  body: string | null;
  date: string | null;
};

export function useAppUpdater(language: UiLanguage) {
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null);
  const [appUpdateChecked, setAppUpdateChecked] = useState(false);
  const [appUpdateBusy, setAppUpdateBusy] = useState(false);
  const [appUpdateProgress, setAppUpdateProgress] = useState<number | null>(null);
  const [appUpdateError, setAppUpdateError] = useState<string | null>(null);

  async function checkForUpdates() {
    setAppUpdateBusy(true);
    setAppUpdateError(null);
    setAppUpdateProgress(null);
    try {
      const update = await checkForAppUpdate({ timeout: 15_000 });
      setAppUpdate(update ? { version: update.version, currentVersion: update.currentVersion, body: update.body ?? null, date: update.date ?? null } : null);
      setAppUpdateChecked(true);
      await update?.close();
    } catch (error) {
      setAppUpdateError(language === "zh-CN" ? `无法检查更新：${String(error)}` : `Could not check for updates: ${String(error)}`);
    } finally {
      setAppUpdateBusy(false);
    }
  }

  async function installAvailableUpdate() {
    setAppUpdateBusy(true);
    setAppUpdateError(null);
    setAppUpdateProgress(0);
    try {
      const update = await checkForAppUpdate({ timeout: 30_000 });
      if (!update) {
        setAppUpdate(null);
        setAppUpdateChecked(true);
        setAppUpdateProgress(null);
        return;
      }
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        setAppUpdateProgress(total > 0 ? Math.min(100, downloaded / total * 100) : null);
      });
    } catch (error) {
      setAppUpdateError(language === "zh-CN" ? `更新安装失败：${String(error)}` : `Update installation failed: ${String(error)}`);
      setAppUpdateProgress(null);
    } finally {
      setAppUpdateBusy(false);
    }
  }

  return { appUpdate, appUpdateChecked, appUpdateBusy, appUpdateProgress, appUpdateError, checkForUpdates, installAvailableUpdate };
}
