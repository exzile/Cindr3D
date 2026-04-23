export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function highlightGCode(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const commentIdx = line.indexOf(';');
      let code = line;
      let comment = '';
      if (commentIdx >= 0) {
        code = line.substring(0, commentIdx);
        comment = line.substring(commentIdx);
      }

      let highlighted = code
        .replace(/\b(G\d+(\.\d+)?)\b/gi, '<span style="color:#4dd0e1">$1</span>')
        .replace(/\b(M\d+(\.\d+)?)\b/gi, '<span style="color:#ffd54f">$1</span>')
        .replace(/\b([SFXYZEPRT])(-?\d+(\.\d+)?)\b/gi, '<span style="color:#ffab40">$1$2</span>')
        .replace(/(?<!<[^>]*)(?<![a-zA-Z"])(-?\d+\.?\d*)/g, '<span style="color:#81d4fa">$1</span>');

      if (comment) {
        highlighted += `<span style="color:#66bb6a">${escapeHtml(comment)}</span>`;
      }

      return highlighted;
    })
    .join('\n');
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
