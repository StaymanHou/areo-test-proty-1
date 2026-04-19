import Stats from 'stats.js';
import GUI from 'lil-gui';

export interface DebugHandles {
  stats: Stats;
  gui: GUI;
}

const DEBUG_FLAG = 'debug';

export function isDebugEnabled(): boolean {
  return new URLSearchParams(location.search).has(DEBUG_FLAG);
}

export function initDebug(): DebugHandles | null {
  if (!isDebugEnabled()) return null;

  const stats = new Stats();
  stats.showPanel(0);
  stats.dom.style.position = 'fixed';
  stats.dom.style.top = '0';
  stats.dom.style.left = '0';
  document.body.appendChild(stats.dom);

  const gui = new GUI({ title: 'Debug' });

  return { stats, gui };
}
