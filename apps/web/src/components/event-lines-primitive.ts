import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';

// fancy-canvas's CanvasRenderingTarget2D, derived from the renderer interface
// (same trick as gaussian-band-series.ts — 'fancy-canvas' isn't resolvable here).
type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

export interface ChartEvent {
  /** YYYY-MM-DD; must exist on the time scale (whitespace points extend it). */
  time: string;
  kind: 'earnings' | 'exDividend';
}

export interface EventLinesOptions {
  events: ChartEvent[];
  /** #rrggbb resolved from --warning (earnings) and --primary (ex-dividend). */
  earningsColor: string;
  exDividendColor: string;
}

const KIND_LABEL: Record<ChartEvent['kind'], string> = {
  earnings: 'E',
  exDividend: 'D',
};

class EventLinesRenderer implements IPrimitivePaneRenderer {
  constructor(
    private _lines: Array<{ x: number; color: string; label: string }>,
    private _paneHeight: number
  ) {}

  draw(target: DrawTarget): void {
    // biome-ignore lint/correctness/useHookAtTopLevel: useBitmapCoordinateSpace is a fancy-canvas rendering method, not a React hook.
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      for (const line of this._lines) {
        const x = Math.round(line.x * hr);
        ctx.save();
        ctx.strokeStyle = line.color;
        ctx.lineWidth = Math.max(1, Math.floor(hr));
        ctx.setLineDash([4 * vr, 4 * vr]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this._paneHeight * vr);
        ctx.stroke();
        ctx.setLineDash([]);
        // Small kind label at the top of the pane
        ctx.font = `${10 * vr}px ui-monospace, monospace`;
        ctx.fillStyle = line.color;
        ctx.fillText(line.label, x + 3 * hr, 12 * vr);
        ctx.restore();
      }
    });
  }
}

class EventLinesPaneView implements IPrimitivePaneView {
  constructor(private _source: EventLinesPrimitive) {}

  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom';
  }

  renderer(): IPrimitivePaneRenderer | null {
    const chart = this._source.chart;
    if (!chart) return null;
    const timeScale = chart.timeScale();
    const lines: Array<{ x: number; color: string; label: string }> = [];
    for (const event of this._source.options.events) {
      const x = timeScale.timeToCoordinate(event.time as Time);
      if (x === null) continue;
      lines.push({
        x,
        color:
          event.kind === 'earnings'
            ? this._source.options.earningsColor
            : this._source.options.exDividendColor,
        label: KIND_LABEL[event.kind],
      });
    }
    if (lines.length === 0) return null;
    const paneHeight = chart.paneSize(0).height;
    return new EventLinesRenderer(lines, paneHeight);
  }
}

/**
 * Series primitive drawing vertical dashed lines at upcoming event dates
 * (E = earnings, D = ex-dividend) on the main price pane.
 */
export class EventLinesPrimitive implements ISeriesPrimitive<Time> {
  private _paneViews: EventLinesPaneView[];
  private _chart: SeriesAttachedParameter<Time>['chart'] | null = null;

  constructor(public options: EventLinesOptions) {
    this._paneViews = [new EventLinesPaneView(this)];
  }

  get chart() {
    return this._chart;
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
  }

  detached(): void {
    this._chart = null;
  }

  updateAllViews(): void {
    // Pane views read live chart state in renderer(); nothing to precompute.
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews;
  }
}
