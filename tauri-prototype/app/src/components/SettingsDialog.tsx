import type { AppUpdateInfo } from "../hooks/useAppUpdater";
import { UI_COPY } from "../localization";
import type {
  ClaudeCredentialStatus, ClaudeDiagnostic, ClaudeProvider, EverythingStatus,
  FolderIntegrationStatus, UiLanguage,
} from "../types";

type SettingsDialogProps = {
  language: UiLanguage;
  showExtensions: boolean;
  showHidden: boolean;
  appUpdate: AppUpdateInfo | null;
  appUpdateChecked: boolean;
  appUpdateBusy: boolean;
  appUpdateProgress: number | null;
  appUpdateError: string | null;
  preferEverything: boolean;
  everythingStatus: EverythingStatus | null;
  everythingStatusBusy: boolean;
  everythingStatusError: string | null;
  folderIntegration: FolderIntegrationStatus | null;
  folderIntegrationBusy: boolean;
  folderIntegrationError: string | null;
  folderContextMenu: FolderIntegrationStatus | null;
  folderContextMenuBusy: boolean;
  folderContextMenuError: string | null;
  claudeProvider: ClaudeProvider;
  claudeFullAccess: boolean;
  claudeCredential: ClaudeCredentialStatus | null;
  claudeApiKeyDraft: string;
  claudeCredentialBusy: boolean;
  claudeCredentialError: string | null;
  claudeDiagnostic: ClaudeDiagnostic | null;
  claudeDiagnosticBusy: boolean;
  onClose: () => void;
  onLanguageChange: (language: UiLanguage) => void;
  onToggleExtensions: () => void;
  onToggleHidden: () => void;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
  onToggleEverything: () => void;
  onToggleFolderIntegration: () => void;
  onToggleFolderContextMenu: () => void;
  onClaudeProviderChange: (provider: ClaudeProvider) => void;
  onToggleClaudeFullAccess: () => void;
  onClaudeApiKeyDraftChange: (value: string) => void;
  onSaveClaudeApiKey: () => void;
  onRemoveClaudeApiKey: () => void;
  onRunClaudeDiagnostic: () => void;
};

function diagnosticLabel(diagnostic: ClaudeDiagnostic, language: UiLanguage) {
  if (language === "en") {
    return ({ ready: "Claude Code and the selected API are ready.", claudeMissing: "Claude Code was not found on this computer.", missingKey: "No DeepSeek API credential was found.", networkError: "The API endpoint could not be reached.", authError: "The API rejected this credential.", serviceError: "The API returned a service error.", notAuthenticated: "Claude Code is not signed in to Anthropic." } as Record<ClaudeDiagnostic["status"], string>)[diagnostic.status];
  }
  return ({ ready: "Claude Code 与所选 API 均可正常使用。", claudeMissing: "这台电脑上没有找到 Claude Code。", missingKey: "没有找到 DeepSeek API 凭据。", networkError: "无法连接 API 地址，请检查网络或代理。", authError: "API 拒绝了当前密钥，请检查密钥是否有效。", serviceError: "API 服务返回异常状态。", notAuthenticated: "Claude Code 尚未登录 Anthropic。" } as Record<ClaudeDiagnostic["status"], string>)[diagnostic.status];
}

export function SettingsDialog(props: SettingsDialogProps) {
  const {
    language, showExtensions, showHidden, appUpdate, appUpdateChecked, appUpdateBusy,
    appUpdateProgress, appUpdateError, preferEverything, everythingStatus,
    everythingStatusBusy, everythingStatusError, folderIntegration, folderIntegrationBusy,
    folderIntegrationError, folderContextMenu, folderContextMenuBusy, folderContextMenuError,
    claudeProvider, claudeFullAccess, claudeCredential, claudeApiKeyDraft,
    claudeCredentialBusy, claudeCredentialError, claudeDiagnostic, claudeDiagnosticBusy,
    onClose, onLanguageChange, onToggleExtensions, onToggleHidden, onCheckForUpdates,
    onInstallUpdate, onToggleEverything, onToggleFolderIntegration, onToggleFolderContextMenu,
    onClaudeProviderChange, onToggleClaudeFullAccess, onClaudeApiKeyDraftChange,
    onSaveClaudeApiKey, onRemoveClaudeApiKey, onRunClaudeDiagnostic,
  } = props;
  const text = UI_COPY[language];

  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header><div><h2 id="settings-title">{text.settingsTitle}</h2><p>{text.settingsIntro}</p></div><button className="settings-close" aria-label={text.close} onClick={onClose}>×</button></header>
      <div className="settings-body">
        <div className="setting-row"><div><strong>{text.interfaceLanguage}</strong></div><div className="segmented"><button className={language === "zh-CN" ? "active" : ""} onClick={() => onLanguageChange("zh-CN")}>{text.chinese}</button><button className={language === "en" ? "active" : ""} onClick={() => onLanguageChange("en")}>{text.english}</button></div></div>
        <div className="setting-row"><div><strong>{text.fileExtensions}</strong><p>{text.extensionsHint}</p></div><button className={`switch ${showExtensions ? "on" : ""}`} role="switch" aria-checked={showExtensions} onClick={onToggleExtensions}><span /></button></div>
        <div className="setting-row"><div><strong>{text.hiddenItems}</strong><p>{text.hiddenHint}</p></div><button className={`switch ${showHidden ? "on" : ""}`} role="switch" aria-checked={showHidden} onClick={onToggleHidden}><span /></button></div>
        <div className="setting-row update-setting-row"><div><strong>{language === "zh-CN" ? "应用更新" : "Application updates"}</strong><p>{appUpdate ? (language === "zh-CN" ? `发现 Flow Files ${appUpdate.version}，当前版本 ${appUpdate.currentVersion}。安装前会验证发布签名。` : `Flow Files ${appUpdate.version} is available; current version ${appUpdate.currentVersion}. The release signature is verified before installation.`) : appUpdateChecked ? (language === "zh-CN" ? "当前已是最新公开版本。" : "You are running the latest published version.") : (language === "zh-CN" ? "从 GitHub 正式发布通道检查经过签名的更新，不会安装未签名文件。" : "Checks the official GitHub release channel for signed updates. Unsigned files are never installed.")}</p>{appUpdate?.body && <small>{appUpdate.body}</small>}{appUpdateError && <small className="integration-error">{appUpdateError}</small>}{appUpdateProgress !== null && <div className="update-progress"><i style={{ width: `${appUpdateProgress}%` }} /></div>}</div><div className="update-setting-actions">{appUpdate && <button className="primary" disabled={appUpdateBusy} onClick={onInstallUpdate}>{appUpdateBusy ? (language === "zh-CN" ? "正在安装…" : "Installing…") : (language === "zh-CN" ? "下载并安装" : "Download and install")}</button>}<button className="secondary" disabled={appUpdateBusy} onClick={onCheckForUpdates}>{appUpdateBusy && !appUpdate ? (language === "zh-CN" ? "正在检查…" : "Checking…") : (language === "zh-CN" ? "检查更新" : "Check for updates")}</button></div></div>
        <div className="setting-row folder-integration-row everything-setting-row"><div><strong>{language === "zh-CN" ? "Everything 秒级搜索" : "Everything instant search"}</strong><p>{language === "zh-CN" ? "优先使用本机 Everything 索引搜索子文件夹；不可用或筛选条件不适合时自动回退到 Flow Files 本地扫描。" : "Prefer the local Everything index for subfolder searches, with automatic fallback to Flow Files' native scan."}</p><small className={everythingStatus?.running && everythingStatus.databaseLoaded ? "integration-enabled" : ""}>{everythingStatusBusy ? (language === "zh-CN" ? "正在读取状态…" : "Checking status…") : everythingStatusError ? `${language === "zh-CN" ? "状态读取失败" : "Status unavailable"}: ${everythingStatusError}` : everythingStatus?.running && everythingStatus.databaseLoaded ? `${language === "zh-CN" ? "索引就绪" : "Index ready"}${everythingStatus.version ? ` · v${everythingStatus.version}` : ""}${everythingStatus.indexedDrives.length ? ` · ${everythingStatus.indexedDrives.join(" ")}` : ""}` : everythingStatus?.installed ? (language === "zh-CN" ? "已安装；首次搜索时会自动启动索引客户端" : "Installed; the index client starts on first search") : (language === "zh-CN" ? "未检测到 Everything；搜索会使用本地扫描" : "Everything not found; searches use the native scanner")}</small></div><button className={`switch ${preferEverything ? "on" : ""}`} role="switch" aria-checked={preferEverything} onClick={onToggleEverything}><span /></button></div>
        <div className="setting-row folder-integration-row"><div><strong>{text.windowsFolderIntegration}</strong><p>{text.windowsFolderIntegrationHint}</p><small className={folderIntegration?.enabled ? "integration-enabled" : ""}>{folderIntegration?.enabled ? text.windowsFolderIntegrationEnabled : text.windowsFolderIntegrationDisabled}</small>{folderIntegrationError && <small className="integration-error">{folderIntegrationError}</small>}</div><button className={`switch ${folderIntegration?.enabled ? "on" : ""}`} role="switch" aria-checked={!!folderIntegration?.enabled} disabled={folderIntegrationBusy} onClick={onToggleFolderIntegration}><span /></button></div>
        <div className="setting-row folder-integration-row context-menu-row"><div><strong>{text.explorerContextMenu}</strong><p>{text.explorerContextMenuHint}</p><small className={folderContextMenu?.enabled ? "integration-enabled" : ""}>{folderContextMenu?.enabled ? text.explorerContextMenuEnabled : text.explorerContextMenuDisabled}</small>{folderContextMenuError && <small className="integration-error">{folderContextMenuError}</small>}</div><button className={`switch ${folderContextMenu?.enabled ? "on" : ""}`} role="switch" aria-checked={!!folderContextMenu?.enabled} disabled={folderContextMenuBusy} onClick={onToggleFolderContextMenu}><span /></button></div>
        <div className="setting-row claude-provider-row"><div><strong>{text.claudeProvider}</strong></div><div className="segmented"><button className={claudeProvider === "anthropic" ? "active" : ""} onClick={() => onClaudeProviderChange("anthropic")}>{text.officialAnthropic}</button><button className={claudeProvider === "deepseek" ? "active" : ""} onClick={() => onClaudeProviderChange("deepseek")}>{text.deepseek}</button></div></div>
        <div className="setting-row claude-access-row"><div><strong>{text.claudeFullAccess}</strong><p>{text.claudeFullAccessHint}</p></div><button className={`switch ${claudeFullAccess ? "on" : ""}`} role="switch" aria-checked={claudeFullAccess} onClick={onToggleClaudeFullAccess}><span /></button></div>
        {claudeProvider === "deepseek" && <div className="claude-key-setting">
          <div className="claude-key-heading"><div><strong>{text.deepseekApiKey}</strong><p>{text.deepseekKeyHint}</p></div><span className={`credential-state ${(claudeCredential?.stored || claudeCredential?.environmentAvailable) ? "ready" : "missing"}`}>{claudeCredential?.stored ? text.keySaved : claudeCredential?.environmentAvailable ? text.keyFromEnvironment : text.keyMissing}</span></div>
          <div className="claude-key-controls"><input type="password" autoComplete="off" spellCheck={false} value={claudeApiKeyDraft} onChange={(event) => onClaudeApiKeyDraftChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSaveClaudeApiKey(); }} placeholder={claudeCredential?.stored ? "••••••••••••••••" : text.enterApiKey} /><button className="primary" disabled={claudeCredentialBusy || !claudeApiKeyDraft.trim()} onClick={onSaveClaudeApiKey}>{claudeCredential?.stored ? text.replaceKey : text.saveKey}</button>{claudeCredential?.stored && <button className="secondary" disabled={claudeCredentialBusy} onClick={onRemoveClaudeApiKey}>{text.removeKey}</button>}</div>
          {claudeCredentialError && <p className="claude-key-error">{claudeCredentialError}</p>}
        </div>}
        <div className="claude-diagnostic-setting">
          <div className="claude-diagnostic-heading"><div><strong>{text.claudeDiagnostics}</strong><p>{language === "zh-CN" ? "检查 Claude 命令、版本、凭据与 API 连通性。密钥不会显示或写入日志。" : "Check the Claude command, version, credential, and API connectivity. The key is never displayed or logged."}</p></div><button disabled={claudeDiagnosticBusy} onClick={onRunClaudeDiagnostic}>{claudeDiagnosticBusy ? text.testingConnection : text.testConnection}</button></div>
          {claudeDiagnostic && <div className={`claude-diagnostic-result ${claudeDiagnostic.status === "ready" ? "ready" : "problem"}`}>
            <div className="diagnostic-status"><strong>{claudeDiagnostic.status === "ready" ? text.diagnosticReady : text.diagnosticMissing}</strong><span>{diagnosticLabel(claudeDiagnostic, language)}</span></div>
            <dl><div><dt>{text.diagnosticVersion}</dt><dd>{claudeDiagnostic.claudeFound ? claudeDiagnostic.version ?? text.credentialAvailable : text.credentialUnavailable}</dd></div><div><dt>{text.diagnosticEndpoint}</dt><dd title={claudeDiagnostic.endpoint}>{claudeDiagnostic.endpoint || "—"}</dd></div><div><dt>{text.diagnosticCredential}</dt><dd>{claudeDiagnostic.keyAvailable ? text.credentialAvailable : text.credentialUnavailable}</dd></div>{claudeDiagnostic.balanceAvailable !== null && <div><dt>{text.diagnosticBalance}</dt><dd>{claudeDiagnostic.balanceAvailable ? (language === "zh-CN" ? "是" : "Yes") : (language === "zh-CN" ? "否" : "No")}</dd></div>}</dl>
            {claudeDiagnostic.status !== "ready" && claudeDiagnostic.message && <small>{claudeDiagnostic.message}</small>}
          </div>}
        </div>
      </div>
      <div className="settings-footer"><button onClick={onClose}>{text.close}</button></div>
    </section>
  </div>;
}
