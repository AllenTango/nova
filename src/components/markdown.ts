/**
 * 极简离线 Markdown → HTML 渲染器。
 *
 * 故意保持很小——只覆盖编辑器实时预览需要的功能：
 *   - 标题（#..######）
 *   - 段落
 *   - 粗体 **x**、斜体 *x*、行内代码 `x`
 *   - 链接 [t](u)、图片 ![a](u)
 *   - 无序列表（-, *）和有序列表（1.）
 *   - 引用块（>）
 *   - 围栏代码（```）
 *   - 水平线（---）
 *
 * 输出 XSS 安全：先转义 HTML，再施加我们自家格式。
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

    // 围栏代码
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

    // 标题
    const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) {
      flushParagraph(paraBuf);
      const level = hMatch[1].length;
      out.push(`<h${level}>${inline(hMatch[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // 水平线
    if (/^-{3,}\s*$/.test(line) || /^\*{3,}\s*$/.test(line)) {
      flushParagraph(paraBuf);
      out.push(`<hr />`);
      i++;
      continue;
    }

    // 引用块
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

    // 无序列表
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

    // 有序列表
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

    // 空行——段落分隔
    if (line.trim() === "") {
      flushParagraph(paraBuf);
      i++;
      continue;
    }

    // 默认：段落累积
    paraBuf.push(line);
    i++;
  }

  flushParagraph(paraBuf);
  return out.join("\n");
}
