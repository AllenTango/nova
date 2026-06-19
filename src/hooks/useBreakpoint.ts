/**
 * useBreakpoint — 轻量级断点检测 hook。
 *
 * 不使用额外 npm 包，直接监听 window.innerWidth。
 * 返回值：'narrow' | 'medium' | 'wide'
 *
 * 使用方式：
 *   const bp = useBreakpoint();
 *   const sidebarWidth = bp === 'narrow' ? SIDEBAR.rail : bp === 'medium' ? SIDEBAR.compact : SIDEBAR.wide;
 */

import { useState, useEffect } from "react";
import { BREAK } from "../theme";

export function useBreakpoint(): "narrow" | "medium" | "wide" {
  const [bp, setBp] = useState<"narrow" | "medium" | "wide">("wide");

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w < BREAK.narrow) {
        setBp("narrow");
      } else if (w < BREAK.medium) {
        setBp("medium");
      } else {
        setBp("wide");
      }
    };

    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return bp;
}
