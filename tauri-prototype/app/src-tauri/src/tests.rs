use super::*;

fn fresh_test_directory(label: &str) -> PathBuf {
    let directory = env::temp_dir().join(format!(
        "flow-files-{label}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    fs::create_dir_all(&directory).expect("create isolated test directory");
    directory
}

#[test]
fn production_webview_has_a_restrictive_security_baseline() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .expect("parse bundled Tauri configuration");
    let security = &config["app"]["security"];
    assert_eq!(security["freezePrototype"], Value::Bool(true));
    assert!(security["csp"].is_object(), "CSP must never be disabled");
    assert_eq!(security["csp"]["object-src"], "'none'");
    assert_eq!(
        security["csp"]["frame-src"],
        "'self' asset: http://asset.localhost"
    );
    assert_eq!(security["headers"]["X-Content-Type-Options"], "nosniff");
    let denied = security["assetProtocol"]["scope"]["deny"]
        .as_array()
        .expect("asset protocol deny list");
    assert!(denied.iter().any(|entry| entry == "$HOME/.ssh/**/*"));
    assert!(denied.iter().any(|entry| entry == "$HOME/.claude/**/*"));
}

#[test]
fn release_bundle_keeps_a_stable_windows_identity() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .expect("parse bundled Tauri configuration");
    assert_eq!(config["productName"], "Flow Files");
    assert_eq!(config["identifier"], "com.coderebuild.filemanagerlab");
    assert_eq!(config["bundle"]["targets"][0], "nsis");
    assert_eq!(
        config["bundle"]["windows"]["nsis"]["installMode"],
        "currentUser"
    );
    assert_eq!(config["bundle"]["createUpdaterArtifacts"], true);
    assert_eq!(
        config["plugins"]["updater"]["endpoints"][0],
        "https://github.com/Ljh15224052032/flow-files/releases/latest/download/latest.json"
    );
    assert!(
        config["plugins"]["updater"]["pubkey"]
            .as_str()
            .is_some_and(|key| key.len() > 80),
        "the updater public key must remain configured"
    );
    assert_eq!(
        config["plugins"]["updater"]["windows"]["installMode"],
        "passive"
    );
}

#[test]
fn rejects_unsafe_windows_leaf_names() {
    for name in [
        "",
        ".",
        "..",
        "trailing. ",
        "bad/name",
        "bad:name",
        "NUL",
        "com1.txt",
    ] {
        assert!(
            validate_leaf_name(name).is_err(),
            "{name:?} must be rejected"
        );
    }
    for name in ["正常文件.txt", "archive.zip", "COM10.txt", "notes (2).md"] {
        assert!(
            validate_leaf_name(name).is_ok(),
            "{name:?} must be accepted"
        );
    }
    assert!(validate_leaf_name(&"a".repeat(255)).is_ok());
    assert!(validate_leaf_name(&"a".repeat(256)).is_err());
    assert!(validate_leaf_name(&"😀".repeat(128)).is_err());
}

#[test]
fn rejects_zip_path_traversal_and_cleans_partial_output() {
    let sandbox = fresh_test_directory("unsafe-zip-test");
    let archive_path = sandbox.join("unsafe.zip");
    let file = fs::File::create(&archive_path).expect("create unsafe archive");
    let mut archive = zip::ZipWriter::new(file);
    archive
        .start_file("../escaped.txt", zip::write::SimpleFileOptions::default())
        .expect("add unsafe archive entry");
    archive
        .write_all(b"must not escape")
        .expect("write unsafe entry");
    archive.finish().expect("finish unsafe archive");

    let result = tauri::async_runtime::block_on(extract_zip_archive(
        archive_path.display().to_string(),
        sandbox.display().to_string(),
    ));
    assert!(result.is_err(), "unsafe archive must be rejected");
    assert!(!sandbox.join("escaped.txt").exists());
    assert!(
        !sandbox.join("unsafe").exists(),
        "partial extraction must be removed"
    );
    fs::remove_dir_all(&sandbox).expect("remove unsafe ZIP test folder");
}

#[test]
fn detects_recursive_copy_destinations_and_generates_non_conflicting_names() {
    let sandbox = fresh_test_directory("path-safety-test");
    let source = sandbox.join("source");
    fs::create_dir_all(source.join("nested")).expect("create source tree");
    assert!(is_inside(&source, &source));
    assert!(is_inside(&source, &source.join("nested")));
    assert!(!is_inside(&source, &sandbox));

    let existing = sandbox.join("report.txt");
    fs::write(&existing, "first").expect("create existing file");
    let second = keep_both_path(&existing);
    assert_eq!(
        second.file_name().and_then(|name| name.to_str()),
        Some("report (2).txt")
    );
    fs::write(&second, "second").expect("create second file");
    let third = keep_both_path(&existing);
    assert_eq!(
        third.file_name().and_then(|name| name.to_str()),
        Some("report (3).txt")
    );
    fs::remove_dir_all(&sandbox).expect("remove path safety test folder");
}

#[test]
fn lists_creates_and_renames_inside_a_temporary_folder() {
    let sandbox = env::temp_dir().join(format!("flow-file-manager-test-{}", std::process::id()));
    fs::create_dir_all(&sandbox).expect("create isolated test folder");
    fs::write(sandbox.join("note.txt"), "test").expect("create test file");

    let initial = list_directory(sandbox.display().to_string()).expect("list folder");
    assert_eq!(initial.file_count, 1);
    create_folder(sandbox.display().to_string(), "New folder".to_string()).expect("create folder");
    create_file(sandbox.display().to_string(), "new note.txt".to_string()).expect("create file");
    rename_path(
        sandbox.join("note.txt").display().to_string(),
        "renamed.txt".to_string(),
    )
    .expect("rename file");

    let final_listing = list_directory(sandbox.display().to_string()).expect("list updated folder");
    assert_eq!(final_listing.folder_count, 1);
    assert_eq!(final_listing.file_count, 2);
    assert!(final_listing
        .entries
        .iter()
        .any(|entry| entry.name == "renamed.txt"));
    let suggestions = collect_path_suggestions(
        sandbox.join("New").display().to_string(),
        vec![sandbox.display().to_string()],
    );
    assert!(suggestions
        .iter()
        .any(|suggestion| suggestion.label == "New folder"));
    let image_path = sandbox.join("thumbnail-source.png");
    image::RgbImage::from_pixel(320, 120, image::Rgb([96, 165, 250]))
        .save(&image_path)
        .expect("create test image");
    let thumbnail = create_thumbnail(&image_path).expect("create image thumbnail");
    assert!(thumbnail.data_url.starts_with("data:image/jpeg;base64,"));
    let image_preview = create_file_preview(&image_path, None, 0).expect("create image preview");
    assert_eq!(image_preview.kind, "image");
    assert!(image_preview
        .data_url
        .expect("image data")
        .starts_with("data:image/jpeg;base64,"));
    let image_details = create_file_details(&image_path).expect("read image details");
    assert!(image_details
        .items
        .iter()
        .any(|detail| detail.key == "dimensions" && detail.value == "320 × 120"));
    let text_preview =
        create_file_preview(&sandbox.join("renamed.txt"), None, 0).expect("create text preview");
    assert_eq!(text_preview.kind, "text");
    assert_eq!(text_preview.text.as_deref(), Some("test"));
    let legacy_text = sandbox.join("legacy.txt");
    fs::write(&legacy_text, [0xd6, 0xd0, 0xce, 0xc4]).expect("create GBK text sample");
    let legacy_preview =
        create_file_preview(&legacy_text, Some("gbk"), 0).expect("decode GBK preview");
    assert_eq!(legacy_preview.text.as_deref(), Some("中文"));
    assert_eq!(legacy_preview.encoding.as_deref(), Some("gbk"));
    let large_text = sandbox.join("large.txt");
    fs::write(
        &large_text,
        vec![b'a'; MAX_TEXT_PREVIEW_BYTES as usize + 64],
    )
    .expect("create large text sample");
    let first_text_page =
        create_file_preview(&large_text, Some("utf-8"), 0).expect("read first text page");
    let second_text_page = create_file_preview(&large_text, Some("utf-8"), MAX_TEXT_PREVIEW_BYTES)
        .expect("read second text page");
    assert!(first_text_page.truncated);
    assert_eq!(second_text_page.text_offset, MAX_TEXT_PREVIEW_BYTES);
    assert_eq!(
        second_text_page.text.as_deref(),
        Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
    );
    #[cfg(windows)]
    {
        let native_icon = create_windows_file_icon(&sandbox.join("renamed.txt"))
            .expect("create Windows file icon");
        assert!(native_icon.data_url.starts_with("data:image/png;base64,"));
    }
    assert_eq!(public_path(Path::new(r"\\?\C:\Users\z")), r"C:\Users\z");
    assert_eq!(
        public_path(Path::new(r"\\?\UNC\server\share")),
        r"\\server\share"
    );
    #[cfg(windows)]
    {
        let terminal_path = external_directory(&sandbox.display().to_string())
            .expect("prepare a CMD-compatible workspace path");
        assert!(!terminal_path.starts_with(r"\\?\"));
        assert!(Path::new(&terminal_path).is_dir());
    }
    let external_targets = external_open_targets(
        &[
            sandbox.display().to_string(),
            sandbox.join("renamed.txt").display().to_string(),
        ],
        &sandbox,
    );
    let canonical_sandbox = public_path(
        &sandbox
            .canonicalize()
            .expect("canonicalize external target sandbox"),
    );
    assert_eq!(external_targets.len(), 2);
    assert!(external_targets.iter().any(|target| {
        target.directory.eq_ignore_ascii_case(&canonical_sandbox) && target.selected_path.is_none()
    }));
    let renamed_public_path = public_path(
        &sandbox
            .join("renamed.txt")
            .canonicalize()
            .expect("canonicalize selected external target"),
    );
    assert!(external_targets.iter().any(|target| {
        target.directory.eq_ignore_ascii_case(&canonical_sandbox)
            && target.selected_path.as_deref() == Some(renamed_public_path.as_str())
    }));
    let mut claude_config = json!({
        "projects": { "C:/existing": { "hasTrustDialogAccepted": false, "keep": 1 } },
        "keepRoot": true
    });
    mark_claude_project_trusted(
        &mut claude_config,
        &claude_project_key(r"D:\Download\feishudownloads\"),
    )
    .expect("mark Flow workspace trusted");
    assert_eq!(
        claude_config["projects"]["D:/Download/feishudownloads"]["hasTrustDialogAccepted"],
        Value::Bool(true)
    );
    assert_eq!(claude_config["projects"]["C:/existing"]["keep"], 1);
    assert_eq!(claude_config["keepRoot"], Value::Bool(true));
    fs::remove_dir_all(&sandbox).expect("remove isolated test folder");
}

#[test]
fn classifies_search_result_types() {
    let sandbox = env::temp_dir().join(format!(
        "flow-file-manager-search-test-{}",
        std::process::id()
    ));
    fs::create_dir_all(&sandbox).expect("create isolated search folder");
    let document_path = sandbox.join("notes.pdf");
    fs::write(&document_path, "test").expect("create search document");
    let metadata = fs::metadata(&document_path).expect("read search document metadata");
    let entry = entry_from_metadata(&document_path, "notes.pdf".into(), &metadata);
    assert!(matches_search_kind(&entry, "documents"));
    assert!(!matches_search_kind(&entry, "images"));
    assert!(matches_search_kind(&entry, "all"));
    fs::remove_dir_all(&sandbox).expect("remove isolated search folder");
}

#[test]
fn duplicate_fingerprints_verify_full_content() {
    let sandbox = env::temp_dir().join(format!("flow-duplicate-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&sandbox);
    fs::create_dir_all(&sandbox).expect("create duplicate test folder");
    let first = sandbox.join("first.bin");
    let second = sandbox.join("second.bin");
    let different = sandbox.join("different.bin");
    let payload = vec![0x5au8; DUPLICATE_QUICK_SAMPLE_BYTES * 3];
    fs::write(&first, &payload).expect("write first duplicate");
    fs::write(&second, &payload).expect("write second duplicate");
    let mut changed = payload.clone();
    changed[DUPLICATE_QUICK_SAMPLE_BYTES + 7] = 0x33;
    fs::write(&different, changed).expect("write different file");
    let first_quick =
        quick_duplicate_fingerprint(&first, payload.len() as u64).expect("quick hash first");
    let different_quick = quick_duplicate_fingerprint(&different, payload.len() as u64)
        .expect("quick hash different");
    assert_eq!(
        first_quick, different_quick,
        "middle-only changes intentionally survive the quick filter"
    );
    assert_eq!(
        full_duplicate_fingerprint(&first).expect("full hash first"),
        full_duplicate_fingerprint(&second).expect("full hash second")
    );
    assert_ne!(
        full_duplicate_fingerprint(&first).expect("full hash first again"),
        full_duplicate_fingerprint(&different).expect("full hash different")
    );
    fs::remove_dir_all(&sandbox).expect("remove duplicate test folder");
}

#[cfg(windows)]
#[test]
#[ignore = "requires a running local Everything installation"]
fn queries_the_local_everything_index() {
    let root = env::current_dir().expect("current project directory");
    let search = format!(
        "\"{}\\\" \"Cargo.toml\"",
        public_path(&root).trim_end_matches('\\')
    );
    let reply = run_everything_ipc_query(&search).expect("query Everything IPC");
    assert!(
        read_packed_u32(&reply, 8).unwrap_or(0) > 0,
        "Everything should find this project's Cargo.toml"
    );
}

#[test]
fn keeps_space_cleanup_categories_inside_safe_boundaries() {
    assert_eq!(
        space_category(Path::new(r"C:\Users\z\AppData\Local\Temp\preview.tmp")),
        Some(("temporaryFiles", "safe"))
    );
    assert_eq!(
        space_category(Path::new(
            r"C:\Windows\SoftwareDistribution\Download\update.cab"
        )),
        Some(("windowsUpdateCache", "protected"))
    );
    assert_eq!(space_cleanup_category("browserCache"), Some("safe"));
    assert_eq!(space_cleanup_category("downloads"), Some("review"));
    assert_eq!(space_cleanup_category("recycleBin"), None);
    assert_eq!(space_cleanup_category("systemManaged"), None);
    assert_eq!(space_cleanup_category("windowsUpdateCache"), None);
}

#[test]
fn reports_detailed_file_conflicts() {
    let sandbox = env::temp_dir().join(format!(
        "flow-file-manager-conflict-test-{}",
        std::process::id()
    ));
    let source = sandbox.join("source");
    let destination = sandbox.join("destination");
    fs::create_dir_all(&source).expect("create conflict source");
    fs::create_dir_all(&destination).expect("create conflict destination");
    fs::write(source.join("same.txt"), "incoming").expect("create incoming file");
    fs::write(destination.join("same.txt"), "existing target").expect("create target file");
    let conflicts = find_conflicts(
        vec![source.join("same.txt").display().to_string()],
        destination.display().to_string(),
    )
    .expect("find detailed conflict");
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0].source.name, "same.txt");
    assert_eq!(conflicts[0].source.size, 8);
    assert_eq!(conflicts[0].target.size, 15);
    fs::remove_dir_all(&sandbox).expect("remove isolated conflict folder");
}

#[test]
fn copies_folders_without_progress_and_classifies_windows_errors() {
    let sandbox = env::temp_dir().join(format!(
        "flow-file-manager-copy-test-{}",
        std::process::id()
    ));
    let source = sandbox.join("source");
    let target = sandbox.join("target");
    fs::create_dir_all(source.join("nested")).expect("create copy source");
    fs::write(source.join("nested").join("note.txt"), "copied").expect("create copy source file");
    copy_path_plain(&source, &target).expect("copy directory tree");
    assert_eq!(
        fs::read_to_string(target.join("nested").join("note.txt")).expect("read copied file"),
        "copied"
    );
    assert_eq!(
        operation_issue(&source, "The process cannot access the file (os error 32)").code,
        "inUse"
    );
    assert_eq!(
        operation_issue(&source, "Access is denied (os error 5)").code,
        "accessDenied"
    );
    assert_eq!(
        operation_issue(&source, "The device is not ready (os error 21)").code,
        "network"
    );
    assert_eq!(
        operation_issue(
            &source,
            "There is not enough space on the disk (os error 112)"
        )
        .code,
        "diskFull"
    );
    assert_eq!(
        operation_issue(
            &source,
            "The filename or extension is too long (os error 206)"
        )
        .code,
        "pathTooLong"
    );
    assert_eq!(
        operation_issue(
            &source,
            "The system cannot find the path specified (os error 3)"
        )
        .code,
        "notFound"
    );
    assert_eq!(
        directory_unavailable_reason(&std::io::Error::from_raw_os_error(5), "folder"),
        "accessDenied"
    );
    assert_eq!(
        directory_unavailable_reason(&std::io::Error::from_raw_os_error(3), "drive"),
        "notFound"
    );
    assert_eq!(
        directory_unavailable_reason(&std::io::Error::from_raw_os_error(53), "network"),
        "unreachable"
    );
    assert_eq!(volume_key(Path::new(r"C:\Users\z")), "c:");
    assert_eq!(
        volume_key(Path::new(r"\\server\share\folder")),
        r"\\server\share"
    );
    fs::remove_dir_all(&sandbox).expect("remove isolated copy folder");
}

#[test]
fn creates_extracts_zip_and_batch_renames_transactionally() {
    let sandbox = env::temp_dir().join(format!(
        "flow-file-manager-archive-test-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&sandbox);
    let source = sandbox.join("source");
    fs::create_dir_all(&source).expect("create archive source");
    fs::write(source.join("note.txt"), "archive test").expect("create archive file");
    let archive_path = tauri::async_runtime::block_on(create_zip_archive(
        vec![source.display().to_string()],
        sandbox.display().to_string(),
        "bundle.zip".into(),
    ))
    .expect("create ZIP archive");
    assert!(Path::new(&archive_path).is_file());
    let extracted = tauri::async_runtime::block_on(extract_zip_archive(
        archive_path,
        sandbox.display().to_string(),
    ))
    .expect("extract ZIP archive");
    assert_eq!(
        fs::read_to_string(Path::new(&extracted).join("source").join("note.txt"))
            .expect("read extracted file"),
        "archive test"
    );

    let first = sandbox.join("first.txt");
    let second = sandbox.join("second.txt");
    fs::write(&first, "1").expect("create first rename file");
    fs::write(&second, "2").expect("create second rename file");
    let renamed_first = sandbox.join("01 first.txt");
    let renamed_second = sandbox.join("02 second.txt");
    let undo = tauri::async_runtime::block_on(batch_rename(vec![
        PathPair {
            from: first.display().to_string(),
            to: renamed_first.display().to_string(),
        },
        PathPair {
            from: second.display().to_string(),
            to: renamed_second.display().to_string(),
        },
    ]))
    .expect("batch rename files");
    assert!(renamed_first.is_file());
    assert!(renamed_second.is_file());
    tauri::async_runtime::block_on(undo_operation(undo)).expect("undo batch rename");
    assert!(first.is_file());
    assert!(second.is_file());
    fs::remove_dir_all(&sandbox).expect("remove archive test folder");
}
