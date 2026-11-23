import { useEffect, useRef } from 'react';

type MatrixCell = {
  kind: number;
  baseAlpha: number;
  phase: number;
  speed: number;
};

type MatrixPulse = {
  horiz: boolean;
  idx: number;
  pos: number;
  dir: number;
  speed: number;
  len: number;
  alpha: number;
};

/**
 * OpenDesign vector-canvas ambient backdrop for the MCP Hero:
 * subtle 1px alignment dots, crosshairs, vector anchor squares, Bézier handle circles,
 * and gliding accent smart-guide pulses. Reads colors from Studio CSS tokens so it adapts
 * to both dark and light themes and respects prefers-reduced-motion.
 */
export function McpHeroAmbientCanvas({ pulseTrigger }: { pulseTrigger: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pulseFnRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const CELL = 26;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let cells: MatrixCell[] = [];
    let pulses: MatrixPulse[] = [];
    let rafId = 0;
    let running = false;
    let inView = true;

    const resolveColors = () => {
      const style = getComputedStyle(host);
      const glyph = style.getPropertyValue('--motion-mcp-matrix-glyph').trim() || style.color || 'currentColor';
      const accent = style.getPropertyValue('--motion-mcp-matrix-pulse').trim() || style.getPropertyValue('--brand').trim() || style.color || 'currentColor';
      return { glyph, accent };
    };

    const spawnPulse = (boost = false): MatrixPulse => {
      const horiz = Math.random() < 0.7;
      const dir = Math.random() < 0.5 ? 1 : -1;
      return {
        horiz,
        idx: horiz ? Math.floor(Math.random() * Math.max(1, rows)) : Math.floor(Math.random() * Math.max(1, cols)),
        pos: dir > 0 ? -Math.random() * 12 : (horiz ? cols : rows) + Math.random() * 12,
        dir,
        speed: (boost ? 0.14 : 0.065) + Math.random() * 0.055,
        len: 4 + Math.floor(Math.random() * 5),
        alpha: boost ? 0.58 : 0.34,
      };
    };

    const drawGlyph = (kind: number, cx: number, cy: number) => {
      if (kind === 0) {
        ctx.fillRect(cx - 0.75, cy - 0.75, 1.5, 1.5);
      } else if (kind === 1) {
        ctx.beginPath();
        ctx.moveTo(cx - 3.2, cy);
        ctx.lineTo(cx + 3.2, cy);
        ctx.moveTo(cx, cy - 3.2);
        ctx.lineTo(cx, cy + 3.2);
        ctx.stroke();
      } else if (kind === 2) {
        ctx.strokeRect(cx - 2.3, cy - 2.3, 4.6, 4.6);
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    const renderFrame = (ts: number) => {
      const { glyph, accent } = resolveColors();
      ctx.clearRect(0, 0, w, h);
      const t = ts * 0.001;
      const pulseCells = new Map<number, number>();
      const activeNodes: Array<{ r: number; c: number; x: number; y: number; a: number; horiz: boolean }> = [];

      if (!reduced) {
        for (let i = 0; i < pulses.length; i++) {
          const p = pulses[i];
          p.pos += p.dir * p.speed;
          const limit = p.horiz ? cols : rows;
          if ((p.dir > 0 && p.pos - p.len > limit + 4) || (p.dir < 0 && p.pos + p.len < -4)) {
            pulses[i] = spawnPulse(false);
            continue;
          }
          const head = Math.round(p.pos);
          if (p.horiz && p.idx >= 0 && p.idx < rows && head >= 0 && head < cols) {
            activeNodes.push({ r: p.idx, c: head, x: head * CELL + CELL * 0.5, y: p.idx * CELL + CELL * 0.5, a: p.alpha, horiz: true });
          } else if (!p.horiz && p.idx >= 0 && p.idx < cols && head >= 0 && head < rows) {
            activeNodes.push({ r: head, c: p.idx, x: p.idx * CELL + CELL * 0.5, y: head * CELL + CELL * 0.5, a: p.alpha, horiz: false });
          }
          for (let s = 0; s < p.len; s++) {
            const k = Math.round(p.pos - p.dir * s);
            const r = p.horiz ? p.idx : k;
            const c = p.horiz ? k : p.idx;
            if (r >= 0 && r < rows && c >= 0 && c < cols) {
              const fade = (1 - s / p.len) * p.alpha;
              const key = r * cols + c;
              if (fade > (pulseCells.get(key) || 0)) pulseCells.set(key, fade);
            }
          }
        }
      }

      ctx.lineWidth = 1;
      for (let i = 0; i < activeNodes.length; i++) {
        const n = activeNodes[i];
        const span = 3.2 * CELL;
        const x1 = n.horiz ? n.x - span : n.x;
        const y1 = n.horiz ? n.y : n.y - span;
        const x2 = n.horiz ? n.x + span : n.x;
        const y2 = n.horiz ? n.y : n.y + span;
        ctx.save();
        ctx.globalAlpha = n.a * 0.28;
        ctx.strokeStyle = accent;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.lineWidth = 1;
      for (let r = 0; r < rows; r++) {
        const cy = r * CELL + CELL * 0.5;
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const cell = cells[idx];
          const cx = c * CELL + CELL * 0.5;
          const pulse = pulseCells.get(idx) || 0;
          if (pulse > 0.02) {
            ctx.save();
            ctx.globalAlpha = Math.min(0.85, pulse * 1.15);
            ctx.strokeStyle = accent;
            ctx.fillStyle = accent;
            drawGlyph(cell.kind === 0 && pulse > 0.22 ? 2 : cell.kind, cx, cy);
            ctx.restore();
          } else {
            const wave = reduced ? 1 : 0.72 + 0.28 * Math.sin(t * cell.speed + cell.phase);
            ctx.save();
            ctx.globalAlpha = cell.baseAlpha * wave;
            ctx.strokeStyle = glyph;
            ctx.fillStyle = glyph;
            drawGlyph(cell.kind, cx, cy);
            ctx.restore();
          }
        }
      }
    };

    const tick = (ts: number) => {
      if (!running) return;
      renderFrame(ts);
      rafId = requestAnimationFrame(tick);
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.ceil(rect.width));
      h = Math.max(1, Math.ceil(rect.height));
      canvas.width = Math.ceil(w * dpr);
      canvas.height = Math.ceil(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / CELL) + 1;
      rows = Math.ceil(h / CELL) + 1;
      cells = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const roll = Math.random();
          const kind = roll < 0.74 ? 0 : roll < 0.85 ? 1 : roll < 0.93 ? 2 : 3;
          cells.push({
            kind,
            baseAlpha: kind === 0 ? 0.55 + Math.random() * 0.35 : 0.65 + Math.random() * 0.35,
            phase: Math.random() * Math.PI * 2,
            speed: 0.45 + Math.random() * 0.65,
          });
        }
      }
      pulses = [spawnPulse(false), spawnPulse(false), spawnPulse(false), spawnPulse(false), spawnPulse(false)];
      renderFrame(0);
    };

    const syncLoop = () => {
      if (reduced || !inView || document.hidden) {
        running = false;
        cancelAnimationFrame(rafId);
      } else if (!running) {
        running = true;
        rafId = requestAnimationFrame(tick);
      }
    };

    pulseFnRef.current = () => {
      if (reduced || !cols || !rows) return;
      pulses.push(spawnPulse(true), spawnPulse(true));
      if (pulses.length > 9) pulses.splice(0, pulses.length - 9);
    };

    resize();
    syncLoop();

    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 120);
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', syncLoop);

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(entries => {
        inView = entries[0]?.isIntersecting ?? true;
        syncLoop();
      }, { threshold: 0.02 });
      observer.observe(host);
    }

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', syncLoop);
      observer?.disconnect();
      pulseFnRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (pulseTrigger > 0) pulseFnRef.current?.();
  }, [pulseTrigger]);

  return <canvas ref={canvasRef} className="om-mcp-ambient-canvas" aria-hidden="true" />;
}
