pub(crate) fn classify_operation_issue(message: &str) -> &'static str {
    let normalized = message.to_lowercase();
    if normalized.contains("os error 5")
        || normalized.contains("access is denied")
        || normalized.contains("permission denied")
    {
        "accessDenied"
    } else if normalized.contains("os error 32")
        || normalized.contains("os error 33")
        || normalized.contains("being used by another process")
    {
        "inUse"
    } else if normalized.contains("os error 112")
        || normalized.contains("not enough space")
        || normalized.contains("disk full")
    {
        "diskFull"
    } else if normalized.contains("os error 206")
        || normalized.contains("filename or extension is too long")
    {
        "pathTooLong"
    } else if normalized.contains("os error 21")
        || normalized.contains("os error 53")
        || normalized.contains("os error 55")
        || normalized.contains("os error 64")
        || normalized.contains("os error 1117")
        || normalized.contains("os error 1167")
        || normalized.contains("device is not ready")
        || normalized.contains("device is not connected")
        || normalized.contains("network")
    {
        "network"
    } else if normalized.contains("os error 2")
        || normalized.contains("os error 3")
        || normalized.contains("not found")
    {
        "notFound"
    } else {
        "other"
    }
}

pub(crate) fn directory_unavailable_reason(error: &std::io::Error, kind: &str) -> &'static str {
    match error.raw_os_error() {
        Some(5) => "accessDenied",
        Some(2 | 3) => "notFound",
        Some(21 | 53 | 55 | 64 | 67 | 121 | 1231) => "unreachable",
        _ if kind == "network" => "unreachable",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_common_file_operation_failures() {
        assert_eq!(
            classify_operation_issue("Access is denied (os error 5)"),
            "accessDenied"
        );
        assert_eq!(
            classify_operation_issue("The file is being used by another process"),
            "inUse"
        );
        assert_eq!(
            classify_operation_issue("There is not enough space on the disk"),
            "diskFull"
        );
        assert_eq!(
            classify_operation_issue("Filename or extension is too long"),
            "pathTooLong"
        );
        assert_eq!(
            classify_operation_issue("The device is not connected (os error 1167)"),
            "network"
        );
        assert_eq!(
            classify_operation_issue("Path not found (os error 3)"),
            "notFound"
        );
        assert_eq!(
            classify_operation_issue("Unexpected filesystem failure"),
            "other"
        );
    }

    #[test]
    fn classifies_directory_availability_from_windows_codes_and_location_kind() {
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
        assert_eq!(
            directory_unavailable_reason(&std::io::Error::other("offline"), "network"),
            "unreachable"
        );
        assert_eq!(
            directory_unavailable_reason(&std::io::Error::other("unknown"), "folder"),
            "unknown"
        );
    }
}
