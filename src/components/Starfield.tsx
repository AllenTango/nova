import { Box } from "@mui/material";
import { useEffect, useRef } from "react";
import { T } from "../theme";
import { on } from "../lib/events";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  r: number;
  color: string;
}

interface Burst {
  x: number;
  y: number;
  startTime: number;
  duration: number;
  color: string;
  ringRadius: number;
  ringAlpha: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  length: number;
  alpha: number;
}

/**
 * 签名元素：缓慢呼吸嘅星空 + 事件触发嘅爆裂。
 *
 * 闲置：~180 颗星慢呼吸 24fps。
 * 事件（create / save / delete / upgrade）触发时，画布用粒子爆裂
 * 或冲击波回应，从调用方坐标发出。这把工具变成一场*对话*——
 * 你嘅每个动作都会被宇宙应答。
 *
 * 连续第 7 天打开流星雨。
 */
export default function Starfield({
  density = 0.00015,
  fixed = true,
}: {
  density?: number;
  fixed?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);

  // Refs hold mutable state without re-triggering the effect.
  const particlesRef = useRef<Particle[]>([]);
  const burstsRef = useRef<Burst[]>([]);
  const meteorsRef = useRef<Meteor[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let stars: Array<{
      x: number;
      y: number;
      r: number;
      a: number;
      phase: number;
      speed: number;
    }> = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.floor(w * h * density);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.1 + 0.2,
        a: Math.random() * 0.6 + 0.2,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.0008 + 0.0003,
      }));
    };

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const FRAME_MS = prefersReduced ? 0 : 1000 / 24;

    const spawnBurst = (x: number, y: number, color: string, count: number) => {
      burstsRef.current.push({
        x,
        y,
        startTime: performance.now(),
        duration: 700,
        color,
        ringRadius: 0,
        ringAlpha: 1,
      });
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
        const speed = 60 + Math.random() * 100;
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          maxLife: 600 + Math.random() * 400,
          r: 1.2 + Math.random() * 1.6,
          color,
        });
      }
    };

    const unsub = on((e) => {
      if (e.type === "create") {
        spawnBurst(e.x, e.y, "255, 107, 107", 24);
      } else if (e.type === "save") {
        // A quiet nova blink where the star was saved — smaller than
        // create/upgrade so it doesn't interrupt typing flow.
        const cx = e.x ?? window.innerWidth / 2;
        const cy = e.y ?? window.innerHeight / 2;
        spawnBurst(cx, cy, "255, 107, 107", 12);
      } else if (e.type === "upgrade") {
        // A longer, brighter nova on upgrade — it's a kind of second birth.
        spawnBurst(e.x, e.y, "255, 107, 107", 40);
        setTimeout(
          () => spawnBurst(e.x, e.y, "107, 91, 255", 24),
          250
        );
      } else if (e.type === "delete") {
        // A supernova's white flash, then a brief shockwave.
        spawnBurst(e.x, e.y, "255, 230, 200", 32);
      } else if (e.type === "milestone") {
        // Trigger a meteor shower centered on the screen.
        const w = window.innerWidth;
        for (let i = 0; i < 12; i++) {
          const startX = Math.random() * w;
          meteorsRef.current.push({
            x: startX,
            y: -20,
            vx: -140 + Math.random() * 30,
            vy: 260 + Math.random() * 80,
            life: 0,
            length: 60 + Math.random() * 30,
            alpha: 0.8,
          });
        }
      }
    });

    const draw = (t: number) => {
      rafRef.current = requestAnimationFrame(draw);

      if (t - lastFrameRef.current < FRAME_MS) return;
      lastFrameRef.current = t;

      if (document.hidden) return;

      const isDark = document.documentElement.dataset.theme !== "light";
      const t1 = isDark ? T.dark : T.light;
      const baseColor = isDark ? "232, 228, 255" : "180, 110, 60";

      // Background fill
      ctx.fillStyle = t1.ink;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.globalCompositeOperation = "lighter";

      // Stars
      for (const s of stars) {
        const breath = prefersReduced
          ? s.a
          : s.a * (0.55 + 0.45 * Math.sin(t * s.speed + s.phase));
        ctx.fillStyle = `rgba(${baseColor}, ${breath})`;
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }

      // Shockwave rings
      const now = performance.now();
      const aliveBursts: Burst[] = [];
      for (const b of burstsRef.current) {
        const elapsed = now - b.startTime;
        if (elapsed > b.duration) continue;
        aliveBursts.push(b);
        const progress = elapsed / b.duration;
        const radius = progress * 140;
        const alpha = (1 - progress) * 0.5;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${b.color}, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.arc(b.x, b.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      burstsRef.current = aliveBursts;

      // Particles
      const dt = FRAME_MS / 1000;
      const aliveParticles: Particle[] = [];
      for (const p of particlesRef.current) {
        p.life += FRAME_MS;
        if (p.life > p.maxLife) continue;
        aliveParticles.push(p);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 60 * dt; // gentle gravity
        const lifeRatio = p.life / p.maxLife;
        const alpha = (1 - lifeRatio) * 0.9;
        ctx.fillStyle = `rgba(${p.color}, ${alpha})`;
        ctx.fillRect(p.x, p.y, p.r, p.r);
      }
      particlesRef.current = aliveParticles;

      // Meteors
      const aliveMeteors: Meteor[] = [];
      for (const m of meteorsRef.current) {
        m.life += FRAME_MS;
        if (m.life > 1800) continue;
        aliveMeteors.push(m);
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        // Head + tail
        const tailX = m.x - (m.vx / 280) * m.length;
        const tailY = m.y - (m.vy / 280) * m.length;
        const grd = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
        grd.addColorStop(0, `rgba(${baseColor}, ${m.alpha})`);
        grd.addColorStop(1, `rgba(${baseColor}, 0)`);
        ctx.strokeStyle = grd;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
      }
      meteorsRef.current = aliveMeteors;

      ctx.globalCompositeOperation = "source-over";
    };

    resize();
    window.addEventListener("resize", resize);
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      unsub();
    };
  }, [density]);

  return (
    <Box
      sx={{
        position: fixed ? "fixed" : "absolute",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </Box>
  );
}
