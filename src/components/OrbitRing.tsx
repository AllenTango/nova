import { Box, BoxProps } from "@mui/material";

export type OrbitStatus = "idle" | "active" | "locked" | "warning";

interface OrbitRingProps extends BoxProps {
  status: OrbitStatus;
  size?: number;
}

/**
 * Nova 签名元素：星体状态环。
 *
 * 用于表示一个对象与 Nova 的“连接状态”：
 * - idle:    空环，未配置或未激活
 * - active:  微光脉冲，已配置且可用
 * - locked:  实心高亮，当前正在使用（如 AI 副官正在走的链路）
 * - warning: 警告闪烁，配置异常或断开
 */
export default function OrbitRing({
  status,
  size = 12,
  sx,
  ...rest
}: OrbitRingProps) {
  const colorMap: Record<OrbitStatus, string> = {
    idle: "var(--orbit-idle, rgba(154, 147, 184, 0.35))",
    active: "var(--orbit-active, #6B5BFF)",
    locked: "var(--orbit-locked, #FF6B6B)",
    warning: "var(--orbit-warning, #F59E0B)",
  };

  const glowMap: Record<OrbitStatus, string> = {
    idle: "transparent",
    active: "rgba(107, 91, 255, 0.35)",
    locked: "rgba(255, 107, 107, 0.4)",
    warning: "rgba(245, 158, 11, 0.4)",
  };

  const isFilled = status === "locked";
  const isPulsing = status === "active" || status === "warning";

  return (
    <Box
      {...rest}
      sx={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: isFilled ? "none" : `1.5px solid ${colorMap[status]}`,
        background: isFilled ? colorMap[status] : "transparent",
        boxShadow: isFilled ? `0 0 ${size * 0.6}px ${glowMap[status]}` : "none",
        flexShrink: 0,
        ...(isPulsing && {
          animation: "orbitPulse 2.2s ease-in-out infinite",
          "@keyframes orbitPulse": {
            "0%, 100%": {
              boxShadow: `0 0 0px ${glowMap[status]}`,
              opacity: 0.85,
            },
            "50%": {
              boxShadow: `0 0 ${size * 0.8}px ${glowMap[status]}`,
              opacity: 1,
            },
          },
        }),
        ...sx,
      }}
    />
  );
}
