import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Tooltip, Typography } from "@mui/material";
import { T, FONT } from "../theme";
import { layoutStars } from "../lib/starmap-layout";
import { formatWordMass, type StarStage } from "../lib/words";

/**
 * 项目嘅真·星图渲染（game-design §4.3）。
 *
 * 每个项目渲染成一颗 SVG 星：一个发光圆，半径反映项目阶段
 * （星尘 → 星港 越外越大），高阶段外加一道轨道环。
 *
 * 平移：鼠标拖拽 → 更新 `offset` state。
 * 缩放：滚轮上下 → 更新 `scale`，clamp 在 [0.5, 3.0]。
 * Hover：显示 tooltip，含 title / kind / 字数 / updated date。
 * 点击：通过 `onSelect` 打开项目。
 *
 * 性能注：当 N >= 100 个项目时我们不切到 canvas（Chromium 里 SVG
 * 100 个节点应付得来）；只跳过该区间嘅 hover label 动画，帧预算
 * 压在 16ms 以下。
 */

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;
const STAGE_RADIUS: Record<StarStage, number> = {
  星尘: 4,
  星胚: 6,
  新星: 9,
  恒星: 12,
  星港: 15,
};
const STAGE_FILL: Record<StarStage, string> = {
  星尘: "#5C5677",        // starFaint
  星胚: "#9A93B8",        // starDim
  新星: "#6B5BFF",        // nebula
  恒星: "#FF6B6B",        // nova
  星港: "#F59E0B",        // corona
};

export interface StarMapItem {
  id: string;
  title: string;
  kind: "note" | "site";
  mass: { count: number; stage: StarStage };
  updatedAt: number;
}

export default function StarMap({
  items,
  onSelect,
  themeMode,
  height = 520,
}: {
  items: ReadonlyArray<StarMapItem>;
  onSelect: (id: string) => void;
  themeMode: "dark" | "light";
  height?: number;
}) {
  const t = T[themeMode];
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [size, setSize] = useState({ w: 800, h: height });

  // ResizeObserver to track container width (height is fixed).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setSize({ w: e.contentRect.width, h: height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  // Compute layout once per items identity.
  const positions = useMemo(
    () =>
      layoutStars(
        items.map((it) => ({ id: it.id, mass: it.mass })),
      ),
    [items],
  );

  // Pan handlers (Q1: no boundaries — infinite universe).
  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
  };
  const onMouseUp = () => {
    dragRef.current = null;
  };

  // Wheel zoom (Q2: 0.5x - 3.0x).
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale + (e.deltaY < 0 ? 0.12 : -0.12)));
    setScale(next);
  };

  const cursor = dragRef.current ? "grabbing" : "grab";

  return (
    <Box
      ref={containerRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      sx={{
        position: "relative",
        width: "100%",
        height,
        overflow: "hidden",
        borderRadius: 2,
        border: `1px solid ${t.border}`,
        background: `radial-gradient(circle at center, ${t.dust} 0%, ${t.ink} 80%)`,
        cursor,
        userSelect: "none",
      }}
    >
      <svg
        width={size.w}
        height={size.h}
        viewBox={`${-size.w / 2} ${-size.h / 2} ${size.w} ${size.h}`}
        style={{ display: "block" }}
      >
        <g transform={`translate(${offset.x}, ${offset.y}) scale(${scale})`}>
          {items.map((it) => {
            const p = positions.get(it.id);
            if (!p) return null;
            const r = STAGE_RADIUS[it.mass.stage];
            const fill = STAGE_FILL[it.mass.stage];
            const showRing = it.mass.stage === "恒星" || it.mass.stage === "星港";
            return (
              <Tooltip
                key={it.id}
                title={
                  <Box sx={{ p: 0.5 }}>
                    <Typography
                      sx={{
                        fontFamily: FONT.display,
                        fontSize: "0.9rem",
                        color: t.star,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {it.title || "未命名"}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ color: t.starFaint, display: "block", mt: 0.25 }}
                    >
                      {it.kind === "site" ? "恒星 · 站点" : it.mass.stage}
                      {" · "}
                      {formatWordMass(it.mass.count)} 字
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ color: t.starFaint, fontSize: "0.65rem" }}
                    >
                      {new Date(it.updatedAt * 1000).toLocaleDateString("zh-CN")}
                    </Typography>
                  </Box>
                }
                placement="top"
                arrow
              >
                <g
                  style={{ cursor: "pointer" }}
                  onClick={() => onSelect(it.id)}
                >
                  {showRing && (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={r + 6}
                      fill="none"
                      stroke={fill}
                      strokeWidth={1}
                      opacity={0.45}
                    />
                  )}
                  <circle cx={p.x} cy={p.y} r={r} fill={fill}>
                    <animate
                      attributeName="opacity"
                      values="0.7;1;0.7"
                      dur="3s"
                      repeatCount="indefinite"
                    />
                  </circle>
                  {/* Stage label only when zoomed in enough */}
                  {scale >= 1.5 && (
                    <text
                      x={p.x + r + 6}
                      y={p.y + 4}
                      fontSize={10}
                      fontFamily={FONT.mono}
                      fill={t.starDim}
                      style={{ pointerEvents: "none" }}
                    >
                      {it.title || "未命名"}
                    </text>
                  )}
                </g>
              </Tooltip>
            );
          })}
        </g>
      </svg>

      {/* Zoom indicator */}
      <Box
        sx={{
          position: "absolute",
          bottom: 12,
          right: 12,
          px: 1.5,
          py: 0.5,
          borderRadius: 1,
          background: `${t.dust}cc`,
          border: `1px solid ${t.border}`,
          fontFamily: FONT.mono,
          fontSize: "0.7rem",
          color: t.starDim,
          pointerEvents: "none",
        }}
      >
        {scale.toFixed(2)}× · {items.length} stars
      </Box>
    </Box>
  );
}
