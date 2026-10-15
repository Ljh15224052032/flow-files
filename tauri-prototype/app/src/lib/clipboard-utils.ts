export function formatPathsForClipboard(paths: string[], quoted: boolean) {
  return paths.map((path) => quoted ? `"${path}"` : path).join("\r\n");
}
