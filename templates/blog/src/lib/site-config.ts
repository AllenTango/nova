/**
 * site-config.ts
 * 读取 site.yaml 的 pages 字段，供各页面做 guard 判断。
 * 若当前页面类型不在 pages 声明中，抛出让 Astro 渲染 404。
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(__dirname, '../../site.yaml'), 'utf-8');

// 简单 YAML pages 解析
const pagesMatch = raw.match(/^pages:\s*\n([\s\S]*?)(?:\n\w|\n$)/m);
export const activePages: string[] = pagesMatch
  ? pagesMatch[1].replace(/^\s*-\s+/gm, '').trim().split(/\s+/).filter(Boolean)
  : ['blog', 'about'];

/**
 * 页面 guard：若 pageType 不在 activePages 中，渲染空页面（404）。
 * Astro 静态构建时，未使用的 getStaticPaths 会被忽略。
 */
export function guardPage(pageType: string): void {
  if (!activePages.includes(pageType)) {
    throw new Error(`Page ${pageType} is not enabled in site.yaml`);
  }
}
