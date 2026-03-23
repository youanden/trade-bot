/** Lightweight performance tracking for bot ticks and API calls. */
export class Timer {
  private start: number;

  constructor() {
    this.start = performance.now();
  }

  elapsed(): number {
    return performance.now() - this.start;
  }

  elapsedMs(): string {
    return `${this.elapsed().toFixed(1)}ms`;
  }
}

export function time(): Timer {
  return new Timer();
}
