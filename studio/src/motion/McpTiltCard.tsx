import type { PointerEvent, ReactElement } from 'react';

function moveTilt({ currentTarget, pointerType, clientX, clientY }: PointerEvent<HTMLDivElement>) {
  if (pointerType !== 'mouse') return;
  const { left, top, width, height } = currentTarget.getBoundingClientRect();
  currentTarget.style.setProperty('--mcp-tilt-x', String((clientX - left) / width - 0.5));
  currentTarget.style.setProperty('--mcp-tilt-y', String((clientY - top) / height - 0.5));
}

function resetTilt({ currentTarget }: PointerEvent<HTMLDivElement>) {
  currentTarget.style.removeProperty('--mcp-tilt-x');
  currentTarget.style.removeProperty('--mcp-tilt-y');
}

export function McpTiltCard({ children }: { children: ReactElement }) {
  return (
    <div className="om-mcp-tilt" onPointerMove={moveTilt} onPointerLeave={resetTilt} onPointerCancel={resetTilt}>
      {children}
    </div>
  );
}
