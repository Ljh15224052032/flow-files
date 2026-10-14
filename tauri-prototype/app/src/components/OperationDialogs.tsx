import { UI_COPY } from "../localization";
import type {
  ConflictChoice,
  DeleteRequest,
  OperationIssue,
  PendingTransfer,
  RetryTransfer,
  UiLanguage,
} from "../types";
import { formatDate, formatSize } from "../lib/format";
import { iconKindFor, parentDirectory } from "../lib/file-utils";
import { EntryIcon } from "./Icons";

type ConflictDialogProps = {
  pending: PendingTransfer;
  applyToRemaining: boolean;
  language: UiLanguage;
  onApplyToRemainingChange: (value: boolean) => void;
  onCancel: () => void;
  onResolve: (choice: ConflictChoice) => void;
};

export function ConflictDialog({ pending, applyToRemaining, language, onApplyToRemainingChange, onCancel, onResolve }: ConflictDialogProps) {
  const text = UI_COPY[language];
  const conflict = pending.conflicts[pending.currentIndex];
  if (!conflict) return null;

  return (
    <div className="settings-backdrop">
      <section className="settings-panel conflict-panel" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <header>
          <div><h2 id="conflict-title">{text.conflictTitle}</h2><p>{text.conflictProgress} {pending.currentIndex + 1} / {pending.conflicts.length} · {text.conflictIntro}</p></div>
          <button className="settings-close" aria-label={text.cancel} onClick={onCancel}>×</button>
        </header>
        <div className="conflict-compare">
          {[{ label: text.sourceItem, entry: conflict.source }, { label: text.targetItem, entry: conflict.target }].map(({ label, entry }) => (
            <article key={`${label}-${entry.path}`}>
              <span>{label}</span>
              <div><i className={`entry-icon ${iconKindFor(entry)}-icon`}><EntryIcon entry={entry} /></i><strong title={entry.path}>{entry.name}</strong></div>
              <small>{entry.isDirectory ? text.folder : formatSize(entry.size)} · {formatDate(entry.modifiedUnixSeconds, language)}</small>
              <em title={entry.path}>{parentDirectory(entry.path)}</em>
            </article>
          ))}
        </div>
        {pending.conflicts.length - pending.currentIndex > 1 && (
          <label className="conflict-apply">
            <input type="checkbox" checked={applyToRemaining} onChange={(event) => onApplyToRemainingChange(event.target.checked)} />
            <span>{text.applyRemaining}</span>
          </label>
        )}
        <p className="conflict-warning">{text.replaceNoUndo}</p>
        <div className="conflict-actions">
          <button onClick={onCancel}>{text.cancel}</button>
          <button onClick={() => onResolve("skip")}>{text.skip}</button>
          <button onClick={() => onResolve("keepBoth")}>{text.keepBoth}</button>
          <button className="primary" onClick={() => onResolve("replace")}>{text.replace}</button>
        </div>
      </section>
    </div>
  );
}

type OperationIssuesDialogProps = {
  issues: OperationIssue[];
  retry: RetryTransfer | null;
  language: UiLanguage;
  onClose: () => void;
  onRetryAll: () => void;
  onRetryIssue: (issue: OperationIssue) => void;
};

function operationIssueLabel(code: OperationIssue["code"], language: UiLanguage) {
  const labels = language === "zh-CN"
    ? { accessDenied: "没有访问权限", inUse: "文件正在被其他程序使用", diskFull: "磁盘空间不足", pathTooLong: "路径过长", network: "网络位置不可用", notFound: "文件已不存在", other: "文件系统错误" }
    : { accessDenied: "Access denied", inUse: "File is in use", diskFull: "Not enough disk space", pathTooLong: "Path is too long", network: "Network location unavailable", notFound: "Item no longer exists", other: "File system error" };
  return labels[code];
}

export function OperationIssuesDialog({ issues, retry, language, onClose, onRetryAll, onRetryIssue }: OperationIssuesDialogProps) {
  const text = UI_COPY[language];
  return (
    <div className="settings-backdrop">
      <section className="settings-panel issue-panel" role="dialog" aria-modal="true" aria-labelledby="issue-title">
        <header>
          <div><h2 id="issue-title">{text.issueTitle}</h2><p>{text.issueIntro}</p></div>
          <button className="settings-close" aria-label={text.close} onClick={onClose}>×</button>
        </header>
        <div className="issue-list">
          {issues.map((issue, index) => {
            const canRetrySingle = retry?.clipboard.paths.some((path) => path.toLocaleLowerCase() === issue.path.toLocaleLowerCase());
            return (
              <article key={`${issue.path}-${index}`}>
                <strong>{operationIssueLabel(issue.code, language)}</strong>
                <span title={issue.path}>{issue.path}</span>
                <small>{issue.message}</small>
                {canRetrySingle && <button onClick={() => onRetryIssue(issue)}>{language === "zh-CN" ? "仅重试此项" : "Retry this item"}</button>}
              </article>
            );
          })}
        </div>
        <div className="settings-footer issue-footer">
          {retry && <button className="secondary" onClick={onRetryAll}>{text.retryFailed}</button>}
          <button onClick={onClose}>{text.close}</button>
        </div>
      </section>
    </div>
  );
}

type DeleteConfirmationDialogProps = {
  request: DeleteRequest;
  language: UiLanguage;
  onCancel: () => void;
  onConfirm: () => void;
};

export function DeleteConfirmationDialog({ request, language, onCancel, onConfirm }: DeleteConfirmationDialogProps) {
  const text = UI_COPY[language];
  return (
    <div className="settings-backdrop">
      <section className="settings-panel delete-panel" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
        <header>
          <div><h2 id="delete-title">{request.permanent ? text.permanentDeleteTitle : text.deleteTitle}</h2><p>{request.permanent ? text.permanentWarning : text.deleteWarning}</p></div>
          <button className="settings-close" aria-label={text.cancel} onClick={onCancel}>×</button>
        </header>
        <div className="delete-list">
          {request.names.slice(0, 5).map((name, index) => <span key={`${name}-${index}`} title={name}>{name}</span>)}
          {request.names.length > 5 && <small>{language === "zh-CN" ? `另有 ${request.names.length - 5} 个项目` : `${request.names.length - 5} more item(s)`}</small>}
        </div>
        <div className="conflict-actions">
          <button onClick={onCancel}>{text.cancel}</button>
          <button className={request.permanent ? "danger-primary" : "primary"} onClick={onConfirm}>{request.permanent ? text.confirmPermanentDelete : text.confirmDelete}</button>
        </div>
      </section>
    </div>
  );
}
