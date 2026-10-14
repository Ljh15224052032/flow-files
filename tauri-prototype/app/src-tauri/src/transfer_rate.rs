use std::time::Duration;

pub(crate) fn target_elapsed(bytes: u64, bytes_per_second: u64) -> Duration {
    if bytes_per_second == 0 {
        Duration::ZERO
    } else {
        Duration::from_secs_f64(bytes as f64 / bytes_per_second as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::target_elapsed;
    use std::time::Duration;

    #[test]
    fn calculates_transfer_windows_without_limiting_zero() {
        assert_eq!(target_elapsed(10 * 1024 * 1024, 0), Duration::ZERO);
        assert_eq!(
            target_elapsed(10 * 1024 * 1024, 10 * 1024 * 1024),
            Duration::from_secs(1)
        );
        assert_eq!(
            target_elapsed(5 * 1024 * 1024, 10 * 1024 * 1024),
            Duration::from_millis(500)
        );
    }
}
