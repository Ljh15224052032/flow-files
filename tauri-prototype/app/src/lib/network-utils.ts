import type { DirectoryStatus, UiLanguage } from "../types";

export type AvailabilityRetry = { failures: number; nextAt: number };

export function unavailableLocationCopy(status: DirectoryStatus, language: UiLanguage) {
  if (language === "zh-CN") {
    if (status.reason === "accessDenied") return { title: "位置存在，但当前账号无权访问", detail: "请检查共享凭据或文件夹权限；Flow Files 会在后台自动重试，并逐步延长间隔。" };
    if (status.reason === "notFound") return { title: "位置已移动或设备已断开", detail: "重新连接磁盘或确认路径后，Flow Files 会自动恢复。" };
    if (status.reason === "unreachable") return { title: status.kind === "network" ? "网络位置暂时不可达" : "驱动器暂时不可达", detail: "请检查设备、网络或 VPN；Flow Files 会在后台自动重试，并逐步延长间隔。" };
    if (status.reason === "timeout") return { title: "位置响应超时", detail: "检测已转入后台并延长重试间隔，不会持续阻塞文件浏览。" };
    return { title: status.kind === "network" ? "网络位置不可用" : "驱动器或文件夹已断开", detail: "当前内容会保留；Flow Files 会在后台自动重试。" };
  }
  if (status.reason === "accessDenied") return { title: "The location exists, but access was denied", detail: "Check the share credentials or folder permissions. Flow Files retries in the background with progressively longer intervals." };
  if (status.reason === "notFound") return { title: "The location moved or the device disconnected", detail: "Reconnect the drive or verify the path; Flow Files will recover automatically." };
  if (status.reason === "unreachable") return { title: status.kind === "network" ? "Network location is unreachable" : "Drive is unreachable", detail: "Check the device, network, or VPN. Flow Files retries in the background with progressively longer intervals." };
  if (status.reason === "timeout") return { title: "Location check timed out", detail: "The check continues in the background with a longer retry interval, without blocking file browsing." };
  return { title: status.kind === "network" ? "Network location unavailable" : "Drive or folder disconnected", detail: "The current view is preserved. Flow Files retries automatically in the background." };
}

export function nextAvailabilityRetry(previousFailures: number, now = Date.now()): AvailabilityRetry {
  const failures = Math.min(Math.max(0, previousFailures) + 1, 5);
  const delay = Math.min(120_000, 8_000 * (2 ** Math.max(0, failures - 1)));
  return { failures, nextAt: now + delay };
}

export function availabilityRetryAfterStatus(previous: AvailabilityRetry | undefined, status: DirectoryStatus, now = Date.now()) {
  return status.available ? null : nextAvailabilityRetry(previous?.failures ?? 0, now);
}
