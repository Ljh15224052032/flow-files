use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use fs2::FileExt;
use image::{
    codecs::{jpeg::JpegEncoder, png::PngEncoder},
    ImageEncoder, ImageReader,
};
use lofty::{
    file::{AudioFile, TaggedFileExt},
    tag::Accessor,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(windows)]
use std::os::windows::{ffi::OsStrExt, fs::MetadataExt};
use std::{
    cell::RefCell,
    cmp::Reverse,
    collections::{BinaryHeap, HashMap, HashSet},
    env,
    ffi::OsStr,
    fs,
    io::{BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

mod path_policy;
use path_policy::{is_inside, keep_both_path, validate_leaf_name};
mod error_policy;
use error_policy::{classify_operation_issue, directory_unavailable_reason};
mod text_encoding;
use text_encoding::decode_text_preview;
mod transfer_rate;
use transfer_rate::target_elapsed;
#[cfg(windows)]
use windows::{
    core::{w, PCSTR, PCWSTR, PWSTR},
    Win32::{
        Foundation::{
            GlobalFree, ERROR_NOT_FOUND, HANDLE, HGLOBAL, HINSTANCE, HWND, LPARAM, LRESULT, POINT,
            SIZE, WAIT_OBJECT_0, WPARAM,
        },
        Graphics::Gdi::{
            CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, BITMAPINFO, BITMAPINFOHEADER,
            BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
        },
        Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
        Storage::FileSystem::{
            FindCloseChangeNotification, FindFirstChangeNotificationW, FindNextChangeNotification,
            FILE_NOTIFY_CHANGE_DIR_NAME, FILE_NOTIFY_CHANGE_FILE_NAME,
            FILE_NOTIFY_CHANGE_LAST_WRITE, FILE_NOTIFY_CHANGE_SIZE,
        },
        System::Registry::{
            RegCloseKey, RegCreateKeyW, RegDeleteTreeW, RegDeleteValueW, RegOpenKeyExW,
            RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE,
            KEY_READ, KEY_WRITE, REG_SZ,
        },
        System::{
            Com::{
                CoInitializeEx, CoTaskMemFree, CoUninitialize, IBindCtx, IDataObject,
                COINIT_APARTMENTTHREADED,
            },
            DataExchange::{
                CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard,
                RegisterClipboardFormatW, SetClipboardData, COPYDATASTRUCT,
            },
            LibraryLoader::GetModuleHandleW,
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
            Ole::{
                IDropSource, OleInitialize, OleUninitialize, DROPEFFECT, DROPEFFECT_COPY,
                DROPEFFECT_LINK, DROPEFFECT_MOVE,
            },
            Threading::WaitForSingleObject,
        },
        UI::{
            Shell::{
                BHID_DataObject, DragQueryFileW, IContextMenu, IShellFolder,
                IShellItemImageFactory, SHBindToParent, SHCreateItemFromParsingName,
                SHCreateShellItemArrayFromIDLists, SHDoDragDrop, SHObjectProperties,
                SHParseDisplayName, ShellExecuteW, CMF_NORMAL, CMINVOKECOMMANDINFO, HDROP,
                SHOP_FILEPATH, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
            },
            WindowsAndMessaging::{
                CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DestroyWindow,
                DispatchMessageW, FindWindowW, GetCursorPos, GetMessageW, KillTimer,
                PostQuitMessage, RegisterClassW, SendMessageW, SetForegroundWindow, SetTimer,
                TrackPopupMenuEx, TranslateMessage, MSG, SW_SHOWNORMAL, TPM_RETURNCMD,
                TPM_RIGHTBUTTON, WINDOW_EX_STYLE, WINDOW_STYLE, WM_COPYDATA, WM_TIMER, WM_USER,
                WNDCLASSW,
            },
        },
    },
};

const MAX_THUMBNAIL_BATCH: usize = 16;
const MAX_ICON_BATCH: usize = 32;
const THUMBNAIL_EDGE: u32 = 160;
const FILE_ICON_EDGE: i32 = 48;
const PREVIEW_EDGE: u32 = 1400;
const MAX_TEXT_PREVIEW_BYTES: u64 = 128 * 1024;
const MAX_SEARCH_RESULTS: usize = 20_000;
const MAX_EVERYTHING_CANDIDATES: usize = 60_000;
const DUPLICATE_MINIMUM_BYTES: u64 = 1024 * 1024;
const DUPLICATE_QUICK_SAMPLE_BYTES: usize = 64 * 1024;
#[cfg(windows)]
const DEEPSEEK_CREDENTIAL_TARGET: PCWSTR = w!("Flow Files/Claude Code/DeepSeek API Key");

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    name: String,
    path: String,
    is_directory: bool,
    size: u64,
    modified_unix_seconds: Option<u64>,
    extension: Option<String>,
    is_hidden: bool,
    is_link: bool,
    link_target: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryListing {
    path: String,
    entries: Vec<FileEntry>,
    folder_count: usize,
    file_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Location {
    label: String,
    path: String,
    total_space: Option<u64>,
    available_space: Option<u64>,
    is_available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PathSuggestion {
    path: String,
    label: String,
    source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Thumbnail {
    path: String,
    data_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FilePreview {
    kind: String,
    data_url: Option<String>,
    text: Option<String>,
    truncated: bool,
    encoding: Option<String>,
    text_offset: u64,
    total_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileDetail {
    key: String,
    value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileDetails {
    items: Vec<FileDetail>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardPayload {
    paths: Vec<String>,
    mode: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalDragResult {
    effect: String,
}

#[derive(Clone, Serialize)]
struct DirectoryChanged {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchRequest {
    job_id: String,
    root: String,
    query: String,
    kind: String,
    modified_after: Option<u64>,
    min_size: Option<u64>,
    max_size: Option<u64>,
    include_hidden: bool,
    prefer_everything: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchProgress {
    job_id: String,
    scanned: usize,
    matches: usize,
    current_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResult {
    entries: Vec<FileEntry>,
    scanned: usize,
    cancelled: bool,
    truncated: bool,
    provider: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EverythingStatus {
    installed: bool,
    running: bool,
    database_loaded: bool,
    version: Option<String>,
    executable: Option<String>,
    indexed_drives: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateScanRequest {
    job_id: String,
    root: String,
    minimum_size: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateScanProgress {
    job_id: String,
    phase: String,
    scanned_files: usize,
    candidate_files: usize,
    processed_bytes: u64,
    current_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateGroup {
    signature: String,
    file_size: u64,
    reclaimable_bytes: u64,
    files: Vec<SpaceScanItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateScanResult {
    root: String,
    scanned_files: usize,
    candidate_files: usize,
    processed_bytes: u64,
    reclaimable_bytes: u64,
    issues: usize,
    cancelled: bool,
    truncated: bool,
    groups: Vec<DuplicateGroup>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateCleanupGroupRequest {
    keep_path: String,
    recycle_paths: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateCleanupRequest {
    root: String,
    groups: Vec<DuplicateCleanupGroupRequest>,
}

#[derive(Default)]
struct OperationControl {
    cancelled: AtomicBool,
    paused: AtomicBool,
    rate_limit_bytes_per_second: AtomicU64,
}

#[derive(Default)]
struct OperationJobs(Mutex<HashMap<String, Arc<OperationControl>>>);

#[derive(Default)]
struct DirectoryWatch(Arc<AtomicU64>);

#[derive(Default)]
struct SearchJobs(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Default)]
struct DuplicateScanJobs(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Default)]
struct DirectoryLoadJobs(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Default)]
struct ThumbnailJobs(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Default)]
struct FolderSizeJobs(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Default)]
struct SpaceScanJobs(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Default)]
struct PendingExternalTargets(Mutex<Vec<ExternalOpenTarget>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalOpenTarget {
    directory: String,
    selected_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderIntegrationStatus {
    enabled: bool,
    command: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryLoadProgress {
    job_id: String,
    path: String,
    entries: Vec<FileEntry>,
    scanned: usize,
    folder_count: usize,
    file_count: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderSizeProgress {
    job_id: String,
    total_bytes: u64,
    scanned_files: usize,
    scanned_folders: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderSizeResult {
    path: String,
    total_bytes: u64,
    scanned_files: usize,
    scanned_folders: usize,
    issues: usize,
    cancelled: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpaceScanProgress {
    job_id: String,
    scanned_bytes: u64,
    scanned_files: usize,
    scanned_folders: usize,
    issues: usize,
    current_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpaceScanItem {
    name: String,
    path: String,
    size: u64,
    modified_unix_seconds: Option<u64>,
    is_directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpaceScanCategory {
    id: String,
    risk: String,
    size: u64,
    file_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpaceCleanupPreview {
    root: String,
    category_id: String,
    risk: String,
    total_bytes: u64,
    total_files: usize,
    candidates: Vec<SpaceScanItem>,
    truncated: bool,
    issues: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpaceScanResult {
    root: String,
    total_space: u64,
    available_space: u64,
    scanned_bytes: u64,
    scanned_files: usize,
    scanned_folders: usize,
    issues: usize,
    skipped_reparse_points: usize,
    cancelled: bool,
    largest_files: Vec<SpaceScanItem>,
    largest_directories: Vec<SpaceScanItem>,
    categories: Vec<SpaceScanCategory>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryStatus {
    path: String,
    available: bool,
    kind: String,
    reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileOperationRequest {
    job_id: String,
    sources: Vec<String>,
    destination: String,
    mode: String,
    conflict: String,
    #[serde(default)]
    conflict_resolutions: Vec<ConflictResolution>,
    #[serde(default)]
    rate_limit_bytes_per_second: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConflictResolution {
    source: String,
    action: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConflictEntry {
    source: FileEntry,
    target: FileEntry,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathPair {
    from: String,
    to: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum UndoAction {
    DeleteCreated { paths: Vec<String> },
    Move { pairs: Vec<PathPair> },
    RestoreTrash { ids: Vec<String> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileOperationResult {
    completed: usize,
    skipped: usize,
    cancelled: bool,
    error: Option<String>,
    issues: Vec<OperationIssue>,
    undo: Option<UndoAction>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationIssue {
    path: String,
    code: String,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationProgress {
    job_id: String,
    processed_bytes: u64,
    total_bytes: u64,
    completed_items: usize,
    total_items: usize,
    current_name: String,
    phase: String,
    scanned_items: usize,
    scanned_bytes: u64,
}

fn app_error(message: impl Into<String>) -> String {
    message.into()
}

fn operation_issue(path: &Path, message: impl Into<String>) -> OperationIssue {
    let message = message.into();
    OperationIssue {
        path: public_path(path),
        code: classify_operation_issue(&message).into(),
        message,
    }
}

/// `canonicalize` returns Windows extended-length paths (for example `\\?\C:\…`).
/// They are useful to the OS but are an implementation detail, so never expose them
/// to the address bar or use them as the UI's path identity.
fn public_path(path: &Path) -> String {
    let raw = path.to_string_lossy();
    if let Some(unc_path) = raw.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{unc_path}");
    }
    raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string()
}

fn require_directory(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_dir() {
        return Err(app_error("The selected path is not an accessible folder."));
    }
    path.canonicalize()
        .map_err(|error| app_error(error.to_string()))
}

fn external_directory(path: &str) -> Result<String, String> {
    require_directory(path).map(|directory| public_path(&directory))
}

fn external_open_targets(args: &[String], cwd: &Path) -> Vec<ExternalOpenTarget> {
    let mut targets = Vec::new();
    for raw in args {
        let raw = raw.trim().trim_matches('"');
        if raw.is_empty() || raw.starts_with('-') {
            continue;
        }
        let candidate = PathBuf::from(raw);
        let candidate = if candidate.is_absolute() {
            candidate
        } else {
            cwd.join(candidate)
        };
        let canonical = match candidate.canonicalize() {
            Ok(path) => path,
            Err(_) => continue,
        };
        let target = if canonical.is_dir() {
            ExternalOpenTarget {
                directory: public_path(&canonical),
                selected_path: None,
            }
        } else if canonical.is_file() {
            let Some(parent) = canonical.parent() else {
                continue;
            };
            ExternalOpenTarget {
                directory: public_path(parent),
                selected_path: Some(public_path(&canonical)),
            }
        } else {
            continue;
        };
        let is_duplicate = targets.iter().any(|existing: &ExternalOpenTarget| {
            existing.directory.eq_ignore_ascii_case(&target.directory)
                && existing.selected_path.as_deref().map(str::to_lowercase)
                    == target.selected_path.as_deref().map(str::to_lowercase)
        });
        if !is_duplicate {
            targets.push(target);
        }
    }
    targets
}

fn queue_external_open_targets<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    args: &[String],
    cwd: &str,
) {
    let base = if cwd.trim().is_empty() {
        env::current_dir().unwrap_or_else(|_| PathBuf::from("C:\\"))
    } else {
        PathBuf::from(cwd)
    };
    let targets = external_open_targets(args, &base);
    if targets.is_empty() {
        return;
    }
    if let Ok(mut pending) = app.state::<PendingExternalTargets>().0.lock() {
        for target in &targets {
            let duplicate = pending.iter().any(|existing| {
                existing.directory.eq_ignore_ascii_case(&target.directory)
                    && existing.selected_path.as_deref().map(str::to_lowercase)
                        == target.selected_path.as_deref().map(str::to_lowercase)
            });
            if !duplicate {
                pending.push(target.clone());
            }
        }
    }
    let _ = app.emit("flow-open-targets", targets);
}

#[cfg(windows)]
const FOLDER_INTEGRATION_BACKUP_KEY: &str = "Software\\FlowFiles\\FolderIntegration";
#[cfg(windows)]
const FOLDER_INTEGRATION_CLASSES: [&str; 3] = ["Folder", "Directory", "Drive"];
#[cfg(windows)]
const FOLDER_CONTEXT_MENU_CLASSES: [&str; 3] = ["Folder", "Directory", "Drive"];
#[cfg(windows)]
const FOLDER_CONTEXT_MENU_VERB: &str = "FlowFiles.OpenHere";

#[cfg(windows)]
fn wide_registry(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}

#[cfg(windows)]
fn registry_read_string(
    key_path: &str,
    value_name: Option<&str>,
) -> Result<Option<String>, String> {
    registry_read_string_from(HKEY_CURRENT_USER, key_path, value_name)
}

#[cfg(windows)]
fn registry_read_string_from(
    root: HKEY,
    key_path: &str,
    value_name: Option<&str>,
) -> Result<Option<String>, String> {
    let mut key = HKEY::default();
    let path = wide_registry(key_path);
    let open = unsafe { RegOpenKeyExW(root, PCWSTR(path.as_ptr()), None, KEY_READ, &mut key) };
    if open.0 != 0 {
        return Ok(None);
    }
    let name = value_name.map(wide_registry);
    let name = name
        .as_ref()
        .map(|value| PCWSTR(value.as_ptr()))
        .unwrap_or(PCWSTR::null());
    let mut bytes = 0u32;
    let queried = unsafe { RegQueryValueExW(key, name, None, None, None, Some(&mut bytes)) };
    if queried.0 != 0 || bytes < 2 {
        unsafe {
            let _ = RegCloseKey(key);
        }
        return Ok(None);
    }
    let mut data = vec![0u8; bytes as usize];
    let read = unsafe {
        RegQueryValueExW(
            key,
            name,
            None,
            None,
            Some(data.as_mut_ptr()),
            Some(&mut bytes),
        )
    };
    unsafe {
        let _ = RegCloseKey(key);
    }
    if read.0 != 0 {
        return Err(app_error(format!(
            "Unable to read Windows integration setting ({})",
            read.0
        )));
    }
    let words = unsafe { std::slice::from_raw_parts(data.as_ptr() as *const u16, data.len() / 2) };
    Ok(Some(
        String::from_utf16_lossy(words)
            .trim_end_matches('\0')
            .to_string(),
    ))
}

#[cfg(windows)]
fn everything_service_executable() -> Option<PathBuf> {
    let command = registry_read_string_from(
        HKEY_LOCAL_MACHINE,
        "SYSTEM\\CurrentControlSet\\Services\\Everything",
        Some("ImagePath"),
    )
    .ok()
    .flatten()?;
    let trimmed = command.trim();
    let executable = if let Some(quoted) = trimmed.strip_prefix('"') {
        quoted.split('"').next().unwrap_or_default()
    } else {
        trimmed.split_whitespace().next().unwrap_or_default()
    };
    (!executable.is_empty()).then(|| PathBuf::from(executable))
}

#[cfg(windows)]
fn registry_write_string(
    key_path: &str,
    value_name: Option<&str>,
    value: &str,
) -> Result<(), String> {
    let mut key = HKEY::default();
    let path = wide_registry(key_path);
    let created = unsafe { RegCreateKeyW(HKEY_CURRENT_USER, PCWSTR(path.as_ptr()), &mut key) };
    if created.0 != 0 {
        return Err(app_error(format!(
            "Unable to create Windows integration setting ({})",
            created.0
        )));
    }
    let name = value_name.map(wide_registry);
    let name = name
        .as_ref()
        .map(|item| PCWSTR(item.as_ptr()))
        .unwrap_or(PCWSTR::null());
    let wide_value = wide_registry(value);
    let bytes = unsafe {
        std::slice::from_raw_parts(wide_value.as_ptr() as *const u8, wide_value.len() * 2)
    };
    let written = unsafe { RegSetValueExW(key, name, None, REG_SZ, Some(bytes)) };
    unsafe {
        let _ = RegCloseKey(key);
    }
    if written.0 != 0 {
        return Err(app_error(format!(
            "Unable to save Windows integration setting ({})",
            written.0
        )));
    }
    Ok(())
}

#[cfg(windows)]
fn registry_delete_value(key_path: &str, value_name: Option<&str>) -> Result<(), String> {
    let mut key = HKEY::default();
    let path = wide_registry(key_path);
    let open = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(path.as_ptr()),
            None,
            KEY_WRITE,
            &mut key,
        )
    };
    if open.0 != 0 {
        return Ok(());
    }
    let name = value_name.map(wide_registry);
    let name = name
        .as_ref()
        .map(|item| PCWSTR(item.as_ptr()))
        .unwrap_or(PCWSTR::null());
    let deleted = unsafe { RegDeleteValueW(key, name) };
    unsafe {
        let _ = RegCloseKey(key);
    }
    if deleted.0 != 0 && deleted.0 != 2 {
        return Err(app_error(format!(
            "Unable to restore Windows integration setting ({})",
            deleted.0
        )));
    }
    Ok(())
}

#[cfg(windows)]
fn registry_delete_tree(key_path: &str) {
    let path = wide_registry(key_path);
    unsafe {
        let _ = RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(path.as_ptr()));
    }
}

#[cfg(windows)]
fn folder_integration_command() -> Result<String, String> {
    let executable = env::current_exe().map_err(|error| app_error(error.to_string()))?;
    Ok(format!("\"{}\" \"%1\"", public_path(&executable)))
}

#[cfg(windows)]
fn folder_integration_status() -> Result<FolderIntegrationStatus, String> {
    let command = folder_integration_command()?;
    let enabled = FOLDER_INTEGRATION_CLASSES.iter().all(|class| {
        let shell_key = format!("Software\\Classes\\{class}\\shell");
        registry_read_string(&shell_key, None)
            .ok()
            .flatten()
            .as_deref()
            == Some("FlowFiles")
    });
    Ok(FolderIntegrationStatus { enabled, command })
}

#[cfg(windows)]
fn apply_folder_integration_enabled(enabled: bool) -> Result<FolderIntegrationStatus, String> {
    let command = folder_integration_command()?;
    if enabled {
        if folder_integration_status()?.enabled {
            return folder_integration_status();
        }
        for class in FOLDER_INTEGRATION_CLASSES {
            let shell_key = format!("Software\\Classes\\{class}\\shell");
            let previous = registry_read_string(&shell_key, None)?;
            registry_write_string(
                FOLDER_INTEGRATION_BACKUP_KEY,
                Some(&format!("{class}.hadDefault")),
                if previous.is_some() { "1" } else { "0" },
            )?;
            if let Some(previous) = previous {
                registry_write_string(
                    FOLDER_INTEGRATION_BACKUP_KEY,
                    Some(&format!("{class}.previousDefault")),
                    &previous,
                )?;
            } else {
                let _ = registry_delete_value(
                    FOLDER_INTEGRATION_BACKUP_KEY,
                    Some(&format!("{class}.previousDefault")),
                );
            }
            registry_write_string(&format!("{shell_key}\\FlowFiles\\command"), None, &command)?;
            registry_write_string(&shell_key, None, "FlowFiles")?;
        }
        registry_write_string(FOLDER_INTEGRATION_BACKUP_KEY, Some("enabled"), "1")?;
    } else {
        for class in FOLDER_INTEGRATION_CLASSES {
            let shell_key = format!("Software\\Classes\\{class}\\shell");
            let active = registry_read_string(&shell_key, None)?;
            if active.as_deref() == Some("FlowFiles") {
                let had_previous = registry_read_string(
                    FOLDER_INTEGRATION_BACKUP_KEY,
                    Some(&format!("{class}.hadDefault")),
                )?
                .as_deref()
                    == Some("1");
                if had_previous {
                    if let Some(previous) = registry_read_string(
                        FOLDER_INTEGRATION_BACKUP_KEY,
                        Some(&format!("{class}.previousDefault")),
                    )? {
                        registry_write_string(&shell_key, None, &previous)?;
                    } else {
                        registry_delete_value(&shell_key, None)?;
                    }
                } else {
                    registry_delete_value(&shell_key, None)?;
                }
            }
            registry_delete_tree(&format!("{shell_key}\\FlowFiles"));
        }
        registry_delete_tree(FOLDER_INTEGRATION_BACKUP_KEY);
    }
    folder_integration_status()
}

#[cfg(windows)]
fn folder_context_menu_verb_key(class: &str) -> String {
    format!("Software\\Classes\\{class}\\shell\\{FOLDER_CONTEXT_MENU_VERB}")
}

#[cfg(windows)]
fn folder_context_menu_background_key() -> String {
    format!("Software\\Classes\\Directory\\Background\\shell\\{FOLDER_CONTEXT_MENU_VERB}")
}

#[cfg(windows)]
fn folder_context_menu_status() -> Result<FolderIntegrationStatus, String> {
    let command = folder_integration_command()?;
    let folders_enabled = FOLDER_CONTEXT_MENU_CLASSES.iter().all(|class| {
        registry_read_string(
            &format!("{}\\command", folder_context_menu_verb_key(class)),
            None,
        )
        .ok()
        .flatten()
        .as_deref()
            == Some(command.as_str())
    });
    let background_enabled = registry_read_string(
        &format!("{}\\command", folder_context_menu_background_key()),
        None,
    )
    .ok()
    .flatten()
    .is_some();
    Ok(FolderIntegrationStatus {
        enabled: folders_enabled && background_enabled,
        command,
    })
}

#[cfg(windows)]
fn write_folder_context_menu_verb(key: &str, command: &str, label: &str) -> Result<(), String> {
    let executable = env::current_exe().map_err(|error| app_error(error.to_string()))?;
    registry_write_string(key, None, label)?;
    registry_write_string(key, Some("MUIVerb"), label)?;
    registry_write_string(
        key,
        Some("Icon"),
        &format!("\"{}\",0", public_path(&executable)),
    )?;
    registry_write_string(key, Some("Position"), "Top")?;
    registry_write_string(key, Some("MultiSelectModel"), "Document")?;
    registry_write_string(&format!("{key}\\command"), None, command)
}

#[cfg(windows)]
fn apply_folder_context_menu_enabled(enabled: bool) -> Result<FolderIntegrationStatus, String> {
    if enabled {
        let command = folder_integration_command()?;
        for class in FOLDER_CONTEXT_MENU_CLASSES {
            write_folder_context_menu_verb(
                &folder_context_menu_verb_key(class),
                &command,
                "在 Flow Files 中打开",
            )?;
        }
        let background_command = command.replace("%1", "%V");
        write_folder_context_menu_verb(
            &folder_context_menu_background_key(),
            &background_command,
            "在 Flow Files 中打开",
        )?;
    } else {
        for class in FOLDER_CONTEXT_MENU_CLASSES {
            registry_delete_tree(&folder_context_menu_verb_key(class));
        }
        registry_delete_tree(&folder_context_menu_background_key());
    }
    folder_context_menu_status()
}

fn claude_project_key(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if normalized.len() > 3 {
        normalized.trim_end_matches('/').to_string()
    } else {
        normalized
    }
}

fn mark_claude_project_trusted(config: &mut Value, project_key: &str) -> Result<(), String> {
    let root = config
        .as_object_mut()
        .ok_or_else(|| app_error("Claude's user configuration is not a JSON object."))?;
    let projects = root.entry("projects").or_insert_with(|| json!({}));
    let projects = projects
        .as_object_mut()
        .ok_or_else(|| app_error("Claude's projects configuration is not a JSON object."))?;
    let project = projects
        .entry(project_key.to_string())
        .or_insert_with(|| json!({}));
    let project = project
        .as_object_mut()
        .ok_or_else(|| app_error("Claude's project configuration is not a JSON object."))?;
    project.insert("hasTrustDialogAccepted".into(), Value::Bool(true));
    Ok(())
}

fn trust_claude_workspace(path: &str) -> Result<(), String> {
    let profile = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .ok_or_else(|| app_error("Unable to locate the current user profile."))?;
    let config_path = PathBuf::from(profile).join(".claude.json");
    let mut file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&config_path)
        .map_err(|error| {
            app_error(format!(
                "Unable to open Claude's user configuration: {error}"
            ))
        })?;
    file.lock_exclusive().map_err(|error| {
        app_error(format!(
            "Unable to lock Claude's user configuration: {error}"
        ))
    })?;

    let result = (|| {
        let mut source = String::new();
        file.read_to_string(&mut source).map_err(|error| {
            app_error(format!(
                "Unable to read Claude's user configuration: {error}"
            ))
        })?;
        let mut config = if source.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str::<Value>(&source).map_err(|error| {
                app_error(format!(
                    "Claude's user configuration is invalid JSON and was not changed: {error}"
                ))
            })?
        };
        mark_claude_project_trusted(&mut config, &claude_project_key(path))?;
        let output = serde_json::to_vec_pretty(&config).map_err(|error| {
            app_error(format!(
                "Unable to serialize Claude's user configuration: {error}"
            ))
        })?;
        file.set_len(0).map_err(|error| {
            app_error(format!(
                "Unable to update Claude's user configuration: {error}"
            ))
        })?;
        file.seek(SeekFrom::Start(0)).map_err(|error| {
            app_error(format!(
                "Unable to update Claude's user configuration: {error}"
            ))
        })?;
        file.write_all(&output)
            .and_then(|_| file.sync_all())
            .map_err(|error| {
                app_error(format!(
                    "Unable to save Claude's user configuration: {error}"
                ))
            })
    })();
    let _ = FileExt::unlock(&file);
    result
}

fn remove_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| app_error(error.to_string()))
    } else {
        fs::remove_file(path).map_err(|error| app_error(error.to_string()))
    }
}

struct ScanContext {
    app: tauri::AppHandle,
    job_id: String,
    control: Arc<OperationControl>,
    scanned_items: usize,
    scanned_bytes: u64,
    total_items: usize,
    current_name: String,
    last_emit: Instant,
}

impl ScanContext {
    fn checkpoint(&self) -> Result<(), String> {
        while self.control.paused.load(Ordering::Relaxed) {
            if self.control.cancelled.load(Ordering::Relaxed) {
                return Err(app_error("Operation cancelled."));
            }
            thread::sleep(Duration::from_millis(80));
        }
        if self.control.cancelled.load(Ordering::Relaxed) {
            Err(app_error("Operation cancelled."))
        } else {
            Ok(())
        }
    }

    fn emit(&mut self, force: bool) {
        if !force
            && self.scanned_items % 64 != 0
            && self.last_emit.elapsed() < Duration::from_millis(120)
        {
            return;
        }
        self.last_emit = Instant::now();
        let _ = self.app.emit(
            "file-operation-progress",
            OperationProgress {
                job_id: self.job_id.clone(),
                processed_bytes: 0,
                total_bytes: 0,
                completed_items: 0,
                total_items: self.total_items,
                current_name: self.current_name.clone(),
                phase: "scanning".into(),
                scanned_items: self.scanned_items,
                scanned_bytes: self.scanned_bytes,
            },
        );
    }
}

fn scan_path_size(path: &Path, scan: &mut ScanContext) -> Result<u64, String> {
    scan.checkpoint()?;
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return Ok(0);
    };
    scan.scanned_items += 1;
    scan.current_name = public_path(path);
    if metadata.is_file() {
        scan.scanned_bytes = scan.scanned_bytes.saturating_add(metadata.len());
        scan.emit(false);
        return Ok(metadata.len());
    }
    scan.emit(false);
    if !metadata.is_dir() {
        return Ok(0);
    }
    let mut size = 0u64;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            size = size.saturating_add(scan_path_size(&entry.path(), scan)?);
        }
    }
    Ok(size)
}

struct ProgressContext {
    app: tauri::AppHandle,
    job_id: String,
    control: Arc<OperationControl>,
    processed_bytes: u64,
    total_bytes: u64,
    completed_items: usize,
    total_items: usize,
    current_name: String,
    scanned_items: usize,
    scanned_bytes: u64,
    throttle_window_started: Instant,
    throttle_window_bytes: u64,
}

impl ProgressContext {
    fn cancelled(&self) -> bool {
        self.control.cancelled.load(Ordering::Relaxed)
    }

    fn checkpoint(&self) -> Result<(), String> {
        while self.control.paused.load(Ordering::Relaxed) {
            if self.cancelled() {
                return Err(app_error("Operation cancelled."));
            }
            thread::sleep(Duration::from_millis(80));
        }
        if self.cancelled() {
            Err(app_error("Operation cancelled."))
        } else {
            Ok(())
        }
    }

    fn emit(&self) {
        let _ = self.app.emit(
            "file-operation-progress",
            OperationProgress {
                job_id: self.job_id.clone(),
                processed_bytes: self.processed_bytes,
                total_bytes: self.total_bytes,
                completed_items: self.completed_items,
                total_items: self.total_items,
                current_name: self.current_name.clone(),
                phase: "transfer".into(),
                scanned_items: self.scanned_items,
                scanned_bytes: self.scanned_bytes,
            },
        );
    }

    fn throttle(&mut self, bytes: u64) -> Result<(), String> {
        let limit = self
            .control
            .rate_limit_bytes_per_second
            .load(Ordering::Relaxed);
        if limit == 0 {
            self.throttle_window_started = Instant::now();
            self.throttle_window_bytes = 0;
            return Ok(());
        }

        let now = Instant::now();
        if now.duration_since(self.throttle_window_started) >= Duration::from_secs(1) {
            self.throttle_window_started = now;
            self.throttle_window_bytes = 0;
        }
        self.throttle_window_bytes = self.throttle_window_bytes.saturating_add(bytes);
        let target = target_elapsed(self.throttle_window_bytes, limit);
        loop {
            if self.cancelled() {
                return Err(app_error("Operation cancelled."));
            }
            if self.control.paused.load(Ordering::Relaxed) {
                self.checkpoint()?;
                self.throttle_window_started = Instant::now();
                self.throttle_window_bytes = 0;
                return Ok(());
            }
            let elapsed = self.throttle_window_started.elapsed();
            if elapsed >= target {
                return Ok(());
            }
            thread::sleep((target - elapsed).min(Duration::from_millis(50)));
        }
    }
}

fn copy_file_with_progress(
    source: &Path,
    target: &Path,
    progress: &mut ProgressContext,
) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| app_error(error.to_string()))?;
    }
    let mut input = fs::File::open(source).map_err(|error| app_error(error.to_string()))?;
    let mut output = fs::File::create(target).map_err(|error| app_error(error.to_string()))?;
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        progress.checkpoint()?;
        let read = input
            .read(&mut buffer)
            .map_err(|error| app_error(error.to_string()))?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| app_error(error.to_string()))?;
        progress.processed_bytes = progress.processed_bytes.saturating_add(read as u64);
        progress.throttle(read as u64)?;
        progress.emit();
    }
    if let Ok(metadata) = fs::metadata(source) {
        let _ = fs::set_permissions(target, metadata.permissions());
    }
    Ok(())
}

fn copy_path_with_progress(
    source: &Path,
    target: &Path,
    progress: &mut ProgressContext,
) -> Result<(), String> {
    progress.checkpoint()?;
    let metadata = fs::symlink_metadata(source).map_err(|error| app_error(error.to_string()))?;
    if metadata.is_dir() {
        fs::create_dir_all(target).map_err(|error| app_error(error.to_string()))?;
        for item in fs::read_dir(source).map_err(|error| app_error(error.to_string()))? {
            let item = item.map_err(|error| app_error(error.to_string()))?;
            copy_path_with_progress(&item.path(), &target.join(item.file_name()), progress)?;
        }
        Ok(())
    } else if metadata.is_file() {
        copy_file_with_progress(source, target, progress)
    } else {
        Err(app_error(
            "Symbolic links, junctions, and other special items are not followed for safety.",
        ))
    }
}

fn volume_key(path: &Path) -> String {
    let value = public_path(path).replace('/', "\\");
    if value.len() >= 3 && value.as_bytes()[1] == b':' {
        return value[..2].to_ascii_lowercase();
    }
    if let Some(rest) = value.strip_prefix("\\\\") {
        let mut parts = rest.split('\\');
        if let (Some(server), Some(share)) = (parts.next(), parts.next()) {
            return format!(
                "\\\\{}\\{}",
                server.to_ascii_lowercase(),
                share.to_ascii_lowercase()
            );
        }
    }
    String::new()
}

fn copy_path_plain(source: &Path, target: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| app_error(error.to_string()))?;
    if metadata.is_dir() {
        fs::create_dir_all(target).map_err(|error| app_error(error.to_string()))?;
        for item in fs::read_dir(source).map_err(|error| app_error(error.to_string()))? {
            let item = item.map_err(|error| app_error(error.to_string()))?;
            copy_path_plain(&item.path(), &target.join(item.file_name()))?;
        }
        Ok(())
    } else if metadata.is_file() {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| app_error(error.to_string()))?;
        }
        fs::copy(source, target)
            .map(|_| ())
            .map_err(|error| app_error(error.to_string()))
    } else {
        Err(app_error("This item type cannot be copied."))
    }
}

fn is_supported_image(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp")
    )
}

fn create_thumbnail(path: &Path) -> Result<Thumbnail, String> {
    if !is_supported_image(path) {
        return Err(app_error(
            "This file type does not have a built-in thumbnail decoder.",
        ));
    }
    let image = ImageReader::open(path)
        .map_err(|error| app_error(error.to_string()))?
        .with_guessed_format()
        .map_err(|error| app_error(error.to_string()))?
        .decode()
        .map_err(|error| app_error(error.to_string()))?;
    let thumbnail = image.thumbnail(THUMBNAIL_EDGE, THUMBNAIL_EDGE).to_rgb8();
    let mut encoded = Vec::new();
    JpegEncoder::new_with_quality(&mut encoded, 74)
        .write_image(
            thumbnail.as_raw(),
            thumbnail.width(),
            thumbnail.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|error| app_error(error.to_string()))?;
    Ok(Thumbnail {
        path: public_path(path),
        data_url: format!("data:image/jpeg;base64,{}", BASE64.encode(encoded)),
    })
}

#[cfg(windows)]
fn create_windows_file_icon(path: &Path) -> Result<Thumbnail, String> {
    unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
        .ok()
        .map_err(|error| {
            app_error(format!(
                "Unable to initialize the Windows icon provider: {error}"
            ))
        })?;
    let result = (|| -> Result<Thumbnail, String> {
        let wide_path = path
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let factory: IShellItemImageFactory =
            unsafe { SHCreateItemFromParsingName(PCWSTR(wide_path.as_ptr()), None) }.map_err(
                |error| app_error(format!("Unable to read the Windows file icon: {error}")),
            )?;
        let bitmap = unsafe {
            factory.GetImage(
                SIZE {
                    cx: FILE_ICON_EDGE,
                    cy: FILE_ICON_EDGE,
                },
                SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK,
            )
        }
        .map_err(|error| app_error(format!("Unable to render the Windows file icon: {error}")))?;
        let device_context = unsafe { CreateCompatibleDC(None) };
        if device_context.is_invalid() {
            unsafe {
                let _ = DeleteObject(HGDIOBJ(bitmap.0));
            }
            return Err(app_error(
                "Unable to create a device context for the file icon.",
            ));
        }
        let mut bitmap_info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: FILE_ICON_EDGE,
                biHeight: -FILE_ICON_EDGE,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; (FILE_ICON_EDGE * FILE_ICON_EDGE * 4) as usize];
        let copied = unsafe {
            GetDIBits(
                device_context,
                bitmap,
                0,
                FILE_ICON_EDGE as u32,
                Some(pixels.as_mut_ptr().cast()),
                &mut bitmap_info,
                DIB_RGB_COLORS,
            )
        };
        unsafe {
            let _ = DeleteDC(device_context);
            let _ = DeleteObject(HGDIOBJ(bitmap.0));
        }
        if copied == 0 {
            return Err(app_error("Windows returned an empty file icon."));
        }
        let has_alpha = pixels.chunks_exact(4).any(|pixel| pixel[3] != 0);
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            if !has_alpha {
                pixel[3] = 255;
            }
        }
        let mut encoded = Vec::new();
        PngEncoder::new(&mut encoded)
            .write_image(
                &pixels,
                FILE_ICON_EDGE as u32,
                FILE_ICON_EDGE as u32,
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|error| app_error(error.to_string()))?;
        Ok(Thumbnail {
            path: public_path(path),
            data_url: format!("data:image/png;base64,{}", BASE64.encode(encoded)),
        })
    })();
    unsafe { CoUninitialize() };
    result
}

fn create_file_preview(
    path: &Path,
    text_encoding: Option<&str>,
    text_offset: u64,
) -> Result<FilePreview, String> {
    if !path.is_file() {
        return Ok(FilePreview {
            kind: "none".into(),
            data_url: None,
            text: None,
            truncated: false,
            encoding: None,
            text_offset: 0,
            total_bytes: 0,
        });
    }
    let metadata = fs::metadata(path).map_err(|error| app_error(error.to_string()))?;
    let total_bytes = metadata.len();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let streamed_kind = if extension == "pdf" {
        Some("pdf")
    } else if extension == "svg" {
        Some("svg")
    } else if matches!(extension.as_str(), "heic" | "heif") {
        Some("heic")
    } else if matches!(
        extension.as_str(),
        "mp3" | "wav" | "flac" | "m4a" | "aac" | "ogg" | "wma"
    ) {
        Some("audio")
    } else if matches!(
        extension.as_str(),
        "mp4" | "webm" | "mov" | "mkv" | "avi" | "m4v" | "wmv"
    ) {
        Some("video")
    } else if matches!(
        extension.as_str(),
        "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "odt" | "ods" | "odp" | "rtf"
    ) {
        Some("office")
    } else {
        None
    };
    if let Some(kind) = streamed_kind {
        return Ok(FilePreview {
            kind: kind.into(),
            data_url: None,
            text: None,
            truncated: false,
            encoding: None,
            text_offset: 0,
            total_bytes,
        });
    }

    if is_supported_image(path) {
        let image = ImageReader::open(path)
            .map_err(|error| app_error(error.to_string()))?
            .with_guessed_format()
            .map_err(|error| app_error(error.to_string()))?
            .decode()
            .map_err(|error| app_error(error.to_string()))?;
        let preview = image.thumbnail(PREVIEW_EDGE, PREVIEW_EDGE).to_rgb8();
        let mut encoded = Vec::new();
        JpegEncoder::new_with_quality(&mut encoded, 84)
            .write_image(
                preview.as_raw(),
                preview.width(),
                preview.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|error| app_error(error.to_string()))?;
        return Ok(FilePreview {
            kind: "image".into(),
            data_url: Some(format!("data:image/jpeg;base64,{}", BASE64.encode(encoded))),
            text: None,
            truncated: false,
            encoding: None,
            text_offset: 0,
            total_bytes,
        });
    }

    let text_extensions = [
        "txt", "md", "json", "xml", "yaml", "yml", "toml", "ini", "log", "csv", "rs", "js", "jsx",
        "ts", "tsx", "css", "html", "py", "java", "c", "cpp", "h", "cs", "ps1", "bat", "cmd",
    ];
    if text_extensions.contains(&extension.as_str()) {
        let mut offset = text_offset.min(total_bytes);
        if matches!(text_encoding, Some("utf-16le" | "utf-16be")) {
            offset -= offset % 2;
        }
        let mut bytes = Vec::new();
        let mut file = fs::File::open(path).map_err(|error| app_error(error.to_string()))?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| app_error(error.to_string()))?;
        file.take(MAX_TEXT_PREVIEW_BYTES)
            .read_to_end(&mut bytes)
            .map_err(|error| app_error(error.to_string()))?;
        let (text, encoding) = decode_text_preview(&bytes, text_encoding);
        return Ok(FilePreview {
            kind: "text".into(),
            data_url: None,
            text: Some(text),
            truncated: offset.saturating_add(bytes.len() as u64) < total_bytes,
            encoding: Some(encoding),
            text_offset: offset,
            total_bytes,
        });
    }
    Ok(FilePreview {
        kind: "none".into(),
        data_url: None,
        text: None,
        truncated: false,
        encoding: None,
        text_offset: 0,
        total_bytes,
    })
}

fn push_detail(items: &mut Vec<FileDetail>, key: &str, value: impl Into<String>) {
    let value = value.into();
    if !value.trim().is_empty() {
        items.push(FileDetail {
            key: key.into(),
            value,
        });
    }
}

fn exif_display(exif: &exif::Exif, tag: exif::Tag) -> Option<String> {
    exif.get_field(tag, exif::In::PRIMARY)
        .map(|field| field.display_value().with_unit(exif).to_string())
        .filter(|value| !value.trim().is_empty())
}

fn create_file_details(path: &Path) -> Result<FileDetails, String> {
    if !path.is_file() {
        return Ok(FileDetails { items: Vec::new() });
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mut items = Vec::new();

    if is_supported_image(path) || matches!(extension.as_str(), "heic" | "heif") {
        if let Ok((width, height)) = image::image_dimensions(path) {
            push_detail(&mut items, "dimensions", format!("{width} × {height}"));
        }
        if let Ok(file) = fs::File::open(path) {
            if let Ok(exif) = exif::Reader::new().read_from_container(&mut BufReader::new(file)) {
                let make = exif_display(&exif, exif::Tag::Make).unwrap_or_default();
                let model = exif_display(&exif, exif::Tag::Model).unwrap_or_default();
                push_detail(
                    &mut items,
                    "camera",
                    format!("{make} {model}").trim().to_string(),
                );
                for (key, tag) in [
                    ("lens", exif::Tag::LensModel),
                    ("captured", exif::Tag::DateTimeOriginal),
                    ("aperture", exif::Tag::FNumber),
                    ("exposure", exif::Tag::ExposureTime),
                    ("iso", exif::Tag::PhotographicSensitivity),
                    ("focalLength", exif::Tag::FocalLength),
                ] {
                    if let Some(value) = exif_display(&exif, tag) {
                        push_detail(&mut items, key, value);
                    }
                }
            }
        }
    } else if matches!(
        extension.as_str(),
        "mp3" | "wav" | "flac" | "m4a" | "aac" | "ogg" | "wma" | "opus" | "aiff" | "ape"
    ) {
        if let Ok(tagged_file) = lofty::read_from_path(path) {
            if let Some(tag) = tagged_file
                .primary_tag()
                .or_else(|| tagged_file.first_tag())
            {
                let stem = path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or("");
                if let Some(title) = tag
                    .title()
                    .filter(|title| !title.eq_ignore_ascii_case(stem))
                {
                    push_detail(&mut items, "title", title.into_owned());
                }
                if let Some(artist) = tag.artist() {
                    push_detail(&mut items, "artist", artist.into_owned());
                }
                if let Some(album) = tag.album() {
                    push_detail(&mut items, "album", album.into_owned());
                }
                if let Some(genre) = tag.genre() {
                    push_detail(&mut items, "genre", genre.into_owned());
                }
                if let Some(date) = tag.date() {
                    push_detail(&mut items, "year", date.to_string());
                }
                if let Some(track) = tag.track() {
                    let track_value = tag
                        .track_total()
                        .map(|total| format!("{track}/{total}"))
                        .unwrap_or_else(|| track.to_string());
                    push_detail(&mut items, "track", track_value);
                }
            }
            let properties = tagged_file.properties();
            if let Some(bitrate) = properties.audio_bitrate().filter(|value| *value > 0) {
                push_detail(&mut items, "bitrate", format!("{bitrate} kbps"));
            }
            if let Some(sample_rate) = properties.sample_rate().filter(|value| *value > 0) {
                let rate = sample_rate as f64 / 1000.0;
                push_detail(&mut items, "sampleRate", format!("{rate:.1} kHz"));
            }
            if let Some(bit_depth) = properties.bit_depth().filter(|value| *value > 0) {
                push_detail(&mut items, "bitDepth", format!("{bit_depth} bit"));
            }
            if let Some(channels) = properties.channels().filter(|value| *value > 0) {
                push_detail(&mut items, "channels", channels.to_string());
            }
        }
    }
    Ok(FileDetails { items })
}

#[cfg(windows)]
struct ClipboardGuard;

#[cfg(windows)]
impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseClipboard();
        }
    }
}

#[cfg(windows)]
fn open_windows_clipboard() -> Result<ClipboardGuard, String> {
    for _ in 0..20 {
        if unsafe { OpenClipboard(None) }.is_ok() {
            return Ok(ClipboardGuard);
        }
        thread::sleep(Duration::from_millis(15));
    }
    Err(app_error("The Windows clipboard is currently busy."))
}

#[cfg(windows)]
fn allocate_clipboard_bytes(bytes: &[u8]) -> Result<HGLOBAL, String> {
    let memory = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) }
        .map_err(|error| app_error(error.to_string()))?;
    let pointer = unsafe { GlobalLock(memory) };
    if pointer.is_null() {
        unsafe {
            let _ = GlobalFree(Some(memory));
        }
        return Err(app_error("Unable to allocate clipboard memory."));
    }
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer.cast::<u8>(), bytes.len());
        let _ = GlobalUnlock(memory);
    }
    Ok(memory)
}

#[cfg(windows)]
fn write_windows_file_clipboard(paths: &[String], mode: &str) -> Result<(), String> {
    if paths.is_empty() {
        return Err(app_error("No files were selected."));
    }
    let mut wide_paths = Vec::<u16>::new();
    for path in paths {
        wide_paths.extend(path.encode_utf16());
        wide_paths.push(0);
    }
    wide_paths.push(0);

    // DROPFILES is a 20-byte header followed by a double-null-terminated UTF-16 path list.
    let mut payload = vec![0u8; 20 + wide_paths.len() * 2];
    payload[0..4].copy_from_slice(&20u32.to_le_bytes());
    payload[16..20].copy_from_slice(&1i32.to_le_bytes());
    unsafe {
        std::ptr::copy_nonoverlapping(
            wide_paths.as_ptr().cast::<u8>(),
            payload.as_mut_ptr().add(20),
            wide_paths.len() * 2,
        );
    }
    let _clipboard = open_windows_clipboard()?;
    let files_memory = allocate_clipboard_bytes(&payload)?;
    let drop_effect = if mode == "move" { 2u32 } else { 1u32 };
    let effect_memory = match allocate_clipboard_bytes(&drop_effect.to_le_bytes()) {
        Ok(memory) => memory,
        Err(error) => {
            unsafe {
                let _ = GlobalFree(Some(files_memory));
            }
            return Err(error);
        }
    };
    if let Err(error) = unsafe { EmptyClipboard() } {
        unsafe {
            let _ = GlobalFree(Some(files_memory));
            let _ = GlobalFree(Some(effect_memory));
        }
        return Err(app_error(error.to_string()));
    }
    if let Err(error) = unsafe { SetClipboardData(15, Some(HANDLE(files_memory.0))) } {
        unsafe {
            let _ = GlobalFree(Some(files_memory));
            let _ = GlobalFree(Some(effect_memory));
        }
        return Err(app_error(error.to_string()));
    }
    let preferred_format = unsafe { RegisterClipboardFormatW(w!("Preferred DropEffect")) };
    if preferred_format != 0 {
        // Ownership transfers to the clipboard only when SetClipboardData succeeds.
        if unsafe { SetClipboardData(preferred_format, Some(HANDLE(effect_memory.0))) }.is_err() {
            unsafe {
                let _ = GlobalFree(Some(effect_memory));
            }
        }
    } else {
        unsafe {
            let _ = GlobalFree(Some(effect_memory));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn read_windows_file_clipboard() -> Result<ClipboardPayload, String> {
    let _clipboard = open_windows_clipboard()?;
    let handle = match unsafe { GetClipboardData(15) } {
        Ok(handle) => handle,
        Err(_) => {
            return Ok(ClipboardPayload {
                paths: Vec::new(),
                mode: "copy".into(),
            })
        }
    };
    let drop = HDROP(handle.0);
    let count = unsafe { DragQueryFileW(drop, u32::MAX, None) };
    let mut paths = Vec::with_capacity(count as usize);
    for index in 0..count {
        let length = unsafe { DragQueryFileW(drop, index, None) };
        let mut buffer = vec![0u16; length as usize + 1];
        let written = unsafe { DragQueryFileW(drop, index, Some(&mut buffer)) };
        if written > 0 {
            paths.push(String::from_utf16_lossy(&buffer[..written as usize]));
        }
    }
    let preferred_format = unsafe { RegisterClipboardFormatW(w!("Preferred DropEffect")) };
    let mode = if preferred_format != 0 {
        unsafe { GetClipboardData(preferred_format) }
            .ok()
            .and_then(|effect_handle| {
                let memory = HGLOBAL(effect_handle.0);
                let pointer = unsafe { GlobalLock(memory) };
                if pointer.is_null() {
                    return None;
                }
                let effect = unsafe { std::ptr::read_unaligned(pointer.cast::<u32>()) };
                unsafe {
                    let _ = GlobalUnlock(memory);
                }
                Some(if effect & 2 != 0 { "move" } else { "copy" })
            })
            .unwrap_or("copy")
            .to_string()
    } else {
        "copy".into()
    };
    Ok(ClipboardPayload { paths, mode })
}

#[tauri::command]
async fn get_locations() -> Vec<Location> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = env::var("USERPROFILE").unwrap_or_else(|_| "C:\\".to_string());
        let mut candidates = vec![
            ("Home", PathBuf::from(&home)),
            ("Desktop", PathBuf::from(&home).join("Desktop")),
            ("Documents", PathBuf::from(&home).join("Documents")),
            ("Downloads", PathBuf::from(&home).join("Downloads")),
            ("Pictures", PathBuf::from(&home).join("Pictures")),
        ];
        for letter in 'C'..='Z' {
            candidates.push(("Drive", PathBuf::from(format!("{letter}:\\"))));
        }

        candidates
            .into_iter()
            .filter(|(_, path)| path.is_dir())
            .map(|(label, path)| Location {
                total_space: if label == "Drive" {
                    fs2::total_space(&path).ok()
                } else {
                    None
                },
                available_space: if label == "Drive" {
                    fs2::available_space(&path).ok()
                } else {
                    None
                },
                label: if label == "Drive" {
                    path.display().to_string()
                } else {
                    label.to_string()
                },
                path: public_path(&path),
                is_available: true,
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

fn collect_path_suggestions(input: String, recent_paths: Vec<String>) -> Vec<PathSuggestion> {
    let trimmed = input.trim().trim_matches('"');
    let mut normalized = trimmed.replace('/', "\\");
    if normalized.len() == 2 && normalized.as_bytes()[1] == b':' {
        normalized.push('\\');
    }
    let normalized_lower = normalized.to_lowercase();
    let mut suggestions = Vec::new();
    let mut seen = HashSet::new();

    for recent in recent_paths.into_iter().take(30) {
        let path = PathBuf::from(&recent);
        let public = public_path(&path);
        if path.is_dir()
            && (normalized.is_empty() || public.to_lowercase().starts_with(&normalized_lower))
            && seen.insert(public.to_lowercase())
        {
            suggestions.push(PathSuggestion {
                label: path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .filter(|name| !name.is_empty())
                    .unwrap_or_else(|| public.clone()),
                path: public,
                source: "recent".into(),
            });
        }
        if suggestions.len() >= 12 {
            return suggestions;
        }
    }

    if normalized.is_empty() {
        return suggestions;
    }
    let typed_path = PathBuf::from(&normalized);
    let (parent, needle) = if normalized.ends_with('\\') {
        (typed_path, String::new())
    } else {
        (
            typed_path
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| typed_path.clone()),
            typed_path
                .file_name()
                .map(|name| name.to_string_lossy().to_lowercase())
                .unwrap_or_default(),
        )
    };
    let Ok(items) = fs::read_dir(parent) else {
        return suggestions;
    };
    let mut folders = items
        .flatten()
        .filter_map(|item| {
            let file_type = item.file_type().ok()?;
            let name = item.file_name().to_string_lossy().to_string();
            if !file_type.is_dir() || !name.to_lowercase().starts_with(&needle) {
                return None;
            }
            Some((name, public_path(&item.path())))
        })
        .collect::<Vec<_>>();
    folders.sort_by(|left, right| left.0.to_lowercase().cmp(&right.0.to_lowercase()));
    for (label, path) in folders {
        if seen.insert(path.to_lowercase()) {
            suggestions.push(PathSuggestion {
                path,
                label,
                source: "folder".into(),
            });
        }
        if suggestions.len() >= 12 {
            break;
        }
    }
    suggestions
}

#[tauri::command]
async fn suggest_paths(input: String, recent_paths: Vec<String>) -> Vec<PathSuggestion> {
    tauri::async_runtime::spawn_blocking(move || collect_path_suggestions(input, recent_paths))
        .await
        .unwrap_or_default()
}

fn is_hidden_item(metadata: &fs::Metadata, name: &str) -> bool {
    #[cfg(windows)]
    {
        let _ = name;
        metadata.file_attributes() & 0x2 != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        name.starts_with('.')
    }
}

fn entry_from_metadata(path: &Path, name: String, metadata: &fs::Metadata) -> FileEntry {
    let is_directory = metadata.is_dir();
    let is_link = fs::symlink_metadata(path)
        .map(|link_metadata| link_metadata.file_type().is_symlink())
        .unwrap_or(false);
    let link_target = is_link
        .then(|| fs::read_link(path).ok())
        .flatten()
        .map(|target| {
            let resolved = if target.is_absolute() {
                target
            } else {
                path.parent().unwrap_or_else(|| Path::new("")).join(target)
            };
            public_path(&resolved)
        });
    let modified_unix_seconds = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs());
    FileEntry {
        is_hidden: is_hidden_item(metadata, &name),
        name,
        path: public_path(path),
        is_directory,
        size: if is_directory { 0 } else { metadata.len() },
        modified_unix_seconds,
        extension: path
            .extension()
            .map(|extension| extension.to_string_lossy().to_string()),
        is_link,
        link_target,
    }
}

fn matches_search_kind(entry: &FileEntry, kind: &str) -> bool {
    if kind == "all" {
        return true;
    }
    if kind == "folders" {
        return entry.is_directory;
    }
    if entry.is_directory {
        return false;
    }
    let extension = entry.extension.as_deref().unwrap_or("").to_lowercase();
    match kind {
        "images" => ["png", "jpg", "jpeg", "webp", "gif", "heic", "bmp", "svg"]
            .contains(&extension.as_str()),
        "documents" => [
            "txt", "md", "pdf", "doc", "docx", "rtf", "odt", "xls", "xlsx", "csv", "ppt", "pptx",
        ]
        .contains(&extension.as_str()),
        "videos" => {
            ["mp4", "mkv", "mov", "avi", "webm", "wmv", "m4v"].contains(&extension.as_str())
        }
        "audio" => ["mp3", "wav", "flac", "aac", "m4a", "ogg", "wma"].contains(&extension.as_str()),
        "archives" => ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].contains(&extension.as_str()),
        _ => true,
    }
}

#[tauri::command]
fn list_directory(path: String) -> Result<DirectoryListing, String> {
    let directory = require_directory(&path)?;
    let mut entries = Vec::new();
    let mut folder_count = 0;
    let mut file_count = 0;

    for item in fs::read_dir(&directory).map_err(|error| app_error(error.to_string()))? {
        let item = match item {
            Ok(item) => item,
            Err(_) => continue,
        };
        let item_path = item.path();
        let metadata = match item.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let is_directory = metadata.is_dir();
        if is_directory {
            folder_count += 1;
        } else {
            file_count += 1;
        }
        entries.push(entry_from_metadata(
            &item_path,
            item.file_name().to_string_lossy().to_string(),
            &metadata,
        ));
    }
    entries.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(DirectoryListing {
        path: public_path(&directory),
        entries,
        folder_count,
        file_count,
    })
}

#[tauri::command]
async fn list_directory_progressive(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, DirectoryLoadJobs>,
    job_id: String,
    path: String,
) -> Result<DirectoryListing, String> {
    let directory = require_directory(&path)?;
    let public = public_path(&directory);
    let cancel = Arc::new(AtomicBool::new(false));
    jobs.0
        .lock()
        .map_err(|_| app_error("Directory loading state is unavailable."))?
        .insert(job_id.clone(), cancel.clone());
    let cleanup_id = job_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut entries = Vec::new();
        let mut chunk = Vec::with_capacity(128);
        let mut folder_count = 0usize;
        let mut file_count = 0usize;
        let items = fs::read_dir(&directory).map_err(|error| app_error(error.to_string()))?;

        for item in items {
            if cancel.load(Ordering::Relaxed) {
                return Err(app_error("Directory loading cancelled."));
            }
            let item = match item {
                Ok(item) => item,
                Err(_) => continue,
            };
            let item_path = item.path();
            let metadata = match item.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            let entry = entry_from_metadata(
                &item_path,
                item.file_name().to_string_lossy().to_string(),
                &metadata,
            );
            if entry.is_directory {
                folder_count += 1;
            } else {
                file_count += 1;
            }
            chunk.push(entry.clone());
            entries.push(entry);
            if chunk.len() >= 128 {
                let _ = app.emit(
                    "directory-load-progress",
                    DirectoryLoadProgress {
                        job_id: job_id.clone(),
                        path: public.clone(),
                        entries: std::mem::take(&mut chunk),
                        scanned: entries.len(),
                        folder_count,
                        file_count,
                    },
                );
            }
        }

        if !chunk.is_empty() {
            let _ = app.emit(
                "directory-load-progress",
                DirectoryLoadProgress {
                    job_id,
                    path: public.clone(),
                    entries: chunk,
                    scanned: entries.len(),
                    folder_count,
                    file_count,
                },
            );
        }
        entries.sort_by(|left, right| {
            right
                .is_directory
                .cmp(&left.is_directory)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        Ok(DirectoryListing {
            path: public,
            entries,
            folder_count,
            file_count,
        })
    })
    .await
    .map_err(|error| app_error(error.to_string()))
    .and_then(|result| result);
    if let Ok(mut active) = jobs.0.lock() {
        active.remove(&cleanup_id);
    }
    result
}

#[tauri::command]
fn cancel_directory_load(
    jobs: tauri::State<'_, DirectoryLoadJobs>,
    job_id: String,
) -> Result<(), String> {
    let active = jobs
        .0
        .lock()
        .map_err(|_| app_error("Directory loading state is unavailable."))?;
    if let Some(cancel) = active.get(&job_id) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
async fn calculate_folder_size(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, FolderSizeJobs>,
    job_id: String,
    path: String,
) -> Result<FolderSizeResult, String> {
    let root = require_directory(&path)?;
    let public = public_path(&root);
    let cancel = Arc::new(AtomicBool::new(false));
    jobs.0
        .lock()
        .map_err(|_| app_error("Folder size state is unavailable."))?
        .insert(job_id.clone(), cancel.clone());
    let cleanup_id = job_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut stack = vec![root];
        let mut total_bytes = 0u64;
        let mut scanned_files = 0usize;
        let mut scanned_folders = 0usize;
        let mut issues = 0usize;
        let mut last_emit = Instant::now();

        'walk: while let Some(directory) = stack.pop() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let items = match fs::read_dir(&directory) {
                Ok(items) => items,
                Err(_) => {
                    issues += 1;
                    continue;
                }
            };
            for item in items {
                if cancel.load(Ordering::Relaxed) {
                    break 'walk;
                }
                let item = match item {
                    Ok(item) => item,
                    Err(_) => {
                        issues += 1;
                        continue;
                    }
                };
                let metadata = match fs::symlink_metadata(item.path()) {
                    Ok(metadata) => metadata,
                    Err(_) => {
                        issues += 1;
                        continue;
                    }
                };
                if metadata.file_type().is_symlink() {
                    continue;
                }
                if metadata.is_dir() {
                    scanned_folders += 1;
                    stack.push(item.path());
                } else {
                    scanned_files += 1;
                    total_bytes = total_bytes.saturating_add(metadata.len());
                }
                if (scanned_files + scanned_folders) % 256 == 0
                    || last_emit.elapsed() >= Duration::from_millis(140)
                {
                    last_emit = Instant::now();
                    let _ = app.emit(
                        "folder-size-progress",
                        FolderSizeProgress {
                            job_id: job_id.clone(),
                            total_bytes,
                            scanned_files,
                            scanned_folders,
                        },
                    );
                }
            }
        }
        FolderSizeResult {
            path: public,
            total_bytes,
            scanned_files,
            scanned_folders,
            issues,
            cancelled: cancel.load(Ordering::Relaxed),
        }
    })
    .await
    .map_err(|error| app_error(error.to_string()));
    if let Ok(mut active) = jobs.0.lock() {
        active.remove(&cleanup_id);
    }
    result
}

#[tauri::command]
fn cancel_folder_size(
    jobs: tauri::State<'_, FolderSizeJobs>,
    job_id: String,
) -> Result<(), String> {
    let active = jobs
        .0
        .lock()
        .map_err(|_| app_error("Folder size state is unavailable."))?;
    if let Some(cancel) = active.get(&job_id) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

fn space_category(path: &Path) -> Option<(&'static str, &'static str)> {
    let normalized = public_path(path).replace('/', "\\").to_lowercase();
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if matches!(
        file_name.as_str(),
        "pagefile.sys" | "hiberfil.sys" | "swapfile.sys" | "memory.dmp"
    ) {
        return Some(("systemManaged", "protected"));
    }
    if normalized.contains("\\$recycle.bin\\") {
        return Some(("recycleBin", "safe"));
    }
    if normalized.contains("\\appdata\\local\\temp\\") || normalized.contains("\\windows\\temp\\") {
        return Some(("temporaryFiles", "safe"));
    }
    if normalized.contains("\\windows\\softwaredistribution\\download\\") {
        return Some(("windowsUpdateCache", "protected"));
    }
    if (normalized.contains("\\google\\chrome\\user data\\")
        || normalized.contains("\\microsoft\\edge\\user data\\")
        || normalized.contains("\\mozilla\\firefox\\profiles\\"))
        && (normalized.contains("\\cache\\")
            || normalized.contains("\\code cache\\")
            || normalized.contains("\\gpucache\\"))
    {
        return Some(("browserCache", "safe"));
    }
    if normalized.contains("\\.ollama\\models\\")
        || normalized.contains("\\.cache\\huggingface\\hub\\")
        || normalized.contains("\\lm studio\\models\\")
        || normalized.contains("\\lmstudio\\models\\")
    {
        return Some(("aiModels", "review"));
    }
    if normalized.contains("\\.cargo\\registry\\")
        || normalized.contains("\\.cargo\\git\\")
        || normalized.contains("\\npm-cache\\")
        || normalized.contains("\\pnpm\\store\\")
        || normalized.contains("\\pip\\cache\\")
        || normalized.contains("\\.nuget\\packages\\")
    {
        return Some(("developerCaches", "review"));
    }
    if normalized.contains("\\downloads\\") || normalized.contains("\\download\\") {
        return Some(("downloads", "review"));
    }
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if ["exe", "msi", "msix", "iso", "zip", "rar", "7z", "tar", "gz"].contains(&extension.as_str())
    {
        return Some(("installersArchives", "review"));
    }
    None
}

fn space_cleanup_category(category_id: &str) -> Option<&'static str> {
    match category_id {
        "temporaryFiles" | "browserCache" => Some("safe"),
        "aiModels" | "developerCaches" | "downloads" | "installersArchives" => Some("review"),
        _ => None,
    }
}

#[tauri::command]
async fn preview_space_cleanup(
    root: String,
    category_id: String,
) -> Result<SpaceCleanupPreview, String> {
    let directory = require_directory(&root)?;
    let risk = space_cleanup_category(&category_id).ok_or_else(|| {
        app_error("This category can only be reviewed with the appropriate Windows tool.")
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        const MAX_CANDIDATES: usize = 500;
        let mut stack = vec![directory.clone()];
        let mut candidates: BinaryHeap<Reverse<(u64, String, String, u64)>> = BinaryHeap::new();
        let mut total_bytes = 0u64;
        let mut total_files = 0usize;
        let mut issues = 0usize;

        while let Some(current) = stack.pop() {
            let entries = match fs::read_dir(&current) {
                Ok(entries) => entries,
                Err(_) => {
                    issues += 1;
                    continue;
                }
            };
            for entry in entries {
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(_) => {
                        issues += 1;
                        continue;
                    }
                };
                let path = entry.path();
                let metadata = match fs::symlink_metadata(&path) {
                    Ok(metadata) => metadata,
                    Err(_) => {
                        issues += 1;
                        continue;
                    }
                };
                if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
                    continue;
                }
                if metadata.is_dir() {
                    stack.push(path);
                    continue;
                }
                if !matches!(space_category(&path), Some((id, _)) if id == category_id) {
                    continue;
                }

                let size = metadata.len();
                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|duration| duration.as_secs())
                    .unwrap_or(0);
                let name = path
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| public_path(&path));
                total_bytes = total_bytes.saturating_add(size);
                total_files += 1;
                let candidate = Reverse((size, public_path(&path), name, modified));
                if candidates.len() < MAX_CANDIDATES {
                    candidates.push(candidate);
                } else if candidates
                    .peek()
                    .map(|smallest| size > smallest.0 .0)
                    .unwrap_or(true)
                {
                    candidates.pop();
                    candidates.push(candidate);
                }
            }
        }

        let mut candidates = candidates
            .into_iter()
            .map(|Reverse((size, path, name, modified))| SpaceScanItem {
                name,
                path,
                size,
                modified_unix_seconds: (modified > 0).then_some(modified),
                is_directory: false,
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| right.size.cmp(&left.size));
        Ok(SpaceCleanupPreview {
            root: public_path(&directory),
            category_id,
            risk: risk.into(),
            total_bytes,
            total_files,
            truncated: total_files > candidates.len(),
            candidates,
            issues,
        })
    })
    .await
    .map_err(|error| app_error(error.to_string()))?
}

#[tauri::command]
async fn recycle_space_cleanup_paths(
    root: String,
    category_id: String,
    paths: Vec<String>,
) -> Result<FileOperationResult, String> {
    let directory = require_directory(&root)?
        .canonicalize()
        .map_err(|error| app_error(error.to_string()))?;
    space_cleanup_category(&category_id)
        .ok_or_else(|| app_error("This category cannot be cleaned directly."))?;
    if paths.is_empty() || paths.len() > 500 {
        return Err(app_error("Select between 1 and 500 reviewed files."));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let before: HashSet<String> = trash::os_limited::list()
            .map_err(|error| app_error(error.to_string()))?
            .into_iter()
            .map(|item| item.id.to_string_lossy().to_string())
            .collect();
        let mut completed_paths = Vec::new();
        let mut issues = Vec::new();
        for requested in paths.into_iter().map(PathBuf::from) {
            if !requested.exists() {
                issues.push(operation_issue(&requested, "The item no longer exists."));
                continue;
            }
            let canonical = match requested.canonicalize() {
                Ok(path) => path,
                Err(error) => {
                    issues.push(operation_issue(&requested, error.to_string()));
                    continue;
                }
            };
            let category_matches = matches!(
                space_category(&canonical),
                Some((id, _)) if id == category_id
            );
            if !canonical.starts_with(&directory) || !canonical.is_file() || !category_matches {
                issues.push(operation_issue(
                    &canonical,
                    "The item no longer matches the reviewed cleanup scope.",
                ));
                continue;
            }
            match trash::delete(&canonical) {
                Ok(()) => completed_paths.push(canonical),
                Err(error) => issues.push(operation_issue(&canonical, error.to_string())),
            }
        }
        let original_paths: HashSet<String> = completed_paths
            .iter()
            .map(|path| public_path(path).to_lowercase())
            .collect();
        let ids = trash::os_limited::list()
            .map_err(|error| app_error(error.to_string()))?
            .into_iter()
            .filter(|item| !before.contains(&item.id.to_string_lossy().to_string()))
            .filter(|item| {
                original_paths.contains(&public_path(&item.original_path()).to_lowercase())
            })
            .map(|item| item.id.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        Ok(FileOperationResult {
            completed: completed_paths.len(),
            skipped: issues.len(),
            cancelled: false,
            error: None,
            issues,
            undo: if ids.is_empty() {
                None
            } else {
                Some(UndoAction::RestoreTrash { ids })
            },
        })
    })
    .await
    .map_err(|error| app_error(error.to_string()))?
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

#[tauri::command]
async fn scan_disk_space(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, SpaceScanJobs>,
    job_id: String,
    root: String,
) -> Result<SpaceScanResult, String> {
    let directory = require_directory(&root)?;
    let root_public = public_path(&directory);
    let total_space = fs2::total_space(&directory).unwrap_or(0);
    let available_space = fs2::available_space(&directory).unwrap_or(0);
    let cancel = Arc::new(AtomicBool::new(false));
    jobs.0
        .lock()
        .map_err(|_| app_error("Space scan state is unavailable."))?
        .insert(job_id.clone(), cancel.clone());
    let cleanup_id = job_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut stack = vec![directory.clone()];
        let mut top_directories: HashMap<PathBuf, u64> = HashMap::new();
        let mut largest_files: BinaryHeap<Reverse<(u64, String, String, u64)>> = BinaryHeap::new();
        let mut categories: HashMap<&'static str, (&'static str, u64, usize)> = HashMap::new();
        let mut scanned_bytes = 0u64;
        let mut scanned_files = 0usize;
        let mut scanned_folders = 0usize;
        let mut issues = 0usize;
        let mut skipped_reparse_points = 0usize;
        let mut last_emit = Instant::now();

        'walk: while let Some(current) = stack.pop() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let items = match fs::read_dir(&current) {
                Ok(items) => items,
                Err(_) => {
                    issues += 1;
                    continue;
                }
            };
            for item in items {
                if cancel.load(Ordering::Relaxed) {
                    break 'walk;
                }
                let item = match item {
                    Ok(item) => item,
                    Err(_) => {
                        issues += 1;
                        continue;
                    }
                };
                let path = item.path();
                let metadata = match fs::symlink_metadata(&path) {
                    Ok(metadata) => metadata,
                    Err(_) => {
                        issues += 1;
                        continue;
                    }
                };
                if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
                    skipped_reparse_points += 1;
                    continue;
                }
                if metadata.is_dir() {
                    scanned_folders += 1;
                    stack.push(path);
                } else {
                    let size = metadata.len();
                    scanned_files += 1;
                    scanned_bytes = scanned_bytes.saturating_add(size);

                    if let Ok(relative) = path.strip_prefix(&directory) {
                        if let Some(first) = relative.components().next() {
                            let top = directory.join(first.as_os_str());
                            if top != path {
                                let entry = top_directories.entry(top).or_insert(0);
                                *entry = entry.saturating_add(size);
                            }
                        }
                    }

                    let modified = metadata
                        .modified()
                        .ok()
                        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                        .map(|duration| duration.as_secs())
                        .unwrap_or(0);
                    let name = path
                        .file_name()
                        .map(|value| value.to_string_lossy().to_string())
                        .unwrap_or_else(|| public_path(&path));
                    let item = Reverse((size, public_path(&path), name, modified));
                    if largest_files.len() < 60 {
                        largest_files.push(item);
                    } else if largest_files
                        .peek()
                        .map(|smallest| size > smallest.0 .0)
                        .unwrap_or(true)
                    {
                        largest_files.pop();
                        largest_files.push(item);
                    }

                    if let Some((category, risk)) = space_category(&path) {
                        let entry = categories.entry(category).or_insert((risk, 0, 0));
                        entry.1 = entry.1.saturating_add(size);
                        entry.2 += 1;
                    }
                }

                if (scanned_files + scanned_folders) % 512 == 0
                    || last_emit.elapsed() >= Duration::from_millis(180)
                {
                    last_emit = Instant::now();
                    let _ = app.emit(
                        "space-scan-progress",
                        SpaceScanProgress {
                            job_id: job_id.clone(),
                            scanned_bytes,
                            scanned_files,
                            scanned_folders,
                            issues,
                            current_path: public_path(&current),
                        },
                    );
                }
            }
        }

        let mut largest_files = largest_files
            .into_iter()
            .map(|Reverse((size, path, name, modified))| SpaceScanItem {
                name,
                path,
                size,
                modified_unix_seconds: (modified > 0).then_some(modified),
                is_directory: false,
            })
            .collect::<Vec<_>>();
        largest_files.sort_by(|left, right| right.size.cmp(&left.size));

        let mut largest_directories = top_directories
            .into_iter()
            .map(|(path, size)| SpaceScanItem {
                name: path
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| public_path(&path)),
                path: public_path(&path),
                size,
                modified_unix_seconds: fs::metadata(&path)
                    .ok()
                    .and_then(|metadata| metadata.modified().ok())
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|duration| duration.as_secs()),
                is_directory: true,
            })
            .collect::<Vec<_>>();
        largest_directories.sort_by(|left, right| right.size.cmp(&left.size));
        largest_directories.truncate(40);

        let mut categories = categories
            .into_iter()
            .map(|(id, (risk, size, file_count))| SpaceScanCategory {
                id: id.into(),
                risk: risk.into(),
                size,
                file_count,
            })
            .collect::<Vec<_>>();
        categories.sort_by(|left, right| right.size.cmp(&left.size));

        SpaceScanResult {
            root: root_public,
            total_space,
            available_space,
            scanned_bytes,
            scanned_files,
            scanned_folders,
            issues,
            skipped_reparse_points,
            cancelled: cancel.load(Ordering::Relaxed),
            largest_files,
            largest_directories,
            categories,
        }
    })
    .await
    .map_err(|error| app_error(error.to_string()));
    if let Ok(mut active) = jobs.0.lock() {
        active.remove(&cleanup_id);
    }
    result
}

#[tauri::command]
fn cancel_space_scan(jobs: tauri::State<'_, SpaceScanJobs>, job_id: String) -> Result<(), String> {
    let active = jobs
        .0
        .lock()
        .map_err(|_| app_error("Space scan state is unavailable."))?;
    if let Some(cancel) = active.get(&job_id) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

fn quick_duplicate_fingerprint(path: &Path, size: u64) -> std::io::Result<[u8; 32]> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    hasher.update(size.to_le_bytes());
    let sample_size = usize::try_from(size.min(DUPLICATE_QUICK_SAMPLE_BYTES as u64))
        .unwrap_or(DUPLICATE_QUICK_SAMPLE_BYTES);
    let mut buffer = vec![0u8; sample_size];
    if sample_size > 0 {
        file.read_exact(&mut buffer)?;
        hasher.update(&buffer);
    }
    if size > (DUPLICATE_QUICK_SAMPLE_BYTES * 2) as u64 {
        file.seek(SeekFrom::End(-(DUPLICATE_QUICK_SAMPLE_BYTES as i64)))?;
        let mut tail = vec![0u8; DUPLICATE_QUICK_SAMPLE_BYTES];
        file.read_exact(&mut tail)?;
        hasher.update(&tail);
    }
    Ok(hasher.finalize().into())
}

fn full_duplicate_fingerprint(path: &Path) -> std::io::Result<[u8; 32]> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().into())
}

fn duplicate_signature(hash: &[u8; 32]) -> String {
    hash.iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[tauri::command]
async fn scan_duplicate_files(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, DuplicateScanJobs>,
    request: DuplicateScanRequest,
) -> Result<DuplicateScanResult, String> {
    let root = require_directory(&request.root)?;
    let minimum_size = request
        .minimum_size
        .unwrap_or(DUPLICATE_MINIMUM_BYTES)
        .max(1);
    let cancel = Arc::new(AtomicBool::new(false));
    jobs.0
        .lock()
        .map_err(|_| app_error("Duplicate scan state is unavailable."))?
        .insert(request.job_id.clone(), cancel.clone());
    let job_id = request.job_id.clone();
    let cleanup_id = job_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut stack = vec![root.clone()];
        let mut by_size: HashMap<u64, Vec<(PathBuf, Option<u64>)>> = HashMap::new();
        let mut scanned_files = 0usize;
        let mut issues = 0usize;

        while let Some(directory) = stack.pop() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let items = match fs::read_dir(&directory) {
                Ok(items) => items,
                Err(_) => {
                    issues += 1;
                    continue;
                }
            };
            for item in items.flatten() {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                let path = item.path();
                let metadata = match item.metadata() {
                    Ok(metadata) => metadata,
                    Err(_) => {
                        issues += 1;
                        continue;
                    }
                };
                #[cfg(windows)]
                let is_reparse = metadata.file_attributes() & 0x400 != 0;
                #[cfg(not(windows))]
                let is_reparse = item
                    .file_type()
                    .map(|kind| kind.is_symlink())
                    .unwrap_or(true);
                if metadata.is_dir() {
                    if !is_reparse {
                        stack.push(path);
                    }
                    continue;
                }
                scanned_files += 1;
                if metadata.len() >= minimum_size && !is_reparse {
                    let modified = metadata
                        .modified()
                        .ok()
                        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                        .map(|duration| duration.as_secs());
                    by_size
                        .entry(metadata.len())
                        .or_default()
                        .push((path.clone(), modified));
                }
                if scanned_files % 512 == 0 {
                    let candidate_files = by_size
                        .values()
                        .filter(|group| group.len() > 1)
                        .map(Vec::len)
                        .sum();
                    let _ = app.emit(
                        "duplicate-scan-progress",
                        DuplicateScanProgress {
                            job_id: job_id.clone(),
                            phase: "scanning".into(),
                            scanned_files,
                            candidate_files,
                            processed_bytes: 0,
                            current_path: public_path(&path),
                        },
                    );
                }
            }
        }

        let size_candidates = by_size
            .into_iter()
            .filter(|(_, files)| files.len() > 1)
            .collect::<Vec<_>>();
        let candidate_files = size_candidates
            .iter()
            .map(|(_, files)| files.len())
            .sum::<usize>();
        let mut by_quick: HashMap<(u64, [u8; 32]), Vec<(PathBuf, Option<u64>)>> = HashMap::new();
        let mut processed_bytes = 0u64;
        for (size, files) in size_candidates {
            for (path, modified) in files {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                match quick_duplicate_fingerprint(&path, size) {
                    Ok(hash) => by_quick
                        .entry((size, hash))
                        .or_default()
                        .push((path.clone(), modified)),
                    Err(_) => issues += 1,
                }
                processed_bytes = processed_bytes
                    .saturating_add(size.min((DUPLICATE_QUICK_SAMPLE_BYTES * 2) as u64));
                let _ = app.emit(
                    "duplicate-scan-progress",
                    DuplicateScanProgress {
                        job_id: job_id.clone(),
                        phase: "fingerprint".into(),
                        scanned_files,
                        candidate_files,
                        processed_bytes,
                        current_path: public_path(&path),
                    },
                );
            }
        }

        let mut by_full: HashMap<(u64, [u8; 32]), Vec<(PathBuf, Option<u64>)>> = HashMap::new();
        for ((size, _), files) in by_quick.into_iter().filter(|(_, files)| files.len() > 1) {
            for (path, modified) in files {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                match full_duplicate_fingerprint(&path) {
                    Ok(hash) => by_full
                        .entry((size, hash))
                        .or_default()
                        .push((path.clone(), modified)),
                    Err(_) => issues += 1,
                }
                processed_bytes = processed_bytes.saturating_add(size);
                let _ = app.emit(
                    "duplicate-scan-progress",
                    DuplicateScanProgress {
                        job_id: job_id.clone(),
                        phase: "verifying".into(),
                        scanned_files,
                        candidate_files,
                        processed_bytes,
                        current_path: public_path(&path),
                    },
                );
            }
        }

        let mut groups = by_full
            .into_iter()
            .filter(|(_, files)| files.len() > 1)
            .map(|((file_size, hash), files)| {
                let reclaimable_bytes =
                    file_size.saturating_mul(files.len().saturating_sub(1) as u64);
                let files = files
                    .into_iter()
                    .map(|(path, modified_unix_seconds)| SpaceScanItem {
                        name: path
                            .file_name()
                            .map(|name| name.to_string_lossy().to_string())
                            .unwrap_or_default(),
                        path: public_path(&path),
                        size: file_size,
                        modified_unix_seconds,
                        is_directory: false,
                    })
                    .collect();
                DuplicateGroup {
                    signature: duplicate_signature(&hash),
                    file_size,
                    reclaimable_bytes,
                    files,
                }
            })
            .collect::<Vec<_>>();
        groups.sort_by_key(|group| Reverse(group.reclaimable_bytes));
        let truncated = groups.len() > 500;
        groups.truncate(500);
        let reclaimable_bytes = groups.iter().map(|group| group.reclaimable_bytes).sum();
        DuplicateScanResult {
            root: public_path(&root),
            scanned_files,
            candidate_files,
            processed_bytes,
            reclaimable_bytes,
            issues,
            cancelled: cancel.load(Ordering::Relaxed),
            truncated,
            groups,
        }
    })
    .await
    .map_err(|error| app_error(error.to_string()));
    if let Ok(mut active) = jobs.0.lock() {
        active.remove(&cleanup_id);
    }
    result
}

#[tauri::command]
async fn recycle_verified_duplicates(
    request: DuplicateCleanupRequest,
) -> Result<FileOperationResult, String> {
    let root = require_directory(&request.root)?
        .canonicalize()
        .map_err(|error| app_error(error.to_string()))?;
    if request.groups.is_empty() || request.groups.len() > 500 {
        return Err(app_error("Review between 1 and 500 duplicate groups."));
    }
    let selected_count = request
        .groups
        .iter()
        .map(|group| group.recycle_paths.len())
        .sum::<usize>();
    if selected_count == 0 || selected_count > 500 {
        return Err(app_error(
            "Select between 1 and 500 reviewed duplicate files.",
        ));
    }

    tauri::async_runtime::spawn_blocking(move || {
        let mut seen = HashSet::new();
        let mut verified_recycle_paths = Vec::with_capacity(selected_count);

        // Validate the complete request before changing anything. Every group must retain one
        // distinct file inside the scanned root, and every selected file must still have the
        // same size and full SHA-256 content as that retained copy.
        for group in request.groups {
            if group.recycle_paths.is_empty() {
                return Err(app_error("A duplicate group has no reviewed files selected."));
            }
            let requested_keep = PathBuf::from(&group.keep_path);
            let keep = requested_keep
                .canonicalize()
                .map_err(|error| app_error(format!("Unable to verify the retained file: {error}")))?;
            if !keep.starts_with(&root) || !keep.is_file() {
                return Err(app_error("The retained file is outside the reviewed folder or no longer exists."));
            }
            let keep_key = public_path(&keep).to_lowercase();
            if !seen.insert(keep_key) {
                return Err(app_error("The same file appears in more than one duplicate group."));
            }
            let keep_size = keep
                .metadata()
                .map_err(|error| app_error(format!("Unable to read the retained file: {error}")))?
                .len();
            let keep_hash = full_duplicate_fingerprint(&keep)
                .map_err(|error| app_error(format!("Unable to verify the retained file contents: {error}")))?;

            for requested in group.recycle_paths {
                let requested_path = PathBuf::from(&requested);
                let path = requested_path
                    .canonicalize()
                    .map_err(|error| app_error(format!("Unable to verify a selected duplicate: {error}")))?;
                if !path.starts_with(&root) || !path.is_file() || path == keep {
                    return Err(app_error("A selected duplicate is outside the reviewed folder, missing, or is also the retained file."));
                }
                let key = public_path(&path).to_lowercase();
                if !seen.insert(key) {
                    return Err(app_error("The same file was selected more than once."));
                }
                let size = path
                    .metadata()
                    .map_err(|error| app_error(format!("Unable to read a selected duplicate: {error}")))?
                    .len();
                if size != keep_size {
                    return Err(app_error("A selected file changed size after the duplicate scan. Run the scan again."));
                }
                let hash = full_duplicate_fingerprint(&path)
                    .map_err(|error| app_error(format!("Unable to verify a selected duplicate: {error}")))?;
                if hash != keep_hash {
                    return Err(app_error("A selected file changed after the duplicate scan and is no longer identical. Run the scan again."));
                }
                verified_recycle_paths.push(path);
            }
        }

        let before: HashSet<String> = trash::os_limited::list()
            .map_err(|error| app_error(error.to_string()))?
            .into_iter()
            .map(|item| item.id.to_string_lossy().to_string())
            .collect();
        let mut completed_paths = Vec::new();
        let mut issues = Vec::new();
        for path in verified_recycle_paths {
            match trash::delete(&path) {
                Ok(()) => completed_paths.push(path),
                Err(error) => issues.push(operation_issue(&path, error.to_string())),
            }
        }
        let original_paths: HashSet<String> = completed_paths
            .iter()
            .map(|path| public_path(path).to_lowercase())
            .collect();
        let ids = trash::os_limited::list()
            .map_err(|error| app_error(error.to_string()))?
            .into_iter()
            .filter(|item| !before.contains(&item.id.to_string_lossy().to_string()))
            .filter(|item| original_paths.contains(&public_path(&item.original_path()).to_lowercase()))
            .map(|item| item.id.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        Ok(FileOperationResult {
            completed: completed_paths.len(),
            skipped: issues.len(),
            cancelled: false,
            error: None,
            issues,
            undo: if ids.is_empty() {
                None
            } else {
                Some(UndoAction::RestoreTrash { ids })
            },
        })
    })
    .await
    .map_err(|error| app_error(error.to_string()))?
}

#[tauri::command]
fn cancel_duplicate_scan(
    jobs: tauri::State<'_, DuplicateScanJobs>,
    job_id: String,
) -> Result<(), String> {
    let active = jobs
        .0
        .lock()
        .map_err(|_| app_error("Duplicate scan state is unavailable."))?;
    if let Some(cancel) = active.get(&job_id) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
async fn check_directory_status(path: String) -> Result<DirectoryStatus, String> {
    let requested = PathBuf::from(&path);
    let public = public_path(&requested);
    let kind = if public.starts_with("\\\\") {
        "network"
    } else if public.as_bytes().get(1) == Some(&b':') {
        "drive"
    } else {
        "folder"
    }
    .to_string();
    let kind_for_check = kind.clone();
    let (available, reason) =
        tauri::async_runtime::spawn_blocking(move || match fs::metadata(&requested) {
            Ok(metadata) if metadata.is_dir() => (true, None),
            Ok(_) => (false, Some("notFound".to_string())),
            Err(error) => {
                let reason = directory_unavailable_reason(&error, &kind_for_check);
                (false, Some(reason.to_string()))
            }
        })
        .await
        .map_err(|error| app_error(error.to_string()))?;
    Ok(DirectoryStatus {
        path: public,
        available,
        kind,
        reason,
    })
}

#[cfg(windows)]
thread_local! {
    static EVERYTHING_REPLY: RefCell<Option<Vec<u8>>> = const { RefCell::new(None) };
}

#[cfg(windows)]
const EVERYTHING_REPLY_MESSAGE: usize = 0x464C_4F57;

#[cfg(windows)]
unsafe extern "system" fn everything_reply_window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_COPYDATA {
        let data = unsafe { &*(lparam.0 as *const COPYDATASTRUCT) };
        if data.dwData == EVERYTHING_REPLY_MESSAGE && !data.lpData.is_null() && data.cbData > 0 {
            let bytes = unsafe {
                std::slice::from_raw_parts(data.lpData as *const u8, data.cbData as usize)
            };
            EVERYTHING_REPLY.with(|reply| *reply.borrow_mut() = Some(bytes.to_vec()));
            unsafe { PostQuitMessage(0) };
            return LRESULT(1);
        }
    } else if message == WM_TIMER && wparam.0 == 1 {
        unsafe { PostQuitMessage(1) };
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

#[cfg(windows)]
fn find_everything_ipc_window() -> Option<HWND> {
    unsafe { FindWindowW(w!("EVERYTHING_TASKBAR_NOTIFICATION"), PCWSTR::null()).ok() }
}

#[cfg(windows)]
fn ensure_everything_ipc_window() -> Option<HWND> {
    if let Some(window) = find_everything_ipc_window() {
        return Some(window);
    }
    let executable = everything_service_executable()?;
    if !executable.is_file() {
        return None;
    }
    let _ = Command::new(executable).arg("-startup").spawn().ok()?;
    for _ in 0..60 {
        thread::sleep(Duration::from_millis(50));
        if let Some(window) = find_everything_ipc_window() {
            return Some(window);
        }
    }
    None
}

#[cfg(windows)]
fn everything_ipc_value(window: HWND, operation: usize, parameter: isize) -> isize {
    unsafe {
        SendMessageW(
            window,
            WM_USER,
            Some(WPARAM(operation)),
            Some(LPARAM(parameter)),
        )
        .0
    }
}

#[cfg(windows)]
#[tauri::command]
fn get_everything_status() -> EverythingStatus {
    const GET_MAJOR_VERSION: usize = 0;
    const GET_MINOR_VERSION: usize = 1;
    const GET_REVISION: usize = 2;
    const GET_BUILD_NUMBER: usize = 3;
    const IS_NTFS_DRIVE_INDEXED: usize = 400;
    const IS_DB_LOADED: usize = 401;

    let executable = everything_service_executable();
    let window = find_everything_ipc_window();
    let running = window.is_some();
    let mut database_loaded = false;
    let mut version = None;
    let mut indexed_drives = Vec::new();
    if let Some(window) = window {
        database_loaded = everything_ipc_value(window, IS_DB_LOADED, 0) != 0;
        let major = everything_ipc_value(window, GET_MAJOR_VERSION, 0);
        let minor = everything_ipc_value(window, GET_MINOR_VERSION, 0);
        let revision = everything_ipc_value(window, GET_REVISION, 0);
        let build = everything_ipc_value(window, GET_BUILD_NUMBER, 0);
        if major > 0 {
            version = Some(format!("{major}.{minor}.{revision}.{build}"));
        }
        for index in 0..26isize {
            if everything_ipc_value(window, IS_NTFS_DRIVE_INDEXED, index) != 0 {
                indexed_drives.push(format!("{}:\\", (b'A' + index as u8) as char));
            }
        }
    }
    EverythingStatus {
        installed: executable.as_ref().is_some_and(|path| path.is_file()),
        running,
        database_loaded,
        version,
        executable: executable.map(|path| public_path(&path)),
        indexed_drives,
    }
}

#[cfg(not(windows))]
#[tauri::command]
fn get_everything_status() -> EverythingStatus {
    EverythingStatus {
        installed: false,
        running: false,
        database_loaded: false,
        version: None,
        executable: None,
        indexed_drives: Vec::new(),
    }
}

#[cfg(windows)]
fn read_packed_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    let chunk: [u8; 4] = bytes.get(offset..offset + 4)?.try_into().ok()?;
    Some(u32::from_le_bytes(chunk))
}

#[cfg(windows)]
fn read_packed_utf16(bytes: &[u8], offset: usize) -> Option<String> {
    if offset >= bytes.len() {
        return None;
    }
    let mut words = Vec::new();
    let mut cursor = offset;
    while cursor + 1 < bytes.len() {
        let word = u16::from_le_bytes([bytes[cursor], bytes[cursor + 1]]);
        if word == 0 {
            return Some(String::from_utf16_lossy(&words));
        }
        words.push(word);
        cursor += 2;
    }
    None
}

#[cfg(windows)]
fn everything_query_text(request: &SearchRequest, root: &Path) -> String {
    let mut root_text = public_path(root).trim_end_matches(['\\', '/']).to_string();
    root_text.push('\\');
    let mut parts = vec![format!("\"{}\"", root_text.replace('"', "\"\""))];
    let query = request.query.trim();
    if !query.is_empty() {
        parts.push(format!("\"{}\"", query.replace('"', "\"\"")));
    }
    match request.kind.as_str() {
        "folders" => parts.push("folder:".into()),
        "images" => parts.push("ext:png;jpg;jpeg;webp;gif;heic;bmp;svg".into()),
        "documents" => parts.push("ext:txt;md;pdf;doc;docx;rtf;odt;xls;xlsx;csv;ppt;pptx".into()),
        "videos" => parts.push("ext:mp4;mkv;mov;avi;webm;wmv;m4v".into()),
        "audio" => parts.push("ext:mp3;wav;flac;aac;m4a;ogg;wma".into()),
        "archives" => parts.push("ext:zip;rar;7z;tar;gz;bz2;xz".into()),
        _ => {}
    }
    parts.join(" ")
}

#[cfg(windows)]
fn run_everything_ipc_query(search: &str) -> Result<Vec<u8>, String> {
    let everything_window = ensure_everything_ipc_window()
        .ok_or_else(|| app_error("Everything IPC is not available."))?;
    let module = unsafe { GetModuleHandleW(None) }.map_err(|error| app_error(error.to_string()))?;
    let instance = HINSTANCE(module.0);
    let class = w!("FLOW_FILES_EVERYTHING_IPC");
    let window_class = WNDCLASSW {
        hInstance: instance,
        lpfnWndProc: Some(everything_reply_window_proc),
        lpszClassName: class,
        ..Default::default()
    };
    unsafe { RegisterClassW(&window_class) };
    let reply_window = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class,
            w!(""),
            WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            None,
            None,
            Some(instance),
            None,
        )
    }
    .map_err(|error| app_error(error.to_string()))?;

    EVERYTHING_REPLY.with(|reply| *reply.borrow_mut() = None);
    let mut query = Vec::with_capacity(20 + (search.encode_utf16().count() + 1) * 2);
    for value in [
        reply_window.0 as usize as u32,
        EVERYTHING_REPLY_MESSAGE as u32,
        0,
        0,
        MAX_EVERYTHING_CANDIDATES as u32,
    ] {
        query.extend_from_slice(&value.to_le_bytes());
    }
    for word in search.encode_utf16().chain(Some(0)) {
        query.extend_from_slice(&word.to_le_bytes());
    }
    let copy_data = COPYDATASTRUCT {
        dwData: 2,
        cbData: query.len() as u32,
        lpData: query.as_mut_ptr().cast(),
    };
    unsafe { SetTimer(Some(reply_window), 1, 5_000, None) };
    let accepted = unsafe {
        SendMessageW(
            everything_window,
            WM_COPYDATA,
            Some(WPARAM(reply_window.0 as usize)),
            Some(LPARAM((&copy_data as *const COPYDATASTRUCT) as isize)),
        )
    };
    if accepted.0 != 0 {
        let mut message = MSG::default();
        loop {
            let received = unsafe { GetMessageW(&mut message, None, 0, 0) };
            if received.0 <= 0 {
                break;
            }
            unsafe {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
    }
    unsafe {
        let _ = KillTimer(Some(reply_window), 1);
        let _ = DestroyWindow(reply_window);
    }
    EVERYTHING_REPLY
        .with(|reply| reply.borrow_mut().take())
        .ok_or_else(|| app_error("Everything did not return a search result."))
}

#[cfg(windows)]
fn try_everything_search(
    request: &SearchRequest,
    root: &Path,
    cancel: &AtomicBool,
) -> Option<SearchResult> {
    if request.query.trim().is_empty()
        && (request.modified_after.is_some()
            || request.min_size.is_some()
            || request.max_size.is_some())
    {
        return None;
    }
    let reply = run_everything_ipc_query(&everything_query_text(request, root)).ok()?;
    let total = read_packed_u32(&reply, 8)? as usize;
    let available = read_packed_u32(&reply, 20)? as usize;
    let items_start = 28usize;
    if items_start.checked_add(available.checked_mul(12)?)? > reply.len() {
        return None;
    }
    let query = request.query.trim().to_lowercase();
    let mut entries = Vec::new();
    for index in 0..available {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let item = items_start + index * 12;
        let filename_offset = read_packed_u32(&reply, item + 4)? as usize;
        let path_offset = read_packed_u32(&reply, item + 8)? as usize;
        let name = read_packed_utf16(&reply, filename_offset)?;
        if !query.is_empty() && !name.to_lowercase().contains(&query) {
            continue;
        }
        let directory = read_packed_utf16(&reply, path_offset)?;
        let path = PathBuf::from(directory).join(&name);
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        let entry = entry_from_metadata(&path, name, &metadata);
        if entry.is_hidden && !request.include_hidden {
            continue;
        }
        let date_matches = request.modified_after.is_none_or(|after| {
            entry
                .modified_unix_seconds
                .is_some_and(|modified| modified >= after)
        });
        let size_matches = if request.min_size.is_some() || request.max_size.is_some() {
            !entry.is_directory
                && request.min_size.is_none_or(|minimum| entry.size >= minimum)
                && request.max_size.is_none_or(|maximum| entry.size <= maximum)
        } else {
            true
        };
        if matches_search_kind(&entry, &request.kind) && date_matches && size_matches {
            entries.push(entry);
            if entries.len() >= MAX_SEARCH_RESULTS {
                break;
            }
        }
    }
    entries.sort_by(|left, right| left.path.to_lowercase().cmp(&right.path.to_lowercase()));
    Some(SearchResult {
        truncated: total > available || entries.len() >= MAX_SEARCH_RESULTS,
        entries,
        scanned: total,
        cancelled: cancel.load(Ordering::Relaxed),
        provider: "everything".into(),
    })
}

#[cfg(not(windows))]
fn try_everything_search(
    _request: &SearchRequest,
    _root: &Path,
    _cancel: &AtomicBool,
) -> Option<SearchResult> {
    None
}

#[tauri::command]
async fn search_directory(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, SearchJobs>,
    request: SearchRequest,
) -> Result<SearchResult, String> {
    let root = require_directory(&request.root)?;
    if !matches!(
        request.kind.as_str(),
        "all" | "folders" | "images" | "documents" | "videos" | "audio" | "archives"
    ) {
        return Err(app_error("Unsupported search type."));
    }
    let cancel = Arc::new(AtomicBool::new(false));
    jobs.0
        .lock()
        .map_err(|_| app_error("Search state is unavailable."))?
        .insert(request.job_id.clone(), cancel.clone());
    let job_id = request.job_id.clone();
    let cleanup_id = job_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        if request.prefer_everything {
            if let Some(result) = try_everything_search(&request, &root, &cancel) {
                return result;
            }
        }
        let query = request.query.trim().to_lowercase();
        let mut stack = vec![root];
        let mut entries = Vec::new();
        let mut scanned = 0usize;
        let mut truncated = false;

        'walk: while let Some(directory) = stack.pop() {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            let Ok(items) = fs::read_dir(&directory) else {
                continue;
            };
            for item in items.flatten() {
                if cancel.load(Ordering::Relaxed) {
                    break 'walk;
                }
                let path = item.path();
                let Ok(metadata) = item.metadata() else {
                    continue;
                };
                let name = item.file_name().to_string_lossy().to_string();
                let entry = entry_from_metadata(&path, name, &metadata);
                if entry.is_hidden && !request.include_hidden {
                    continue;
                }
                scanned += 1;
                let is_symlink = item
                    .file_type()
                    .map(|kind| kind.is_symlink())
                    .unwrap_or(true);
                if entry.is_directory && !is_symlink {
                    stack.push(path);
                }

                let name_matches = query.is_empty() || entry.name.to_lowercase().contains(&query);
                let kind_matches = matches_search_kind(&entry, &request.kind);
                let date_matches = request.modified_after.is_none_or(|after| {
                    entry
                        .modified_unix_seconds
                        .is_some_and(|modified| modified >= after)
                });
                let size_matches = if request.min_size.is_some() || request.max_size.is_some() {
                    !entry.is_directory
                        && request.min_size.is_none_or(|minimum| entry.size >= minimum)
                        && request.max_size.is_none_or(|maximum| entry.size <= maximum)
                } else {
                    true
                };
                if name_matches && kind_matches && date_matches && size_matches {
                    entries.push(entry);
                    if entries.len() >= MAX_SEARCH_RESULTS {
                        truncated = true;
                        break 'walk;
                    }
                }
                if scanned % 256 == 0 {
                    let _ = app.emit(
                        "search-progress",
                        SearchProgress {
                            job_id: job_id.clone(),
                            scanned,
                            matches: entries.len(),
                            current_path: public_path(&directory),
                        },
                    );
                }
            }
        }
        entries.sort_by(|left, right| left.path.to_lowercase().cmp(&right.path.to_lowercase()));
        let cancelled = cancel.load(Ordering::Relaxed);
        let _ = app.emit(
            "search-progress",
            SearchProgress {
                job_id,
                scanned,
                matches: entries.len(),
                current_path: String::new(),
            },
        );
        SearchResult {
            entries,
            scanned,
            cancelled,
            truncated,
            provider: "native".into(),
        }
    })
    .await
    .map_err(|error| app_error(error.to_string()));
    if let Ok(mut active) = jobs.0.lock() {
        active.remove(&cleanup_id);
    }
    result
}

#[tauri::command]
fn cancel_search(jobs: tauri::State<'_, SearchJobs>, job_id: String) -> Result<(), String> {
    let active = jobs
        .0
        .lock()
        .map_err(|_| app_error("Search state is unavailable."))?;
    if let Some(cancel) = active.get(&job_id) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
fn set_file_clipboard(paths: Vec<String>, mode: String) -> Result<(), String> {
    if mode != "copy" && mode != "move" {
        return Err(app_error("Unsupported clipboard operation."));
    }
    let existing = paths
        .into_iter()
        .filter(|path| Path::new(path).exists())
        .collect::<Vec<_>>();
    #[cfg(windows)]
    {
        write_windows_file_clipboard(&existing, &mode)
    }
    #[cfg(not(windows))]
    {
        let _ = existing;
        Err(app_error(
            "File clipboard integration is only available on Windows.",
        ))
    }
}

#[tauri::command]
fn set_text_clipboard(text: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let wide = text.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        let bytes =
            unsafe { std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2) };
        let _clipboard = open_windows_clipboard()?;
        let memory = allocate_clipboard_bytes(bytes)?;
        if let Err(error) = unsafe { EmptyClipboard() } {
            unsafe {
                let _ = GlobalFree(Some(memory));
            }
            return Err(app_error(error.to_string()));
        }
        if let Err(error) = unsafe { SetClipboardData(13, Some(HANDLE(memory.0))) } {
            unsafe {
                let _ = GlobalFree(Some(memory));
            }
            return Err(app_error(error.to_string()));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = text;
        Err(app_error(
            "Text clipboard integration is only available on Windows.",
        ))
    }
}

#[tauri::command]
fn get_file_clipboard() -> Result<ClipboardPayload, String> {
    #[cfg(windows)]
    {
        read_windows_file_clipboard()
    }
    #[cfg(not(windows))]
    {
        Ok(ClipboardPayload {
            paths: Vec::new(),
            mode: "copy".into(),
        })
    }
}

#[tauri::command]
fn watch_directory(
    app: tauri::AppHandle,
    watch: tauri::State<'_, DirectoryWatch>,
    path: String,
) -> Result<(), String> {
    let directory = require_directory(&path)?;
    let public = public_path(&directory);
    let generation = watch.0.fetch_add(1, Ordering::SeqCst) + 1;
    let current_generation = watch.0.clone();
    #[cfg(windows)]
    thread::spawn(move || {
        let windows_path = windows::core::HSTRING::from(directory.to_string_lossy().as_ref());
        let filter = FILE_NOTIFY_CHANGE_FILE_NAME
            | FILE_NOTIFY_CHANGE_DIR_NAME
            | FILE_NOTIFY_CHANGE_LAST_WRITE
            | FILE_NOTIFY_CHANGE_SIZE;
        let Ok(handle) = (unsafe { FindFirstChangeNotificationW(&windows_path, false, filter) })
        else {
            return;
        };
        loop {
            if current_generation.load(Ordering::SeqCst) != generation {
                break;
            }
            if unsafe { WaitForSingleObject(handle, 300) } == WAIT_OBJECT_0 {
                let _ = app.emit(
                    "directory-changed",
                    DirectoryChanged {
                        path: public.clone(),
                    },
                );
                if unsafe { FindNextChangeNotification(handle) }.is_err() {
                    break;
                }
            }
        }
        unsafe {
            let _ = FindCloseChangeNotification(handle);
        }
    });
    #[cfg(not(windows))]
    {
        let _ = (app, public, generation, current_generation);
    }
    Ok(())
}

#[tauri::command]
fn find_conflicts(sources: Vec<String>, destination: String) -> Result<Vec<ConflictEntry>, String> {
    let destination = require_directory(&destination)?;
    let mut conflicts = Vec::new();
    for source in sources {
        let source = PathBuf::from(&source);
        if !source.exists() {
            continue;
        }
        let Some(name) = source.file_name() else {
            continue;
        };
        let target = destination.join(name);
        if target.exists() {
            let source_metadata =
                fs::symlink_metadata(&source).map_err(|error| app_error(error.to_string()))?;
            let target_metadata =
                fs::symlink_metadata(&target).map_err(|error| app_error(error.to_string()))?;
            conflicts.push(ConflictEntry {
                source: entry_from_metadata(
                    &source,
                    name.to_string_lossy().to_string(),
                    &source_metadata,
                ),
                target: entry_from_metadata(
                    &target,
                    name.to_string_lossy().to_string(),
                    &target_metadata,
                ),
            });
        }
    }
    Ok(conflicts)
}

#[tauri::command]
async fn run_file_operation(
    app: tauri::AppHandle,
    jobs: tauri::State<'_, OperationJobs>,
    request: FileOperationRequest,
) -> Result<FileOperationResult, String> {
    if request.mode != "copy" && request.mode != "move" {
        return Err(app_error("Unsupported file operation."));
    }
    if !matches!(request.conflict.as_str(), "replace" | "skip" | "keepBoth") {
        return Err(app_error("Unsupported conflict choice."));
    }
    let mut conflict_resolutions = HashMap::new();
    for resolution in request.conflict_resolutions {
        if !matches!(resolution.action.as_str(), "replace" | "skip" | "keepBoth") {
            return Err(app_error("Unsupported per-item conflict choice."));
        }
        let source = PathBuf::from(&resolution.source);
        let normalized = source.canonicalize().unwrap_or(source);
        conflict_resolutions.insert(public_path(&normalized).to_lowercase(), resolution.action);
    }
    let destination = require_directory(&request.destination)?;
    let mut initial_issues = Vec::new();
    let mut seen_sources = HashSet::new();
    let mut sources: Vec<PathBuf> = request
        .sources
        .iter()
        .filter_map(|source| {
            let path = PathBuf::from(source);
            if !path.exists() {
                initial_issues.push(operation_issue(&path, "The item no longer exists."));
                return None;
            }
            let canonical = path.canonicalize().unwrap_or(path);
            let key = public_path(&canonical).to_lowercase();
            if !seen_sources.insert(key) {
                return None;
            }
            Some(canonical)
        })
        .collect();
    let selected_directories: HashSet<String> = sources
        .iter()
        .filter(|path| path.is_dir())
        .map(|path| public_path(path).to_lowercase())
        .collect();
    sources.retain(|candidate| {
        let mut ancestor = candidate.parent();
        while let Some(parent) = ancestor {
            if selected_directories.contains(&public_path(parent).to_lowercase()) {
                return false;
            }
            ancestor = parent.parent();
        }
        true
    });
    if sources.is_empty() {
        return Ok(FileOperationResult {
            completed: 0,
            skipped: initial_issues.len(),
            cancelled: false,
            error: None,
            issues: initial_issues,
            undo: None,
        });
    }
    for source in &sources {
        if source.is_dir() && is_inside(source, &destination) {
            return Err(app_error("A folder cannot be copied or moved into itself."));
        }
    }

    let control = Arc::new(OperationControl {
        rate_limit_bytes_per_second: AtomicU64::new(request.rate_limit_bytes_per_second),
        ..OperationControl::default()
    });
    jobs.0
        .lock()
        .map_err(|_| app_error("Operation state is unavailable."))?
        .insert(request.job_id.clone(), control.clone());
    let job_id = request.job_id.clone();
    let mode = request.mode.clone();
    let conflict = request.conflict.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        // Scan once off the async runtime, report progress, and reuse the sizes during transfer.
        let mut scan = ScanContext {
            app: app.clone(),
            job_id: job_id.clone(),
            control: control.clone(),
            scanned_items: 0,
            scanned_bytes: 0,
            total_items: sources.len(),
            current_name: String::new(),
            last_emit: Instant::now() - Duration::from_secs(1),
        };
        scan.emit(true);
        let mut source_sizes = Vec::with_capacity(sources.len());
        for source in &sources {
            match scan_path_size(source, &mut scan) {
                Ok(size) => source_sizes.push(size),
                Err(error) if error == "Operation cancelled." => {
                    scan.emit(true);
                    return FileOperationResult {
                        completed: 0,
                        skipped: initial_issues.len(),
                        cancelled: true,
                        error: None,
                        issues: initial_issues,
                        undo: None,
                    };
                }
                Err(error) => {
                    return FileOperationResult {
                        completed: 0,
                        skipped: sources.len() + initial_issues.len(),
                        cancelled: false,
                        error: Some(error),
                        issues: initial_issues,
                        undo: None,
                    };
                }
            }
        }
        scan.emit(true);
        let total_bytes: u64 = source_sizes.iter().sum();
        let destination_volume = volume_key(&destination);
        let required_bytes: u64 = sources
            .iter()
            .zip(source_sizes.iter())
            .filter(|(source, _)| mode == "copy" || volume_key(source) != destination_volume)
            .map(|(_, size)| *size)
            .sum();
        if required_bytes > 0 {
            if let Ok(available) = fs2::available_space(&destination) {
                if required_bytes > available {
                    return FileOperationResult {
                        completed: 0,
                        skipped: sources.len() + initial_issues.len(),
                        cancelled: false,
                        error: Some(format!(
                            "Not enough free space. The operation needs {} bytes but only {} bytes are available.",
                            required_bytes, available
                        )),
                        issues: sources
                            .iter()
                            .map(|source| {
                                operation_issue(
                                    source,
                                    "Not enough space on the destination disk (os error 112).",
                                )
                            })
                            .collect(),
                        undo: None,
                    };
                }
            }
        }
        let mut progress = ProgressContext {
            app,
            job_id,
            control,
            processed_bytes: 0,
            total_bytes,
            completed_items: 0,
            total_items: sources.len(),
            current_name: String::new(),
            scanned_items: scan.scanned_items,
            scanned_bytes: scan.scanned_bytes,
            throttle_window_started: Instant::now(),
            throttle_window_bytes: 0,
        };
        progress.emit();
        let mut completed_targets = Vec::new();
        let mut move_pairs = Vec::new();
        let mut replaced_existing = false;
        let mut skipped = initial_issues.len();
        let mut issues = initial_issues;

        for (source_index, source) in sources.into_iter().enumerate() {
            if progress.checkpoint().is_err() {
                break;
            }
            let Some(name) = source.file_name() else {
                skipped += 1;
                continue;
            };
            progress.current_name = name.to_string_lossy().to_string();
            progress.emit();
            let mut target = destination.join(name);
            let source_key = public_path(&source).to_lowercase();
            let conflict_action = conflict_resolutions
                .get(&source_key)
                .map(String::as_str)
                .unwrap_or(conflict.as_str());
            if source == target && !(mode == "copy" && conflict_action == "keepBoth") {
                skipped += 1;
                continue;
            }
            if target.exists() {
                if conflict_action == "skip" {
                    skipped += 1;
                    continue;
                }
                if conflict_action == "keepBoth" {
                    target = keep_both_path(&target);
                }
            }

            let backup = if target.exists() && conflict_action == "replace" {
                let backup = target.with_file_name(format!(
                    ".flow-backup-{}-{}",
                    progress.job_id, progress.completed_items
                ));
                if let Err(error) = fs::rename(&target, &backup) {
                    issues.push(operation_issue(
                        &source,
                        format!("Could not replace {}: {error}", public_path(&target)),
                    ));
                    skipped += 1;
                    continue;
                }
                Some(backup)
            } else {
                None
            };

            let source_size = source_sizes[source_index];
            let operation = if mode == "move" {
                if progress.cancelled() {
                    Err(app_error("Operation cancelled."))
                } else {
                    match fs::rename(&source, &target) {
                        Ok(()) => {
                            progress.processed_bytes =
                                progress.processed_bytes.saturating_add(source_size);
                            Ok(())
                        }
                        Err(rename_error) => {
                            copy_path_with_progress(&source, &target, &mut progress)
                                .and_then(|_| remove_path(&source))
                                .map_err(|copy_error| {
                                    format!(
                                        "{copy_error} (direct move failed first: {rename_error})"
                                    )
                                })
                        }
                    }
                }
            } else {
                copy_path_with_progress(&source, &target, &mut progress)
            };

            match operation {
                Ok(()) => {
                    if let Some(backup) = backup {
                        replaced_existing = true;
                        let _ = remove_path(&backup);
                    }
                    completed_targets.push(public_path(&target));
                    if mode == "move" {
                        move_pairs.push(PathPair {
                            from: public_path(&target),
                            to: public_path(&source),
                        });
                    }
                    progress.completed_items += 1;
                    progress.emit();
                }
                Err(error) => {
                    let _ = remove_path(&target);
                    if let Some(backup) = backup {
                        let _ = fs::rename(backup, &target);
                    }
                    if error != "Operation cancelled." {
                        issues.push(operation_issue(&source, error));
                        skipped += 1;
                        progress.emit();
                        continue;
                    }
                    break;
                }
            }
        }

        let undo = if replaced_existing {
            None
        } else if mode == "move" && !move_pairs.is_empty() {
            Some(UndoAction::Move { pairs: move_pairs })
        } else if mode == "copy" && !completed_targets.is_empty() {
            Some(UndoAction::DeleteCreated {
                paths: completed_targets,
            })
        } else {
            None
        };
        FileOperationResult {
            completed: progress.completed_items,
            skipped,
            cancelled: progress.cancelled(),
            error: None,
            issues,
            undo,
        }
    })
    .await
    .map_err(|error| app_error(error.to_string()));
    if let Ok(mut jobs) = jobs.0.lock() {
        jobs.remove(&request.job_id);
    }
    result
}

#[tauri::command]
fn cancel_file_operation(
    jobs: tauri::State<'_, OperationJobs>,
    job_id: String,
) -> Result<(), String> {
    let jobs = jobs
        .0
        .lock()
        .map_err(|_| app_error("Operation state is unavailable."))?;
    if let Some(control) = jobs.get(&job_id) {
        control.cancelled.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
fn set_file_operation_paused(
    jobs: tauri::State<'_, OperationJobs>,
    job_id: String,
    paused: bool,
) -> Result<(), String> {
    let jobs = jobs
        .0
        .lock()
        .map_err(|_| app_error("Operation state is unavailable."))?;
    if let Some(control) = jobs.get(&job_id) {
        control.paused.store(paused, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
fn set_file_operation_rate_limit(
    jobs: tauri::State<'_, OperationJobs>,
    job_id: String,
    bytes_per_second: u64,
) -> Result<(), String> {
    let jobs = jobs
        .0
        .lock()
        .map_err(|_| app_error("Operation state is unavailable."))?;
    if let Some(control) = jobs.get(&job_id) {
        control
            .rate_limit_bytes_per_second
            .store(bytes_per_second, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
async fn recycle_paths(paths: Vec<String>) -> Result<FileOperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let before: HashSet<String> = trash::os_limited::list()
            .map_err(|error| app_error(error.to_string()))?
            .into_iter()
            .map(|item| item.id.to_string_lossy().to_string())
            .collect();
        let mut completed_paths = Vec::new();
        let mut issues = Vec::new();
        for requested in paths.into_iter().map(PathBuf::from) {
            if !requested.exists() {
                issues.push(operation_issue(&requested, "The item no longer exists."));
                continue;
            }
            let canonical = requested.canonicalize().unwrap_or(requested);
            match trash::delete(&canonical) {
                Ok(()) => completed_paths.push(canonical),
                Err(error) => issues.push(operation_issue(&canonical, error.to_string())),
            }
        }
        let original_paths: HashSet<String> = completed_paths
            .iter()
            .map(|path| public_path(path).to_lowercase())
            .collect();
        let ids = trash::os_limited::list()
            .map_err(|error| app_error(error.to_string()))?
            .into_iter()
            .filter(|item| !before.contains(&item.id.to_string_lossy().to_string()))
            .filter(|item| {
                original_paths.contains(&public_path(&item.original_path()).to_lowercase())
            })
            .map(|item| item.id.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        let completed = completed_paths.len();
        let skipped = issues.len();
        Ok(FileOperationResult {
            completed,
            skipped,
            cancelled: false,
            error: None,
            issues,
            undo: if ids.is_empty() {
                None
            } else {
                Some(UndoAction::RestoreTrash { ids })
            },
        })
    })
    .await
    .map_err(|error| app_error(error.to_string()))?
}

#[tauri::command]
async fn permanently_delete_paths(paths: Vec<String>) -> Result<FileOperationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut completed = 0;
        let mut issues = Vec::new();
        for path in paths.into_iter().map(PathBuf::from) {
            if !path.exists() {
                issues.push(operation_issue(&path, "The item no longer exists."));
                continue;
            }
            let canonical = path.canonicalize().unwrap_or(path);
            match remove_path(&canonical) {
                Ok(()) => completed += 1,
                Err(error) => issues.push(operation_issue(&canonical, error)),
            }
        }
        Ok(FileOperationResult {
            completed,
            skipped: issues.len(),
            cancelled: false,
            error: None,
            issues,
            undo: None,
        })
    })
    .await
    .map_err(|error| app_error(error.to_string()))?
}

#[tauri::command]
async fn undo_operation(action: UndoAction) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || match action {
        UndoAction::DeleteCreated { paths } => {
            let existing: Vec<PathBuf> = paths
                .into_iter()
                .map(PathBuf::from)
                .filter(|path| path.exists())
                .collect();
            trash::delete_all(existing).map_err(|error| app_error(error.to_string()))
        }
        UndoAction::Move { pairs } => {
            for pair in pairs.into_iter().rev() {
                let from = PathBuf::from(pair.from);
                let to = PathBuf::from(pair.to);
                if to.exists() {
                    return Err(app_error(format!(
                        "Cannot undo because {} already exists.",
                        public_path(&to)
                    )));
                }
                if fs::rename(&from, &to).is_err() {
                    copy_path_plain(&from, &to)?;
                    remove_path(&from)?;
                }
            }
            Ok(())
        }
        UndoAction::RestoreTrash { ids } => {
            let ids: HashSet<String> = ids.into_iter().collect();
            let items = trash::os_limited::list()
                .map_err(|error| app_error(error.to_string()))?
                .into_iter()
                .filter(|item| ids.contains(&item.id.to_string_lossy().to_string()))
                .collect::<Vec<_>>();
            if items.is_empty() {
                return Err(app_error(
                    "The deleted items are no longer in the Recycle Bin.",
                ));
            }
            trash::os_limited::restore_all(items).map_err(|error| app_error(error.to_string()))
        }
    })
    .await
    .map_err(|error| app_error(error.to_string()))?
}

#[tauri::command]
async fn load_thumbnails(
    jobs: tauri::State<'_, ThumbnailJobs>,
    job_id: String,
    paths: Vec<String>,
) -> Result<Vec<Thumbnail>, String> {
    let requested: Vec<PathBuf> = paths
        .into_iter()
        .take(MAX_THUMBNAIL_BATCH)
        .map(PathBuf::from)
        .collect();
    let cancel = Arc::new(AtomicBool::new(false));
    jobs.0
        .lock()
        .map_err(|_| app_error("Thumbnail loading state is unavailable."))?
        .insert(job_id.clone(), cancel.clone());
    let cleanup_id = job_id;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut thumbnails = Vec::new();
        for path in requested {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            if let Ok(thumbnail) = create_thumbnail(&path) {
                thumbnails.push(thumbnail);
            }
        }
        thumbnails
    })
    .await
    .map_err(|error| app_error(error.to_string()));
    if let Ok(mut active) = jobs.0.lock() {
        active.remove(&cleanup_id);
    }
    result
}

#[tauri::command]
fn cancel_thumbnail_job(
    jobs: tauri::State<'_, ThumbnailJobs>,
    job_id: String,
) -> Result<(), String> {
    let active = jobs
        .0
        .lock()
        .map_err(|_| app_error("Thumbnail loading state is unavailable."))?;
    if let Some(cancel) = active.get(&job_id) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
async fn load_file_icons(paths: Vec<String>) -> Result<Vec<Thumbnail>, String> {
    let requested: Vec<PathBuf> = paths
        .into_iter()
        .take(MAX_ICON_BATCH)
        .map(PathBuf::from)
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            requested
                .iter()
                .filter_map(|path| create_windows_file_icon(path).ok())
                .collect()
        }
        #[cfg(not(windows))]
        {
            let _ = requested;
            Vec::new()
        }
    })
    .await
    .map_err(|error| app_error(error.to_string()))
}

#[tauri::command]
async fn load_file_preview(
    path: String,
    text_encoding: Option<String>,
    text_offset: Option<u64>,
) -> Result<FilePreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        create_file_preview(
            Path::new(&path),
            text_encoding.as_deref(),
            text_offset.unwrap_or(0),
        )
    })
    .await
    .map_err(|error| app_error(error.to_string()))?
}

#[tauri::command]
async fn load_file_details(path: String) -> Result<FileDetails, String> {
    tauri::async_runtime::spawn_blocking(move || create_file_details(Path::new(&path)))
        .await
        .map_err(|error| app_error(error.to_string()))?
}

#[tauri::command]
async fn create_zip_archive(
    paths: Vec<String>,
    destination: String,
    archive_name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if paths.is_empty() {
            return Err(app_error("No items were selected."));
        }
        let destination = require_directory(&destination)?;
        let mut archive_name = archive_name.trim().to_string();
        if !archive_name.to_ascii_lowercase().ends_with(".zip") {
            archive_name.push_str(".zip");
        }
        validate_leaf_name(&archive_name)?;
        let output = keep_both_path(&destination.join(archive_name));
        let file = fs::File::create(&output).map_err(|error| app_error(error.to_string()))?;
        let mut writer = zip::ZipWriter::new(std::io::BufWriter::new(file));
        let mut added_roots = HashSet::new();

        fn append_path<W: Write + Seek>(
            writer: &mut zip::ZipWriter<W>,
            source: &Path,
            archive_path: &str,
        ) -> Result<(), String> {
            let metadata =
                fs::symlink_metadata(source).map_err(|error| app_error(error.to_string()))?;
            if metadata.file_type().is_symlink() {
                return Err(app_error(format!(
                    "Symbolic link was not archived for safety: {}",
                    public_path(source)
                )));
            }
            if metadata.is_dir() {
                let directory_name = format!("{}/", archive_path.trim_end_matches('/'));
                writer
                    .add_directory(directory_name, zip::write::SimpleFileOptions::default())
                    .map_err(|error| app_error(error.to_string()))?;
                for entry in fs::read_dir(source).map_err(|error| app_error(error.to_string()))? {
                    let entry = entry.map_err(|error| app_error(error.to_string()))?;
                    let child_name = entry.file_name().to_string_lossy().to_string();
                    append_path(
                        writer,
                        &entry.path(),
                        &format!("{}/{}", archive_path.trim_end_matches('/'), child_name),
                    )?;
                }
            } else if metadata.is_file() {
                writer
                    .start_file(
                        archive_path,
                        zip::write::SimpleFileOptions::default()
                            .compression_method(zip::CompressionMethod::Deflated),
                    )
                    .map_err(|error| app_error(error.to_string()))?;
                let mut input =
                    fs::File::open(source).map_err(|error| app_error(error.to_string()))?;
                std::io::copy(&mut input, writer).map_err(|error| app_error(error.to_string()))?;
            } else {
                return Err(app_error(format!(
                    "Unsupported special item: {}",
                    public_path(source)
                )));
            }
            Ok(())
        }

        let result = (|| -> Result<(), String> {
            for requested in paths {
                let source = PathBuf::from(requested);
                if !source.exists() {
                    return Err(app_error(format!(
                        "The item no longer exists: {}",
                        public_path(&source)
                    )));
                }
                let mut root_name = source
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("item")
                    .to_string();
                if !added_roots.insert(root_name.to_lowercase()) {
                    for index in 2..10_000 {
                        let candidate = format!("{root_name} ({index})");
                        if added_roots.insert(candidate.to_lowercase()) {
                            root_name = candidate;
                            break;
                        }
                    }
                }
                append_path(&mut writer, &source, &root_name)?;
            }
            writer
                .finish()
                .map_err(|error| app_error(error.to_string()))?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = fs::remove_file(&output);
            return Err(error);
        }
        Ok(public_path(&output))
    })
    .await
    .map_err(|error| app_error(error.to_string()))?
}

#[tauri::command]
async fn extract_zip_archive(path: String, destination: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let archive_path = PathBuf::from(path);
        if !archive_path.is_file()
            || archive_path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| !value.eq_ignore_ascii_case("zip"))
                .unwrap_or(true)
        {
            return Err(app_error("Select one ZIP archive to extract."));
        }
        let destination = require_directory(&destination)?;
        let input = fs::File::open(&archive_path).map_err(|error| app_error(error.to_string()))?;
        let mut archive =
            zip::ZipArchive::new(input).map_err(|error| app_error(error.to_string()))?;
        if archive.len() > 100_000 {
            return Err(app_error("This archive contains too many entries."));
        }
        let mut expanded_size = 0u64;
        for index in 0..archive.len() {
            let entry = archive
                .by_index(index)
                .map_err(|error| app_error(error.to_string()))?;
            expanded_size = expanded_size.saturating_add(entry.size());
        }
        if let Ok(available) = fs2::available_space(&destination) {
            if expanded_size > available {
                return Err(app_error(
                    "Not enough space on the destination disk (os error 112).",
                ));
            }
        }
        let folder_name = archive_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("Archive");
        let output_root = keep_both_path(&destination.join(folder_name));
        fs::create_dir_all(&output_root).map_err(|error| app_error(error.to_string()))?;
        let extract_result = (|| -> Result<(), String> {
            for index in 0..archive.len() {
                let mut entry = archive
                    .by_index(index)
                    .map_err(|error| app_error(error.to_string()))?;
                let relative = entry
                    .enclosed_name()
                    .ok_or_else(|| app_error("The archive contains an unsafe path."))?;
                let output = output_root.join(relative);
                if entry.is_dir() {
                    fs::create_dir_all(&output).map_err(|error| app_error(error.to_string()))?;
                    continue;
                }
                if let Some(parent) = output.parent() {
                    fs::create_dir_all(parent).map_err(|error| app_error(error.to_string()))?;
                }
                let mut target =
                    fs::File::create(&output).map_err(|error| app_error(error.to_string()))?;
                std::io::copy(&mut entry, &mut target)
                    .map_err(|error| app_error(error.to_string()))?;
            }
            Ok(())
        })();
        if let Err(error) = extract_result {
            let _ = remove_path(&output_root);
            return Err(error);
        }
        Ok(public_path(&output_root))
    })
    .await
    .map_err(|error| app_error(error.to_string()))?
}

#[tauri::command]
async fn batch_rename(items: Vec<PathPair>) -> Result<UndoAction, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if items.is_empty() {
            return Err(app_error("No rename changes were provided."));
        }
        let mut source_keys = HashSet::new();
        let mut target_keys = HashSet::new();
        let mut prepared = Vec::new();
        for item in items {
            let source = PathBuf::from(&item.from);
            let target = PathBuf::from(&item.to);
            if !source.exists() {
                return Err(app_error(format!(
                    "The item no longer exists: {}",
                    item.from
                )));
            }
            let name = target
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| app_error("Enter a valid name."))?;
            validate_leaf_name(name)?;
            let source_parent = source
                .parent()
                .ok_or_else(|| app_error("Cannot rename this item."))?;
            let target_parent = target
                .parent()
                .ok_or_else(|| app_error("Cannot rename this item."))?;
            if public_path(source_parent).to_lowercase()
                != public_path(target_parent).to_lowercase()
            {
                return Err(app_error(
                    "Batch rename cannot move items to another folder.",
                ));
            }
            source_keys.insert(public_path(&source).to_lowercase());
            if !target_keys.insert(public_path(&target).to_lowercase()) {
                return Err(app_error("Two items would receive the same name."));
            }
            prepared.push((source, target));
        }
        for (_, target) in &prepared {
            if target.exists() && !source_keys.contains(&public_path(target).to_lowercase()) {
                return Err(app_error(format!(
                    "An item with this name already exists: {}",
                    public_path(target)
                )));
            }
        }

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let staged: Vec<(PathBuf, PathBuf, PathBuf)> = prepared
            .into_iter()
            .enumerate()
            .map(|(index, (source, target))| {
                let parent = source.parent().unwrap_or_else(|| Path::new(""));
                let temporary = parent.join(format!(
                    ".flow-rename-{}-{stamp}-{index}",
                    std::process::id()
                ));
                (source, temporary, target)
            })
            .collect();

        let mut staged_count = 0usize;
        for (source, temporary, _) in &staged {
            if let Err(error) = fs::rename(source, temporary) {
                for (rollback_source, rollback_temporary, _) in staged[..staged_count].iter().rev()
                {
                    let _ = fs::rename(rollback_temporary, rollback_source);
                }
                return Err(app_error(error.to_string()));
            }
            staged_count += 1;
        }
        let mut completed = 0usize;
        for (_, temporary, target) in &staged {
            if let Err(error) = fs::rename(temporary, target) {
                for (source, _, completed_target) in staged[..completed].iter().rev() {
                    let _ = fs::rename(completed_target, source);
                }
                for (source, pending_temporary, _) in staged[completed..].iter() {
                    let _ = fs::rename(pending_temporary, source);
                }
                return Err(app_error(error.to_string()));
            }
            completed += 1;
        }
        Ok(UndoAction::Move {
            pairs: staged
                .into_iter()
                .map(|(source, _, target)| PathPair {
                    from: public_path(&target),
                    to: public_path(&source),
                })
                .collect(),
        })
    })
    .await
    .map_err(|error| app_error(error.to_string()))?
}

#[tauri::command]
fn create_folder(parent_path: String, name: String) -> Result<(), String> {
    validate_leaf_name(&name)?;
    let parent = require_directory(&parent_path)?;
    fs::create_dir(parent.join(name.trim())).map_err(|error| app_error(error.to_string()))
}

#[tauri::command]
fn create_file(parent_path: String, name: String) -> Result<(), String> {
    validate_leaf_name(&name)?;
    let parent = require_directory(&parent_path)?;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(parent.join(name.trim()))
        .map(|_| ())
        .map_err(|error| app_error(error.to_string()))
}

#[tauri::command]
fn rename_path(path: String, new_name: String) -> Result<(), String> {
    validate_leaf_name(&new_name)?;
    let source = PathBuf::from(&path);
    let parent = source
        .parent()
        .ok_or_else(|| app_error("This item cannot be renamed."))?;
    if !source.exists() {
        return Err(app_error("The selected item no longer exists."));
    }
    fs::rename(&source, parent.join(new_name.trim())).map_err(|error| app_error(error.to_string()))
}

#[tauri::command]
fn move_to_recycle_bin(path: String) -> Result<(), String> {
    let item = PathBuf::from(&path);
    if !item.exists() {
        return Err(app_error("The selected item no longer exists."));
    }
    trash::delete(item).map_err(|error| app_error(error.to_string()))
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(app_error("The selected item no longer exists."));
    }
    Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| app_error(format!("Unable to open the item: {error}")))
}

#[tauri::command]
fn open_with(path: String) -> Result<(), String> {
    let item = PathBuf::from(&path);
    if !item.is_file() {
        return Err(app_error("Choose a file to use Open with."));
    }
    #[cfg(windows)]
    {
        let wide_path = item
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let result = unsafe {
            ShellExecuteW(
                None,
                w!("openas"),
                PCWSTR(wide_path.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        if result.0 as isize <= 32 {
            return Err(app_error("Windows could not open the app chooser."));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err(app_error("Open with is only available on Windows."))
    }
}

#[tauri::command]
fn show_properties(path: String) -> Result<(), String> {
    let item = PathBuf::from(&path);
    if !item.exists() {
        return Err(app_error("The selected item no longer exists."));
    }
    #[cfg(windows)]
    {
        let wide_path = item
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let shown = unsafe {
            SHObjectProperties(
                None,
                SHOP_FILEPATH,
                PCWSTR(wide_path.as_ptr()),
                PCWSTR::null(),
            )
        };
        if !shown.as_bool() {
            return Err(app_error("Windows could not open the Properties dialog."));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err(app_error("Properties are only available on Windows."))
    }
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(app_error("The selected item no longer exists."));
    }
    Command::new("explorer.exe")
        .arg(format!("/select,{path}"))
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            app_error(format!(
                "Unable to reveal the item in File Explorer: {error}"
            ))
        })
}

#[tauri::command]
fn show_system_context_menu(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    let item = PathBuf::from(&path);
    if !item.exists() {
        return Err(app_error("The selected item no longer exists."));
    }
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|error| {
            app_error(format!("Unable to access the application window: {error}"))
        })?;
        let wide_path = item
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>();
        let result = unsafe {
            let com = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let should_uninitialize = com.is_ok();
            let mut absolute_pidl = std::ptr::null_mut();
            let operation = (|| -> windows::core::Result<()> {
                SHParseDisplayName(
                    PCWSTR(wide_path.as_ptr()),
                    None::<&windows::Win32::System::Com::IBindCtx>,
                    &mut absolute_pidl,
                    0,
                    None,
                )?;
                let mut child_pidl = std::ptr::null_mut();
                let parent: IShellFolder = SHBindToParent(absolute_pidl, Some(&mut child_pidl))?;
                let context_menu: IContextMenu = parent.GetUIObjectOf(hwnd, &[child_pidl], None)?;
                let menu = CreatePopupMenu()?;
                let menu_result = (|| -> windows::core::Result<()> {
                    context_menu
                        .QueryContextMenu(menu, 0, 1, 0x7fff, CMF_NORMAL)
                        .ok()?;
                    let mut cursor = POINT::default();
                    GetCursorPos(&mut cursor)?;
                    let _ = SetForegroundWindow(hwnd);
                    let selected = TrackPopupMenuEx(
                        menu,
                        (TPM_RETURNCMD | TPM_RIGHTBUTTON).0,
                        cursor.x,
                        cursor.y,
                        hwnd,
                        None,
                    );
                    let command = selected.0 as u32;
                    if command != 0 {
                        let command_info = CMINVOKECOMMANDINFO {
                            cbSize: std::mem::size_of::<CMINVOKECOMMANDINFO>() as u32,
                            hwnd,
                            lpVerb: PCSTR::from_raw((command - 1) as usize as *const u8),
                            nShow: SW_SHOWNORMAL.0,
                            ..Default::default()
                        };
                        context_menu.InvokeCommand(&command_info)?;
                    }
                    Ok(())
                })();
                let _ = DestroyMenu(menu);
                menu_result
            })();
            if !absolute_pidl.is_null() {
                CoTaskMemFree(Some(absolute_pidl.cast()));
            }
            if should_uninitialize {
                CoUninitialize();
            }
            operation
        };
        result
            .map_err(|error| app_error(format!("Windows could not open the system menu: {error}")))
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Err(app_error(
            "The system file menu is only available on Windows.",
        ))
    }
}

#[tauri::command]
fn start_file_drag(
    window: tauri::WebviewWindow,
    paths: Vec<String>,
) -> Result<ExternalDragResult, String> {
    if paths.is_empty() {
        return Err(app_error("No files were selected."));
    }
    if paths.len() > 4096 {
        return Err(app_error(
            "Too many items were selected for one drag operation.",
        ));
    }
    for path in &paths {
        if !Path::new(path).exists() {
            return Err(app_error(format!(
                "The selected item no longer exists: {path}"
            )));
        }
    }
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|error| {
            app_error(format!("Unable to access the application window: {error}"))
        })?;
        unsafe {
            OleInitialize(None).map_err(|error| {
                app_error(format!("Windows OLE drag-and-drop is unavailable: {error}"))
            })?;
        }
        let mut pidls = Vec::with_capacity(paths.len());
        let operation = (|| -> windows::core::Result<DROPEFFECT> {
            for path in &paths {
                let wide_path = Path::new(path)
                    .as_os_str()
                    .encode_wide()
                    .chain(Some(0))
                    .collect::<Vec<_>>();
                let mut pidl = std::ptr::null_mut();
                unsafe {
                    SHParseDisplayName(
                        PCWSTR(wide_path.as_ptr()),
                        None::<&IBindCtx>,
                        &mut pidl,
                        0,
                        None,
                    )?;
                }
                pidls.push(pidl);
            }
            let pidl_refs = pidls
                .iter()
                .map(|pidl| *pidl as *const _)
                .collect::<Vec<_>>();
            let items = unsafe { SHCreateShellItemArrayFromIDLists(&pidl_refs)? };
            let data_object: IDataObject =
                unsafe { items.BindToHandler(None::<&IBindCtx>, &BHID_DataObject)? };
            unsafe {
                SHDoDragDrop(
                    Some(hwnd),
                    &data_object,
                    None::<&IDropSource>,
                    DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK,
                )
            }
        })();
        for pidl in pidls {
            unsafe { CoTaskMemFree(Some(pidl.cast())) };
        }
        unsafe { OleUninitialize() };
        let effect = operation.map_err(|error| {
            app_error(format!("Windows could not start the file drag: {error}"))
        })?;
        let effect_name = if effect.0 & DROPEFFECT_MOVE.0 != 0 {
            "move"
        } else if effect.0 & DROPEFFECT_COPY.0 != 0 {
            "copy"
        } else if effect.0 & DROPEFFECT_LINK.0 != 0 {
            "link"
        } else {
            "none"
        };
        Ok(ExternalDragResult {
            effect: effect_name.into(),
        })
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Err(app_error(
            "External file dragging is only available on Windows.",
        ))
    }
}

fn find_claude_command() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(app_data) = env::var_os("APPDATA") {
        let npm_directory = PathBuf::from(app_data).join("npm");
        candidates.push(npm_directory.join("claude.cmd"));
        candidates.push(npm_directory.join("claude.exe"));
    }
    if let Some(path_value) = env::var_os("PATH") {
        for directory in env::split_paths(&path_value) {
            candidates.push(directory.join("claude.cmd"));
            candidates.push(directory.join("claude.exe"));
            candidates.push(directory.join("claude.bat"));
        }
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeCredentialStatus {
    stored: bool,
    environment_available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeDiagnostic {
    claude_found: bool,
    version: Option<String>,
    provider: String,
    endpoint: String,
    key_available: bool,
    status: String,
    message: String,
    balance_available: Option<bool>,
}

#[cfg(windows)]
fn read_deepseek_api_key() -> Result<Option<String>, String> {
    let mut raw: *mut CREDENTIALW = std::ptr::null_mut();
    let read_result = unsafe {
        CredReadW(
            DEEPSEEK_CREDENTIAL_TARGET,
            CRED_TYPE_GENERIC,
            None,
            &mut raw,
        )
    };
    if let Err(error) = read_result {
        if error.code() == windows::core::HRESULT::from_win32(ERROR_NOT_FOUND.0) {
            return Ok(None);
        }
        return Err(app_error(format!(
            "Unable to read the DeepSeek API key from Windows Credential Manager: {error}"
        )));
    }
    if raw.is_null() {
        return Ok(None);
    }
    let bytes = unsafe {
        let credential = &*raw;
        std::slice::from_raw_parts(
            credential.CredentialBlob,
            credential.CredentialBlobSize as usize,
        )
        .to_vec()
    };
    unsafe { CredFree(raw.cast()) };
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| app_error("The stored DeepSeek API key is not valid UTF-8."))
}

#[cfg(windows)]
fn deepseek_api_key() -> Result<Option<String>, String> {
    if let Some(key) = read_deepseek_api_key()? {
        if !key.trim().is_empty() {
            return Ok(Some(key));
        }
    }
    Ok(env::var("DEEPSEEK_API_KEY")
        .ok()
        .filter(|key| !key.trim().is_empty()))
}

#[tauri::command]
fn get_claude_credential_status() -> Result<ClaudeCredentialStatus, String> {
    #[cfg(windows)]
    {
        Ok(ClaudeCredentialStatus {
            stored: read_deepseek_api_key()?.is_some(),
            environment_available: env::var("DEEPSEEK_API_KEY")
                .map(|key| !key.trim().is_empty())
                .unwrap_or(false),
        })
    }
    #[cfg(not(windows))]
    {
        Ok(ClaudeCredentialStatus {
            stored: false,
            environment_available: false,
        })
    }
}

#[tauri::command]
fn save_claude_api_key(api_key: String) -> Result<ClaudeCredentialStatus, String> {
    #[cfg(windows)]
    {
        let trimmed = api_key.trim();
        if trimmed.is_empty() {
            return Err(app_error("Enter a DeepSeek API key before saving."));
        }
        if trimmed.len() > 2048 {
            return Err(app_error("The DeepSeek API key is unexpectedly long."));
        }

        let mut secret = trimmed.as_bytes().to_vec();
        let mut username: Vec<u16> = "DeepSeek API".encode_utf16().chain(Some(0)).collect();
        let mut credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(DEEPSEEK_CREDENTIAL_TARGET.0 as *mut u16),
            CredentialBlobSize: secret.len() as u32,
            CredentialBlob: secret.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR(username.as_mut_ptr()),
            ..Default::default()
        };
        unsafe { CredWriteW(&mut credential, 0) }.map_err(|error| {
            app_error(format!(
                "Unable to save the DeepSeek API key in Windows Credential Manager: {error}"
            ))
        })?;
        secret.fill(0);
        Ok(ClaudeCredentialStatus {
            stored: true,
            environment_available: env::var("DEEPSEEK_API_KEY")
                .map(|key| !key.trim().is_empty())
                .unwrap_or(false),
        })
    }
    #[cfg(not(windows))]
    {
        let _ = api_key;
        Err(app_error(
            "Secure API key storage is only available on Windows.",
        ))
    }
}

#[tauri::command]
fn delete_claude_api_key() -> Result<ClaudeCredentialStatus, String> {
    #[cfg(windows)]
    {
        if let Err(error) =
            unsafe { CredDeleteW(DEEPSEEK_CREDENTIAL_TARGET, CRED_TYPE_GENERIC, None) }
        {
            if error.code() != windows::core::HRESULT::from_win32(ERROR_NOT_FOUND.0) {
                return Err(app_error(format!(
                    "Unable to delete the DeepSeek API key from Windows Credential Manager: {error}"
                )));
            }
        }
        Ok(ClaudeCredentialStatus {
            stored: false,
            environment_available: env::var("DEEPSEEK_API_KEY")
                .map(|key| !key.trim().is_empty())
                .unwrap_or(false),
        })
    }
    #[cfg(not(windows))]
    {
        Ok(ClaudeCredentialStatus {
            stored: false,
            environment_available: false,
        })
    }
}

fn claude_version(command: &Path) -> Option<String> {
    let output = Command::new(command).arg("--version").output().ok()?;
    let text = if output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr)
    } else {
        String::from_utf8_lossy(&output.stdout)
    };
    let version = text.trim();
    (!version.is_empty()).then(|| version.to_string())
}

fn create_claude_diagnostic(provider: String) -> Result<ClaudeDiagnostic, String> {
    let claude = find_claude_command();
    let version = claude.as_deref().and_then(claude_version);
    if claude.is_none() {
        return Ok(ClaudeDiagnostic {
            claude_found: false,
            version: None,
            provider,
            endpoint: String::new(),
            key_available: false,
            status: "claudeMissing".into(),
            message: "Claude Code was not found in the npm directory or PATH.".into(),
            balance_available: None,
        });
    }

    if provider == "deepseek" {
        #[cfg(windows)]
        let api_key = deepseek_api_key()?;
        #[cfg(not(windows))]
        let api_key: Option<String> = None;
        let Some(api_key) = api_key else {
            return Ok(ClaudeDiagnostic {
                claude_found: true,
                version,
                provider,
                endpoint: "https://api.deepseek.com/anthropic".into(),
                key_available: false,
                status: "missingKey".into(),
                message: "No DeepSeek API key is available.".into(),
                balance_available: None,
            });
        };
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(12))
            .user_agent("Flow-Files/0.1")
            .build()
            .map_err(|error| app_error(format!("Unable to create the connection test: {error}")))?;
        let response = match client
            .get("https://api.deepseek.com/user/balance")
            .bearer_auth(&api_key)
            .send()
        {
            Ok(response) => response,
            Err(error) => {
                return Ok(ClaudeDiagnostic {
                    claude_found: true,
                    version,
                    provider,
                    endpoint: "https://api.deepseek.com/anthropic".into(),
                    key_available: true,
                    status: "networkError".into(),
                    message: error.to_string(),
                    balance_available: None,
                })
            }
        };
        let status_code = response.status();
        if status_code.is_success() {
            let balance_available = response
                .json::<Value>()
                .ok()
                .and_then(|value| value.get("is_available").and_then(Value::as_bool));
            return Ok(ClaudeDiagnostic {
                claude_found: true,
                version,
                provider,
                endpoint: "https://api.deepseek.com/anthropic".into(),
                key_available: true,
                status: "ready".into(),
                message: "DeepSeek accepted the saved API key.".into(),
                balance_available,
            });
        }
        let authentication_error = status_code.as_u16() == 401 || status_code.as_u16() == 403;
        return Ok(ClaudeDiagnostic {
            claude_found: true,
            version,
            provider,
            endpoint: "https://api.deepseek.com/anthropic".into(),
            key_available: true,
            status: if authentication_error {
                "authError"
            } else {
                "serviceError"
            }
            .into(),
            message: format!("DeepSeek returned HTTP {}.", status_code.as_u16()),
            balance_available: None,
        });
    }

    let authenticated = claude
        .as_deref()
        .and_then(|command| {
            Command::new(command)
                .args(["auth", "status", "--json"])
                .output()
                .ok()
        })
        .map(|output| output.status.success())
        .unwrap_or(false);
    Ok(ClaudeDiagnostic {
        claude_found: true,
        version,
        provider: "anthropic".into(),
        endpoint: "https://api.anthropic.com".into(),
        key_available: authenticated,
        status: if authenticated {
            "ready"
        } else {
            "notAuthenticated"
        }
        .into(),
        message: if authenticated {
            "Claude Code reports an active Anthropic login.".into()
        } else {
            "Claude Code is not signed in to Anthropic.".into()
        },
        balance_available: None,
    })
}

#[tauri::command]
async fn diagnose_claude(provider: String) -> Result<ClaudeDiagnostic, String> {
    tauri::async_runtime::spawn_blocking(move || create_claude_diagnostic(provider))
        .await
        .map_err(|error| app_error(format!("Claude diagnostic task failed: {error}")))?
}

#[tauri::command]
fn take_external_open_targets(
    pending: tauri::State<'_, PendingExternalTargets>,
) -> Result<Vec<ExternalOpenTarget>, String> {
    let mut targets = pending
        .0
        .lock()
        .map_err(|_| app_error("Unable to read pending external folder requests."))?;
    Ok(std::mem::take(&mut *targets))
}

#[tauri::command]
fn get_folder_integration_status() -> Result<FolderIntegrationStatus, String> {
    #[cfg(windows)]
    {
        folder_integration_status()
    }
    #[cfg(not(windows))]
    {
        Err(app_error(
            "Windows folder integration is only available on Windows.",
        ))
    }
}

#[tauri::command]
fn set_folder_integration_enabled(enabled: bool) -> Result<FolderIntegrationStatus, String> {
    #[cfg(windows)]
    {
        apply_folder_integration_enabled(enabled)
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err(app_error(
            "Windows folder integration is only available on Windows.",
        ))
    }
}

#[tauri::command]
fn get_folder_context_menu_status() -> Result<FolderIntegrationStatus, String> {
    #[cfg(windows)]
    {
        folder_context_menu_status()
    }
    #[cfg(not(windows))]
    {
        Err(app_error(
            "Windows Explorer context menu is only available on Windows.",
        ))
    }
}

#[tauri::command]
fn set_folder_context_menu_enabled(enabled: bool) -> Result<FolderIntegrationStatus, String> {
    #[cfg(windows)]
    {
        apply_folder_context_menu_enabled(enabled)
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err(app_error(
            "Windows Explorer context menu is only available on Windows.",
        ))
    }
}

#[tauri::command]
fn open_terminal(
    path: String,
    mode: Option<String>,
    provider: Option<String>,
    full_access: Option<bool>,
) -> Result<(), String> {
    // `require_directory` canonicalizes paths and Windows returns the extended
    // `\\?\` form. That form is valid for Win32 file APIs but CMD treats
    // `\\?\D:\...` as a UNC path and refuses to make it the current directory.
    // External shells must receive the normal drive/UNC representation.
    let directory_text = external_directory(&path)?;
    let mut command = Command::new("wt.exe");
    command.args(["-d", &directory_text]);
    if mode.as_deref() == Some("claude") {
        let full_access = full_access.unwrap_or(false);
        if full_access {
            trust_claude_workspace(&directory_text)?;
        }
        let claude = find_claude_command().ok_or_else(|| {
            app_error("Claude Code was not found. Install it first or add claude.cmd to PATH.")
        })?;
        // Windows Terminal can reuse an existing server process, in which case `wt -d`
        // alone is not always inherited by the shell it creates. Force the shell into
        // the requested workspace before Claude starts. Environment variables keep
        // paths with spaces and shell metacharacters out of the command text.
        let launch_command = if full_access {
            "pushd \"%FLOW_FILES_WORKSPACE%\" && call \"%FLOW_FILES_CLAUDE%\" --dangerously-skip-permissions"
        } else {
            "pushd \"%FLOW_FILES_WORKSPACE%\" && call \"%FLOW_FILES_CLAUDE%\""
        };
        command
            .env("FLOW_FILES_WORKSPACE", &directory_text)
            .env("FLOW_FILES_CLAUDE", &claude)
            .args(["cmd.exe", "/d", "/k", launch_command]);
        if provider.as_deref() == Some("deepseek") {
            #[cfg(windows)]
            let api_key = deepseek_api_key()?.ok_or_else(|| {
                app_error(
                    "DeepSeek is selected, but no API key has been saved in Flow Files settings.",
                )
            })?;
            #[cfg(not(windows))]
            let api_key = String::new();
            command
                .env("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic")
                .env("ANTHROPIC_AUTH_TOKEN", api_key)
                .env("ANTHROPIC_MODEL", "deepseek-flash[1m]")
                .env("ANTHROPIC_DEFAULT_OPUS_MODEL", "deepseek-flash[1m]")
                .env("ANTHROPIC_DEFAULT_SONNET_MODEL", "deepseek-flash[1m]")
                .env("ANTHROPIC_DEFAULT_HAIKU_MODEL", "deepseek-flash")
                .env("CLAUDE_CODE_SUBAGENT_MODEL", "deepseek-flash")
                .env("CLAUDE_CODE_EFFORT_LEVEL", "max")
                .env("CLAUDE_CODE_AUTO_COMPACT_WINDOW", "786432");
        }
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| app_error(format!("Unable to start Windows Terminal: {error}")))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_args = env::args().skip(1).collect::<Vec<_>>();
    let initial_cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("C:\\"));
    let initial_targets = external_open_targets(&initial_args, &initial_cwd);
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue_external_open_targets(app, &args, &cwd);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }
    builder
        .manage(OperationJobs::default())
        .manage(DirectoryWatch::default())
        .manage(SearchJobs::default())
        .manage(DirectoryLoadJobs::default())
        .manage(ThumbnailJobs::default())
        .manage(FolderSizeJobs::default())
        .manage(SpaceScanJobs::default())
        .manage(DuplicateScanJobs::default())
        .manage(PendingExternalTargets(Mutex::new(initial_targets)))
        .invoke_handler(tauri::generate_handler![
            get_locations,
            suggest_paths,
            list_directory,
            list_directory_progressive,
            cancel_directory_load,
            calculate_folder_size,
            cancel_folder_size,
            scan_disk_space,
            cancel_space_scan,
            scan_duplicate_files,
            cancel_duplicate_scan,
            recycle_verified_duplicates,
            preview_space_cleanup,
            recycle_space_cleanup_paths,
            check_directory_status,
            get_everything_status,
            search_directory,
            cancel_search,
            set_file_clipboard,
            set_text_clipboard,
            get_file_clipboard,
            watch_directory,
            find_conflicts,
            run_file_operation,
            cancel_file_operation,
            set_file_operation_paused,
            set_file_operation_rate_limit,
            recycle_paths,
            permanently_delete_paths,
            undo_operation,
            load_thumbnails,
            cancel_thumbnail_job,
            load_file_icons,
            load_file_preview,
            load_file_details,
            create_zip_archive,
            extract_zip_archive,
            batch_rename,
            create_folder,
            create_file,
            rename_path,
            move_to_recycle_bin,
            open_path,
            open_with,
            show_properties,
            reveal_in_explorer,
            show_system_context_menu,
            start_file_drag,
            get_claude_credential_status,
            save_claude_api_key,
            delete_claude_api_key,
            diagnose_claude,
            take_external_open_targets,
            get_folder_integration_status,
            set_folder_integration_enabled,
            get_folder_context_menu_status,
            set_folder_context_menu_enabled,
            open_terminal
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

#[cfg(test)]
mod tests;
