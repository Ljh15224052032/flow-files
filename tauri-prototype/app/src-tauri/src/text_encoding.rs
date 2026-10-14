use encoding_rs::{BIG5, GBK, UTF_8, WINDOWS_1252};

fn decode_utf16(bytes: &[u8], little_endian: bool) -> String {
    let units = bytes
        .chunks_exact(2)
        .map(|pair| {
            if little_endian {
                u16::from_le_bytes([pair[0], pair[1]])
            } else {
                u16::from_be_bytes([pair[0], pair[1]])
            }
        })
        .collect::<Vec<_>>();
    String::from_utf16_lossy(&units)
}

pub(crate) fn decode_text_preview(bytes: &[u8], requested: Option<&str>) -> (String, String) {
    let requested = requested.map(|value| value.trim().to_ascii_lowercase());
    let detected = requested.as_deref().unwrap_or_else(|| {
        if bytes.starts_with(&[0xff, 0xfe]) {
            "utf-16le"
        } else if bytes.starts_with(&[0xfe, 0xff]) {
            "utf-16be"
        } else if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
            "utf-8"
        } else {
            let pairs = bytes.chunks_exact(2).take(4096).collect::<Vec<_>>();
            let little_zeroes = pairs.iter().filter(|pair| pair[1] == 0).count();
            let big_zeroes = pairs.iter().filter(|pair| pair[0] == 0).count();
            if !pairs.is_empty() && little_zeroes > pairs.len() / 3 {
                "utf-16le"
            } else if !pairs.is_empty() && big_zeroes > pairs.len() / 3 {
                "utf-16be"
            } else if std::str::from_utf8(bytes).is_ok() {
                "utf-8"
            } else {
                let (_, had_errors) = GBK.decode_without_bom_handling(bytes);
                if had_errors {
                    "windows-1252"
                } else {
                    "gbk"
                }
            }
        }
    });

    let (content, label) = match detected {
        "utf-16le" | "utf16le" => {
            let source = bytes.strip_prefix(&[0xff, 0xfe]).unwrap_or(bytes);
            (decode_utf16(source, true), "utf-16le")
        }
        "utf-16be" | "utf16be" => {
            let source = bytes.strip_prefix(&[0xfe, 0xff]).unwrap_or(bytes);
            (decode_utf16(source, false), "utf-16be")
        }
        "gbk" | "gb18030" | "gb2312" => {
            let (decoded, _) = GBK.decode_without_bom_handling(bytes);
            (decoded.into_owned(), "gbk")
        }
        "big5" => {
            let (decoded, _) = BIG5.decode_without_bom_handling(bytes);
            (decoded.into_owned(), "big5")
        }
        "windows-1252" | "ansi" => {
            let (decoded, _) = WINDOWS_1252.decode_without_bom_handling(bytes);
            (decoded.into_owned(), "windows-1252")
        }
        _ => {
            let source = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
            let (decoded, _) = UTF_8.decode_without_bom_handling(source);
            (decoded.into_owned(), "utf-8")
        }
    };
    (content, label.into())
}

#[cfg(test)]
mod tests {
    use super::decode_text_preview;

    #[test]
    fn detects_unicode_boms_and_utf16_without_a_bom() {
        assert_eq!(
            decode_text_preview(b"\xef\xbb\xbfhello", None),
            ("hello".into(), "utf-8".into())
        );
        assert_eq!(
            decode_text_preview(&[0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65], None),
            ("中文".into(), "utf-16le".into())
        );
        assert_eq!(
            decode_text_preview(&[0x00, 0x41, 0x00, 0x42], None),
            ("AB".into(), "utf-16be".into())
        );
    }

    #[test]
    fn honors_legacy_chinese_and_windows_encoding_requests() {
        assert_eq!(
            decode_text_preview(&[0xd6, 0xd0, 0xce, 0xc4], Some("gbk")),
            ("中文".into(), "gbk".into())
        );
        assert_eq!(
            decode_text_preview(&[0x80], Some("ansi")),
            ("€".into(), "windows-1252".into())
        );
    }
}
