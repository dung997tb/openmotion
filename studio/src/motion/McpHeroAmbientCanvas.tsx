import { useEffect, useRef } from 'react';

const GRID_STEP = 38;

type GridCell = {
  col: number;
  row: number;
  kind: 'dot' | 'cross' | 'anchor' | 'handle';
  phase: number;
};

type GuidePulse = {
  horizontal: boolean;
  lane: number;
  position: number;
  direction: number;
  speed: number;
  length: number;
};

type MatrixColors = { glyph: string; pulse: string; glow: string };

function createGrid(cols: number, rows: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // The demo's seeded grid keeps each coordinate's shape and phase stable across resizes.
      const shape = Math.abs(Math.sin((col + 1) * 12.9898 + (row + 1) * 78.233) * 43758.5453) % 1;
      const phase = Math.abs(Math.sin((col + 7) * 39.346 + (row + 3) * 11.135) * 24634.6345) % 1;
      const kind = shape > 0.94 ? 'handle' : shape > 0.86 ? 'anchor' : shape > 0.74 ? 'cross' : 'dot';
      cells.push({ col, row, kind, phase: phase * Math.PI * 2 });
    }
  }
  return cells;
}

function createPulse(cols: number, rows: number, centerBias = false): GuidePulse {
  const horizontal = Math.random() < 0.72;
  const laneCount = horizontal ? rows : cols;
  const alongCount = horizontal ? cols : rows;
  const sample = Math.random();
  const centeredLane = horizontal ? 0.25 + sample * 0.5 : 0.2 + sample * 0.6;
  const lane = Math.floor(laneCount * (centerBias ? centeredLane : sample));
  const direction = Math.random() < 0.5 ? 1 : -1;
  const speed = horizontal ? 0.042 + Math.random() * 0.032 : 0.036 + Math.random() * 0.028;
  const length = horizontal ? 5 + Math.floor(Math.random() * 4) : 4 + Math.floor(Math.random() * 3);
  return { horizontal, lane, position: direction > 0 ? -3 : alongCount + 3, direction, speed, length };
}

const centeredCoordinate = (index: number) => index * GRID_STEP + GRID_STEP * 0.5;
const alignedCoordinate = (index: number) => Math.round(centeredCoordinate(index)) + 0.5;
const colorAt = (channels: string, opacity: number) => `rgb(${channels} / ${opacity})`;

function drawPulse(ctx: CanvasRenderingContext2D, pulse: GuidePulse, colors: MatrixColors) {
  const lane = alignedCoordinate(pulse.lane);
  const tail = centeredCoordinate(pulse.position - pulse.direction * pulse.length);
  const head = centeredCoordinate(pulse.position);
  const [startX, startY, endX, endY] = pulse.horizontal ? [tail, lane, head, lane] : [lane, tail, lane, head];
  const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
  gradient.addColorStop(0, colorAt(colors.pulse, 0));
  gradient.addColorStop(0.72, colorAt(colors.pulse, pulse.horizontal ? 0.22 : 0.20));
  gradient.addColorStop(1, colorAt(colors.glow, 0.04));
  ctx.strokeStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.fillStyle = colorAt(colors.glow, pulse.horizontal ? 0.42 : 0.38);
  ctx.beginPath();
  ctx.arc(endX, endY, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawCell(ctx: CanvasRenderingContext2D, cell: GridCell, pulses: GuidePulse[], elapsed: number, colors: MatrixColors) {
  const x = alignedCoordinate(cell.col), y = alignedCoordinate(cell.row);
  let glow = 0;
  for (const pulse of pulses) {
    if (pulse.lane !== (pulse.horizontal ? cell.row : cell.col)) continue;
    const distance = (pulse.position - (pulse.horizontal ? cell.col : cell.row)) * pulse.direction;
    if (distance >= 0 && distance < pulse.length) glow = Math.max(glow, 1 - distance / pulse.length);
  }
  const wave = 0.5 + 0.5 * Math.sin(elapsed * 0.00075 + cell.col * 0.34 + cell.row * 0.26 + cell.phase);
  const ink = glow > 0.05 ? colorAt(colors.glow, 0.16 + glow * 0.42) : colorAt(colors.glyph, 0.075 + wave * 0.075);
  ctx.fillStyle = ctx.strokeStyle = ink;

  switch (cell.kind) {
    case 'dot':
      ctx.beginPath();
      ctx.arc(x, y, glow > 0.15 ? 1.5 : 1.05, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'cross':
      ctx.beginPath();
      ctx.moveTo(x - 3, y);
      ctx.lineTo(x + 3, y);
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x, y + 3);
      ctx.stroke();
      break;
    case 'anchor':
      ctx.strokeRect(x - 2.5, y - 2.5, 5, 5);
      if (glow > 0.25) {
        ctx.fillStyle = colorAt(colors.pulse, glow * 0.45);
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
      break;
    case 'handle':
      ctx.beginPath();
      ctx.arc(x, y, 2.7, 0, Math.PI * 2);
      ctx.stroke();
      if (glow > 0.25) {
        ctx.fillStyle = colorAt(colors.pulse, glow * 0.45);
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
  }
}

/** The demo's vector grid and frame-by-frame smart guide motion. */
export function McpHeroAmbientCanvas({ clientId }: { clientId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pulseFnRef = useRef<(() => void) | null>(null);
  const previousClient = useRef(clientId);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !host || !ctx) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0, height = 0, dpr = 0, cols = 0, rows = 0;
    let cells: GridCell[] = [], pulses: GuidePulse[] = [];
    let rafId: number | null = null;
    let frameTime = 0;
    let inView = true;

    const resolveColors = () => {
      const style = getComputedStyle(host);
      return {
        glyph: style.getPropertyValue('--motion-mcp-matrix-glyph').trim(),
        pulse: style.getPropertyValue('--motion-mcp-matrix-pulse').trim(),
        glow: style.getPropertyValue('--motion-mcp-matrix-glow').trim(),
      };
    };
    let colors = resolveColors();

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;
      for (const pulse of pulses) drawPulse(ctx, pulse, colors);
      for (const cell of cells) drawCell(ctx, cell, pulses, frameTime, colors);
    };

    const tick = (now: number) => {
      frameTime = now;
      for (let i = 0; i < pulses.length; i++) {
        const pulse = pulses[i];
        pulse.position += pulse.direction * pulse.speed;
        const limit = (pulse.horizontal ? cols : rows) + 6;
        if (pulse.position < -6 || pulse.position > limit) pulses[i] = createPulse(cols, rows);
      }
      draw();
      rafId = requestAnimationFrame(tick);
    };

    const resize = () => {
      const nextWidth = host.clientWidth, nextHeight = host.clientHeight;
      const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!nextWidth || !nextHeight || (width === nextWidth && height === nextHeight && dpr === nextDpr)) return;
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(width / GRID_STEP) + 1;
      rows = Math.ceil(height / GRID_STEP) + 1;
      cells = createGrid(cols, rows);
      pulses = Array.from({ length: 4 }, () => {
        const pulse = createPulse(cols, rows, true);
        pulse.position = Math.random() * (pulse.horizontal ? cols : rows);
        return pulse;
      });
      draw();
    };

    const syncLoop = () => {
      if (motion.matches || !inView || document.hidden) {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
      } else if (rafId === null) {
        rafId = requestAnimationFrame(tick);
      }
    };

    pulseFnRef.current = () => {
      if (!motion.matches && cols && rows && pulses.length < 7) {
        pulses.push(createPulse(cols, rows, true), createPulse(cols, rows, true));
      }
    };

    resize();
    syncLoop();
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(host);
    const visibilityObserver = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      syncLoop();
    }) : null;
    visibilityObserver?.observe(host);
    const themeObserver = new MutationObserver(() => { colors = resolveColors(); draw(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', syncLoop);
    motion.addEventListener('change', syncLoop);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      visibilityObserver?.disconnect();
      themeObserver.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', syncLoop);
      motion.removeEventListener('change', syncLoop);
      pulseFnRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (clientId === previousClient.current) return;
    previousClient.current = clientId;
    pulseFnRef.current?.();
  }, [clientId]);

  return <canvas ref={canvasRef} className="om-mcp-ambient-canvas" aria-hidden="true" />;
}
