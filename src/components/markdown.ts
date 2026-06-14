/**
 * Minimal offline Markdown → HTML renderer.
 *
 * Intentionally tiny — covers what the editor needs for live preview:
 *   - headings (#..######)
 *   - paragraphs
 *   - bold **x**, italic *x*, inline code `x`
 *   - links [t](u), images ![a](u)
 *   - unordered (-, *) and ordered (1.) lists
 *   - blockquotes (>)
 *   - fenced code (```)
 *   - horizontal rules (---)
 *
 * Output is XSS-safe: we escape HTML first, then apply our own formatting.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(s: string): string {
  let out = escapeHtml(s);
  // images: ![alt](url)
  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]+)&quot;)?\)/g,
    (_m, alt: string, url: string) =>
      `<img src="${url}" alt="${alt}" loading="lazy" />`
  );
  // links: [text](url)
  out = out.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, text: string, url: string) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`
  );
  // inline code
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  // bold
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italic (avoid clashing with bold)
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return out;
}

export function renderMarkdown(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]) => {
    if (buf.length === 0) return;
    const text = buf.join(" ").trim();
    if (text) out.push(`<p>${inline(text)}</p>`);
    buf.length = 0;
  };

  let paraBuf: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code
    if (line.startsWith("```")) {
      flushParagraph(paraBuf);
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(
        `<pre data-lang="${lang}"><code>${escapeHtml(code.join("\n"))}</code></pre>`
      );
      continue;
    }

    // Headings
    const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) {
      flushParagraph(paraBuf);
      const level = hMatch[1].length;
      out.push(`<h${level}>${inline(hMatch[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^-{3,}\s*$/.test(line) || /^\*{3,}\s*$/.test(line)) {
      flushParagraph(paraBuf);
      out.push(`<hr />`);
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      flushParagraph(paraBuf);
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quote.push(lines[i].slice(2));
        i++;
      }
      out.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(line)) {
      flushParagraph(paraBuf);
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push(`<ul>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      flushParagraph(paraBuf);
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      out.push(`<ol>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</ol>`);
      continue;
    }

    // Empty line — paragraph break
    if (line.trim() === "") {
      flushParagraph(paraBuf);
      i++;
      continue;
    }

    // Default: paragraph accumulation
    paraBuf.push(line);
    i++;
  }

  flushParagraph(paraBuf);
  return out.join("\n");
}
