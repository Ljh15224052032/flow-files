use std::path::{Path, PathBuf};

pub(crate) fn validate_leaf_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("Enter a valid name.".to_string());
    }
    if trimmed != name || trimmed.ends_with('.') {
        return Err("Windows names cannot end with a space or period.".to_string());
    }
    if trimmed.chars().any(|character| {
        matches!(
            character,
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
        ) || character < ' '
    }) {
        return Err("Windows names cannot contain \\ / : * ? \" < > |.".to_string());
    }

    let stem = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if reserved {
        return Err("This name is reserved by Windows.".to_string());
    }
    if trimmed.encode_utf16().count() > 255 {
        return Err("The name is too long.".to_string());
    }
    Ok(())
}

pub(crate) fn keep_both_path(target: &Path) -> PathBuf {
    if !target.exists() {
        return target.to_path_buf();
    }
    let parent = target.parent().unwrap_or_else(|| Path::new(""));
    let stem = target
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("item");
    let extension = target.extension().and_then(|value| value.to_str());
    for index in 2..10_000 {
        let name = match extension {
            Some(extension) if target.is_file() => format!("{stem} ({index}).{extension}"),
            _ => format!("{stem} ({index})"),
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{stem}-copy"))
}

pub(crate) fn is_inside(source: &Path, destination: &Path) -> bool {
    let source = source
        .canonicalize()
        .unwrap_or_else(|_| source.to_path_buf());
    let destination = destination
        .canonicalize()
        .unwrap_or_else(|_| destination.to_path_buf());
    destination.starts_with(source)
}
