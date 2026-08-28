"use client";

import { useEffect, useRef } from "react";
import type { DominantColors } from "@/lib/color";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 0..1, counts down
  size: number;
}

const LINE_COLOR = "255 255 255";

export default function Visualizer({
  analyserRef,
  accentColor,
}: {
  analyserRef: React.RefObject<AnalyserNode | null>;
  accentColor: DominantColors | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const bassHistoryRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let raf: number;
    const timeData = new Uint8Array(256);
    const freqData = new Uint8Array(256);

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width * devicePixelRatio;
      canvas.height = height * devicePixelRatio;
    };
    resize();
    window.addEventListener("resize", resize);

    const accent = accentColor?.primary ?? "180 180 180";

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const analyser = analyserRef.current;
      if (!analyser) {
        drawIdleLine(ctx, width, height);
        return;
      }

      analyser.getByteTimeDomainData(timeData as any);
      analyser.getByteFrequencyData(freqData as any);

      // Minimal monochrome waveform line.
      ctx.beginPath();
      ctx.lineWidth = 1.5 * devicePixelRatio;
      ctx.strokeStyle = `rgb(${LINE_COLOR} / 0.85)`;
      const sliceWidth = width / timeData.length;
      let x = 0;
      for (let i = 0; i < timeData.length; i++) {
        const v = timeData[i] / 128 - 1; // -1..1
        const y = height / 2 + v * height * 0.28;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.stroke();

      // Bass energy -> particle bursts.
      const bass = average(freqData.slice(0, 12)) / 255;
      const history = bassHistoryRef.current;
      history.push(bass);
      if (history.length > 30) history.shift();
      const rollingAvg = average(history);

      if (bass > 0.55 && bass > rollingAvg * 1.35) {
        spawnBurst(particlesRef.current, width, height, bass);
      }

      updateAndDrawParticles(ctx, particlesRef.current, accent);
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [analyserRef, accentColor]);

  return <canvas ref={canvasRef} className="h-full w-full" />;
}

function average(values: Uint8Array | number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return values.length ? sum / values.length : 0;
}

function drawIdleLine(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.beginPath();
  ctx.lineWidth = 1.5 * devicePixelRatio;
  ctx.strokeStyle = `rgb(${LINE_COLOR} / 0.4)`;
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
}

function spawnBurst(particles: Particle[], width: number, height: number, intensity: number) {
  const count = Math.round(8 + intensity * 20);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (0.5 + Math.random() * 2.5) * devicePixelRatio * intensity;
    particles.push({
      x: width / 2,
      y: height / 2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      size: (1 + Math.random() * 2.5) * devicePixelRatio,
    });
  }
  if (particles.length > 400) particles.splice(0, particles.length - 400);
}

function updateAndDrawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  accentColor: string,
) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.life -= 0.012;

    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    ctx.beginPath();
    ctx.fillStyle = `rgb(${accentColor} / ${p.life * 0.8})`;
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
}
