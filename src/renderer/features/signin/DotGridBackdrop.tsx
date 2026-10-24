// The sign-in screen's backdrop: a quiet dot grid (CSS) with a canvas over it that lights the dots under
// three slowly wandering glows and under the pointer. With reduced motion only the still grid shows.
import { useEffect, useRef } from "react";

/** Grid pitch in CSS px; must match `--signin-dot-pitch` in styles.css. */
const PITCH = 22;
/** About 30 fps: smooth enough for a slow light, light on the GPU while the engine starts underneath. */
const FRAME_MS = 1000 / 30 - 4;
const POINTER_RADIUS = 110;

/** Each glow wanders on its own speeds and phases, so the lit spots never move in step. */
const GLOWS = [
  { speedX: 0.23, speedY: 0.37, phase: 1.2, spanX: 0.32, spanY: 0.22, radius: 170, strength: 0.7 },
  { speedX: 0.31, speedY: 0.19, phase: 3.9, spanX: 0.4, spanY: 0.3, radius: 120, strength: 0.55 },
  { speedX: 0.17, speedY: 0.29, phase: 5.1, spanX: 0.36, spanY: 0.34, radius: 95, strength: 0.5 },
] as const;

/** Gaussian fall-off of a glow at a dot; 0 beyond twice the radius so far dots cost nothing. */
function lightAt(x: number, y: number, cx: number, cy: number, radius: number): number {
  const distance = (x - cx) ** 2 + (y - cy) ** 2;
  return distance > radius * radius * 4 ? 0 : Math.exp(-distance / (2 * (radius / 2) ** 2));
}

export function DotGridBackdrop({ animate }: { animate: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!animate) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      // Recoverable: the still dot grid shows without the moving light.
      console.error("[sign-in] backdrop light unavailable: no 2D canvas context");
      return;
    }
    let width = 0;
    let height = 0;
    let ratio = 1;
    let color = "181, 148, 255";
    let colorReadAt = Number.NEGATIVE_INFINITY;
    // Re-read about once a second, so switching light/dark recolours the light without a resize.
    const readColor = (now: number) => {
      if (now - colorReadAt < 1000) return;
      colorReadAt = now;
      const value = getComputedStyle(canvas).getPropertyValue("--signin-lit").trim();
      if (value) color = value;
    };
    const resize = () => {
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      colorReadAt = Number.NEGATIVE_INFINITY;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // The pointer is tracked on the whole screen (the canvas itself lets events through).
    const pointer = { x: 0, y: 0, target: 0, strength: 0 };
    const host = canvas.closest<HTMLElement>(".signin-gate") ?? canvas.parentElement;
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.target = 1;
    };
    const onLeave = () => {
      pointer.target = 0;
    };
    host?.addEventListener("pointermove", onMove);
    host?.addEventListener("pointerleave", onLeave);

    let frame = 0;
    let last = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      // Hidden windows draw nothing; the browser also stops animation frames for them.
      if (document.hidden || now - last < FRAME_MS || width === 0 || height === 0) return;
      last = now;
      readColor(now);
      pointer.strength += (pointer.target - pointer.strength) * 0.12;
      const seconds = now / 1000;
      const glows = GLOWS.map((glow) => ({
        x: width * (0.5 + glow.spanX * Math.sin(seconds * glow.speedX + glow.phase - 1.2)),
        y: height * (0.45 + glow.spanY * Math.sin(seconds * glow.speedY + glow.phase)),
        radius: glow.radius,
        strength: glow.strength,
      }));
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      for (let y = PITCH / 2; y < height; y += PITCH) {
        for (let x = PITCH / 2; x < width; x += PITCH) {
          let lift = lightAt(x, y, pointer.x, pointer.y, POINTER_RADIUS) * pointer.strength;
          for (const glow of glows) lift += lightAt(x, y, glow.x, glow.y, glow.radius) * glow.strength;
          lift = Math.min(1, lift);
          if (lift < 0.04) continue;
          context.fillStyle = `rgba(${color}, ${(lift * 0.85).toFixed(3)})`;
          context.beginPath();
          context.arc(x, y, 1 + lift * 1.4, 0, Math.PI * 2);
          context.fill();
        }
      }
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      host?.removeEventListener("pointermove", onMove);
      host?.removeEventListener("pointerleave", onLeave);
    };
  }, [animate]);

  return (
    <div className="signin-dots" aria-hidden>
      {animate && <canvas ref={canvasRef} className="signin-light" />}
    </div>
  );
}
