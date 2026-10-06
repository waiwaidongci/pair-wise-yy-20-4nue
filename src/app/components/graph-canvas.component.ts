import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  RailSection,
  TimetableConflict,
  Train,
  TrainNetwork,
  TrainStop,
  ViewportState,
} from '../types/timetable';
import { formatTime } from '../utils/time';
import { computeConflicts, visibleTimeRange } from '../utils/timetable-utils';

interface Point {
  x: number;
  y: number;
  time: number;
  km: number;
}

@Component({
  selector: 'app-graph-canvas',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="canvas-shell" [class.canvas-shell--printing]="!!printSectionId">
      <canvas
        #canvas
        role="img"
        aria-label="列车运行图。可拖动运行线调整时刻，滚轮缩放，按住 Shift 拖动平移视图。"
        (pointerdown)="onPointerDown($event)"
        (pointermove)="onPointerMove($event)"
        (pointerup)="onPointerUp($event)"
        (pointercancel)="onPointerUp($event)"
        (wheel)="onWheel($event)"
        (contextmenu)="$event.preventDefault()"
      ></canvas>
      <div class="canvas-hint" *ngIf="!printSectionId">
        <i class="pi pi-mouse"></i>
        拖动运行线改点 · Shift 拖动平移 · 滚轮缩放
      </div>
      <div class="canvas-badge" *ngIf="dragDelta !== 0">
        {{ dragTrainNumber }} {{ dragDelta > 0 ? '+' : '' }}{{ dragDelta }} 分钟
      </div>
    </div>
  `,
  styles: [
    `
      :host,
      .canvas-shell {
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 520px;
      }

      canvas {
        display: block;
        width: 100%;
        height: 100%;
        cursor: crosshair;
        touch-action: none;
      }

      .canvas-shell--printing canvas {
        cursor: default;
      }

      .canvas-hint {
        position: absolute;
        right: 14px;
        bottom: 12px;
        display: flex;
        gap: 7px;
        align-items: center;
        padding: 7px 10px;
        border: 1px solid #d7dee8;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.92);
        color: #526175;
        font-size: 12px;
        pointer-events: none;
      }

      .canvas-badge {
        position: absolute;
        top: 14px;
        left: 106px;
        padding: 7px 12px;
        border-radius: 5px;
        background: #123a5f;
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        box-shadow: 0 6px 18px rgba(18, 58, 95, 0.2);
      }
    `,
  ],
})
export class GraphCanvasComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input({ required: true }) network!: TrainNetwork;
  @Input() trains: Train[] = [];
  @Input() conflicts: TimetableConflict[] = [];
  @Input() viewport: ViewportState = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
  @Input() selectedTrainId: string | null = null;
  @Input() batchSelection: string[] = [];
  @Input() printSectionId: string | null = null;

  @Output() trainSelected = new EventEmitter<string>();
  @Output() trainMoved = new EventEmitter<{ trainId: string; deltaMinutes: number }>();
  @Output() viewportChanged = new EventEmitter<Partial<ViewportState>>();
  @Output() batchToggled = new EventEmitter<string>();

  private resizeObserver?: ResizeObserver;
  private hitPoints = new Map<string, Point[]>();
  private draggingTrainId: string | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  dragDelta = 0;
  dragTrainNumber = '';
  private panning = false;
  private panStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 };
  private frameRequested = false;

  ngAfterViewInit(): void {
    this.resizeObserver = new ResizeObserver(() => this.requestDraw());
    this.resizeObserver.observe(this.canvasRef.nativeElement.parentElement ?? this.canvasRef.nativeElement);
    this.requestDraw();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['network'] || changes['trains'] || changes['conflicts'] || changes['viewport'] || changes['selectedTrainId']) {
      this.requestDraw();
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const pointX = event.clientX - rect.left;
    const pointY = event.clientY - rect.top;
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    const scaleX = this.clamp(this.viewport.scaleX * factor, 0.5, 5);
    const scaleY = this.clamp(this.viewport.scaleY * factor, 0.5, 4);
    const offsetX = pointX - (pointX - this.viewport.offsetX) * (scaleX / this.viewport.scaleX);
    const offsetY = pointY - (pointY - this.viewport.offsetY) * (scaleY / this.viewport.scaleY);
    this.viewportChanged.emit({ scaleX, scaleY, offsetX, offsetY });
  }

  onPointerDown(event: PointerEvent): void {
    if (this.printSectionId) return;
    this.canvasRef.nativeElement.setPointerCapture(event.pointerId);
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (event.button === 1 || event.shiftKey) {
      this.panning = true;
      this.panStart = {
        x: point.x,
        y: point.y,
        offsetX: this.viewport.offsetX,
        offsetY: this.viewport.offsetY,
      };
      return;
    }
    const hit = this.findHitTrain(point.x, point.y);
    if (!hit) return;
    this.trainSelected.emit(hit);
    if (event.altKey) {
      this.batchToggled.emit(hit);
      return;
    }
    this.draggingTrainId = hit;
    this.dragStartX = point.x;
    this.dragStartY = point.y;
    this.dragDelta = 0;
    this.dragTrainNumber = this.network.trains.find((train) => train.id === hit)?.number ?? '';
  }

  onPointerMove(event: PointerEvent): void {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (this.panning) {
      this.viewportChanged.emit({
        offsetX: this.panStart.offsetX + point.x - this.panStart.x,
        offsetY: this.panStart.offsetY + point.y - this.panStart.y,
      });
      return;
    }
    if (this.draggingTrainId) {
      const pixelsPerMinute = this.getPixelsPerMinute();
      this.dragDelta = Math.round(((point.x - this.dragStartX) / pixelsPerMinute) * 2) / 2;
      this.requestDraw();
    }
  }

  onPointerUp(event: PointerEvent): void {
    if (this.canvasRef.nativeElement.hasPointerCapture(event.pointerId)) {
      this.canvasRef.nativeElement.releasePointerCapture(event.pointerId);
    }
    if (this.panning) {
      this.panning = false;
      return;
    }
    if (this.draggingTrainId && Math.abs(this.dragDelta) > 0.01) {
      this.trainMoved.emit({ trainId: this.draggingTrainId, deltaMinutes: this.dragDelta });
    }
    this.draggingTrainId = null;
    this.dragDelta = 0;
    this.requestDraw();
  }

  requestDraw(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.draw();
    });
  }

  private draw(): void {
    const canvas = this.canvasRef.nativeElement;
    const parent = canvas.parentElement;
    if (!parent) return;
    const width = Math.max(480, parent.clientWidth);
    const height = Math.max(480, parent.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#fbfcfe';
    context.fillRect(0, 0, width, height);

    const geometry = this.getGeometry(width, height);
    this.drawGrid(context, geometry, width, height);
    this.drawConflicts(context, geometry);
    this.drawTrains(context, geometry);
    this.drawAxis(context, geometry, width, height);
  }

  private getGeometry(width: number, height: number): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    minTime: number;
    maxTime: number;
    minKm: number;
    maxKm: number;
  } {
    const [networkStart, networkEnd] = visibleTimeRange(this.network);
    let minTime = networkStart;
    let maxTime = networkEnd;
    let minKm = Math.min(...this.network.stations.map((station) => station.km));
    let maxKm = Math.max(...this.network.stations.map((station) => station.km));

    if (this.printSectionId) {
      const section = this.network.sections.find((candidate) => candidate.id === this.printSectionId);
      if (section) {
        const from = this.network.stations.find((station) => station.id === section.fromStationId);
        const to = this.network.stations.find((station) => station.id === section.toStationId);
        if (from && to) {
          minKm = Math.min(from.km, to.km) - 4;
          maxKm = Math.max(from.km, to.km) + 4;
          const times = this.network.trains.flatMap((train) => {
            const fromStop = train.stops.find((stop) => stop.stationId === from.id);
            const toStop = train.stops.find((stop) => stop.stationId === to.id);
            return fromStop && toStop ? [fromStop.departure, toStop.arrival] : [];
          });
          if (times.length > 0) {
            minTime = Math.min(...times) - 4;
            maxTime = Math.max(...times) + 4;
          }
        }
      }
    }

    return {
      left: this.printSectionId ? 78 : 94,
      top: this.printSectionId ? 54 : 48,
      right: width - 28,
      bottom: height - 30,
      minTime,
      maxTime,
      minKm,
      maxKm,
    };
  }

  private getPixelsPerMinute(): number {
    const canvas = this.canvasRef.nativeElement;
    const width = canvas.parentElement?.clientWidth ?? canvas.clientWidth;
    const geometry = this.getGeometry(width, canvas.parentElement?.clientHeight ?? canvas.clientHeight);
    return ((geometry.right - geometry.left) / (geometry.maxTime - geometry.minTime)) * this.viewport.scaleX;
  }

  private timeToX(time: number, geometry: ReturnType<GraphCanvasComponent['getGeometry']>): number {
    const base = (geometry.right - geometry.left) / (geometry.maxTime - geometry.minTime);
    return geometry.left + (time - geometry.minTime) * base * this.viewport.scaleX + this.viewport.offsetX;
  }

  private kmToY(km: number, geometry: ReturnType<GraphCanvasComponent['getGeometry']>): number {
    const base = (geometry.bottom - geometry.top) / (geometry.maxKm - geometry.minKm);
    return geometry.top + (km - geometry.minKm) * base * this.viewport.scaleY + this.viewport.offsetY;
  }

  private drawGrid(
    context: CanvasRenderingContext2D,
    geometry: ReturnType<GraphCanvasComponent['getGeometry']>,
    width: number,
    height: number,
  ): void {
    context.save();
    context.fillStyle = '#ffffff';
    context.fillRect(geometry.left, geometry.top, geometry.right - geometry.left, geometry.bottom - geometry.top);
    context.beginPath();
    context.rect(geometry.left, geometry.top, geometry.right - geometry.left, geometry.bottom - geometry.top);
    context.clip();

    const firstHour = Math.ceil(geometry.minTime / 60) * 60;
    for (let minute = firstHour; minute <= geometry.maxTime; minute += 60) {
      const x = this.timeToX(minute, geometry);
      context.strokeStyle = minute % 120 === 0 ? '#d4dce7' : '#e7ebf1';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, geometry.top);
      context.lineTo(x, geometry.bottom);
      context.stroke();
    }
    const firstHalfHour = Math.ceil(geometry.minTime / 30) * 30;
    for (let minute = firstHalfHour; minute <= geometry.maxTime; minute += 30) {
      if (minute % 60 === 0) continue;
      const x = this.timeToX(minute, geometry);
      context.strokeStyle = '#f1f3f6';
      context.beginPath();
      context.moveTo(x, geometry.top);
      context.lineTo(x, geometry.bottom);
      context.stroke();
    }

    this.network.stations.forEach((station) => {
      const y = this.kmToY(station.km, geometry);
      if (y < geometry.top - 40 || y > geometry.bottom + 40) return;
      context.strokeStyle = '#c7d0dc';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(geometry.left, y);
      context.lineTo(geometry.right, y);
      context.stroke();
      context.fillStyle = '#6a7788';
      context.font = '11px "Noto Sans SC", sans-serif';
      context.textAlign = 'right';
      context.fillText(`${station.km.toFixed(1)} km`, geometry.left - 9, y + 4);
      context.textAlign = 'left';
      context.fillStyle = '#20354b';
      context.font = '700 12px "Noto Sans SC", sans-serif';
      context.fillText(station.name, geometry.left + 7, y - 7);
      context.fillStyle = '#8a96a4';
      context.font = '10px "Noto Sans SC", sans-serif';
      context.fillText(
        station.tracks.map((track) => track.name).join(' / '),
        geometry.left + 7,
        y + 14,
      );
    });

    context.restore();
    context.strokeStyle = '#aeb8c5';
    context.strokeRect(geometry.left, geometry.top, geometry.right - geometry.left, geometry.bottom - geometry.top);

    context.fillStyle = '#657285';
    context.font = '11px "Noto Sans SC", sans-serif';
    context.textAlign = 'center';
    const startHour = Math.ceil(geometry.minTime / 60) * 60;
    for (let minute = startHour; minute <= geometry.maxTime; minute += 60) {
      const x = this.timeToX(minute, geometry);
      if (x >= geometry.left && x <= geometry.right) {
        context.fillText(formatTime(minute), x, height - 10);
      }
    }
    context.textAlign = 'left';
    context.fillStyle = '#46566a';
    context.font = '700 11px "Noto Sans SC", sans-serif';
    context.fillText('里程', 22, 22);
    context.fillText('时分', width - 46, 22);
  }

  private drawConflicts(
    context: CanvasRenderingContext2D,
    geometry: ReturnType<GraphCanvasComponent['getGeometry']>,
  ): void {
    context.save();
    context.beginPath();
    context.rect(geometry.left, geometry.top, geometry.right - geometry.left, geometry.bottom - geometry.top);
    context.clip();
    this.conflicts.slice(0, 160).forEach((conflict) => {
      const x1 = this.timeToX(conflict.timeRange.start, geometry);
      const x2 = this.timeToX(conflict.timeRange.end, geometry);
      let y1 = geometry.top;
      let y2 = geometry.bottom;
      if (conflict.sectionId) {
        const section = this.network.sections.find((item) => item.id === conflict.sectionId);
        if (section) {
          const from = this.network.stations.find((item) => item.id === section.fromStationId);
          const to = this.network.stations.find((item) => item.id === section.toStationId);
          if (from && to) {
            y1 = Math.min(this.kmToY(from.km, geometry), this.kmToY(to.km, geometry));
            y2 = Math.max(this.kmToY(from.km, geometry), this.kmToY(to.km, geometry));
          }
        }
      } else if (conflict.stationId) {
        const station = this.network.stations.find((item) => item.id === conflict.stationId);
        if (station) {
          const y = this.kmToY(station.km, geometry);
          y1 = y - 12;
          y2 = y + 12;
        }
      }
      const gradient = context.createLinearGradient(x1, 0, x2, 0);
      const color = conflict.severity === 'danger' ? 'rgba(202, 38, 48, 0.16)' : 'rgba(231, 135, 21, 0.13)';
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.5, color);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient;
      context.fillRect(x1, y1, Math.max(5, x2 - x1 + 16), Math.max(3, y2 - y1));
    });
    context.restore();
  }

  private drawTrains(
    context: CanvasRenderingContext2D,
    geometry: ReturnType<GraphCanvasComponent['getGeometry']>,
  ): void {
    this.hitPoints.clear();
    const segmentIndex = new Map<string, Array<{ train: Train; departure: number; arrival: number }>>();
    const stationMap = new Map(this.network.stations.map((station) => [station.id, station]));
    this.trains.forEach((train) => {
      const points = this.buildPoints(train, geometry);
      this.hitPoints.set(train.id, points);
      for (let index = 0; index < points.length - 1; index += 1) {
        const stop = train.stops[index];
        const next = train.stops[index + 1];
        if (!stop || !next) continue;
        const section = this.findSection(stop.stationId, next.stationId);
        if (!section) continue;
        const key = `${section.id}:${train.direction}`;
        const bucket = segmentIndex.get(key) ?? [];
        bucket.push({
          train,
          departure:
            train.id === this.draggingTrainId
              ? Math.min(stop.departure, next.arrival) + this.dragDelta
              : Math.min(stop.departure, next.arrival),
          arrival:
            train.id === this.draggingTrainId
              ? Math.max(stop.departure, next.arrival) + this.dragDelta
              : Math.max(stop.departure, next.arrival),
        });
        segmentIndex.set(key, bucket);
      }
    });

    context.save();
    context.beginPath();
    context.rect(geometry.left, geometry.top, geometry.right - geometry.left, geometry.bottom - geometry.top);
    context.clip();

    this.trains.forEach((train) => {
      const points = this.hitPoints.get(train.id) ?? [];
      const selected = train.id === this.selectedTrainId;
      const batchSelected = this.batchSelection.includes(train.id);
      const trainSegmentConflicts = new Set<string>();
      train.stops.slice(0, -1).forEach((stop, index) => {
        const next = train.stops[index + 1];
        if (!next) return;
        const section = this.findSection(stop.stationId, next.stationId);
        if (!section) return;
        const departure = Math.min(stop.departure, next.arrival) + (train.id === this.draggingTrainId ? this.dragDelta : 0);
        const peers = segmentIndex.get(`${section.id}:${train.direction}`) ?? [];
        if (peers.some((peer) => peer.train.id !== train.id && Math.abs(peer.departure - departure) < section.minHeadwayMin)) {
          trainSegmentConflicts.add(section.id);
        }
      });

      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.lineWidth = selected ? 3.4 : batchSelected ? 2.6 : 1.25;
      context.strokeStyle = selected ? '#071d33' : train.color;
      context.globalAlpha = selected ? 1 : 0.84;
      context.beginPath();
      points.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.stroke();

      train.stops.slice(0, -1).forEach((stop, index) => {
        const next = train.stops[index + 1];
        if (!next) return;
        const section = this.findSection(stop.stationId, next.stationId);
        if (!section || !trainSegmentConflicts.has(section.id)) return;
        const first = points[index];
        const second = points[index + 1];
        if (!first || !second) return;
        context.strokeStyle = '#d92d3f';
        context.lineWidth = selected ? 5.5 : 3.5;
        context.globalAlpha = 0.95;
        context.beginPath();
        context.moveTo(first.x, first.y);
        context.lineTo(second.x, second.y);
        context.stroke();
      });
    });

    const drawnLabels = new Set<string>();
    this.trains.forEach((train) => {
      if (!(train.id === this.selectedTrainId || this.batchSelection.includes(train.id))) return;
      const points = this.hitPoints.get(train.id) ?? [];
      const first = points[0];
      const last = points[points.length - 1];
      if (!first || !last) return;
      const anchor = train.direction === 'up' ? first : last;
      if (drawnLabels.has(train.number)) return;
      drawnLabels.add(train.number);
      context.fillStyle = '#fff';
      context.strokeStyle = selectedStroke(train.id === this.selectedTrainId);
      context.lineWidth = 1;
      const textWidth = context.measureText(train.number).width + 12;
      context.beginPath();
      context.roundRect(anchor.x + 6, anchor.y - 10, textWidth, 20, 4);
      context.fill();
      context.stroke();
      context.fillStyle = '#17324d';
      context.font = '700 11px "Noto Sans SC", sans-serif';
      context.fillText(train.number, anchor.x + 12, anchor.y + 4);
    });

    [this.selectedTrainId, ...this.batchSelection].filter(Boolean).forEach((trainId) => {
      const train = this.trains.find((candidate) => candidate.id === trainId);
      const points = train ? this.hitPoints.get(train.id) ?? [] : [];
      const anchor = train?.direction === 'down' ? points[points.length - 1] : points[0];
      if (!anchor || !train) return;
      context.fillStyle = train.id === this.selectedTrainId ? '#17324d' : '#0f766e';
      context.beginPath();
      context.arc(anchor.x, anchor.y, 4.5, 0, Math.PI * 2);
      context.fill();
    });

    context.restore();
  }

  private buildPoints(
    train: Train,
    geometry: ReturnType<GraphCanvasComponent['getGeometry']>,
  ): Point[] {
    const stationMap = new Map(this.network.stations.map((station) => [station.id, station]));
    const delta = train.id === this.draggingTrainId ? this.dragDelta : 0;
    const points: Point[] = [];
    train.stops.forEach((stop, index) => {
      const station = stationMap.get(stop.stationId);
      if (!station) return;
      const previous = train.stops[index - 1];
      const previousStation = previous ? stationMap.get(previous.stationId) : null;
      if (previousStation) {
        const arrivalPoint = {
          x: this.timeToX(stop.arrival + delta, geometry),
          y: this.kmToY(station.km, geometry),
          time: stop.arrival + delta,
          km: station.km,
        };
        points.push(arrivalPoint);
      } else {
        points.push({
          x: this.timeToX(stop.arrival + delta, geometry),
          y: this.kmToY(station.km, geometry),
          time: stop.arrival + delta,
          km: station.km,
        });
      }
      if (stop.kind !== 'pass' && Math.abs(stop.departure - stop.arrival) > 0.01) {
        points.push({
          x: this.timeToX(stop.departure + delta, geometry),
          y: this.kmToY(station.km, geometry),
          time: stop.departure + delta,
          km: station.km,
        });
      }
    });
    return points;
  }

  private drawAxis(
    context: CanvasRenderingContext2D,
    geometry: ReturnType<GraphCanvasComponent['getGeometry']>,
    width: number,
    height: number,
  ): void {
    if (!this.printSectionId) return;
    const section = this.network.sections.find((candidate) => candidate.id === this.printSectionId);
    if (!section) return;
    const from = this.network.stations.find((station) => station.id === section.fromStationId);
    const to = this.network.stations.find((station) => station.id === section.toStationId);
    context.fillStyle = '#17324d';
    context.font = '700 16px "Noto Sans SC", sans-serif';
    context.textAlign = 'left';
    context.fillText(`${from?.name ?? ''}—${to?.name ?? ''} 区间运行图`, geometry.left, 26);
    context.font = '11px "Noto Sans SC", sans-serif';
    context.textAlign = 'right';
    context.fillStyle = '#667085';
    context.fillText(`追踪间隔 ≥ ${section.minHeadwayMin} 分 · ${section.distanceKm.toFixed(1)} km`, width - 28, 26);
    context.textAlign = 'left';
    context.fillText('铁路调度运行图系统 · 打印件', 24, height - 9);
  }

  private findHitTrain(x: number, y: number): string | null {
    let bestId: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    this.hitPoints.forEach((points, trainId) => {
      for (let index = 0; index < points.length - 1; index += 1) {
        const distance = pointToSegmentDistance(x, y, points[index], points[index + 1]);
        if (distance <= 7 && distance < bestDistance) {
          bestId = trainId;
          bestDistance = distance;
        }
      }
    });
    return bestId;
  }

  private findSection(fromStationId: string, toStationId: string): RailSection | undefined {
    return this.network.sections.find(
      (section) =>
        (section.fromStationId === fromStationId && section.toStationId === toStationId) ||
        (section.toStationId === fromStationId && section.fromStationId === toStationId),
    );
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

function selectedStroke(selected: boolean): string {
  return selected ? '#17324d' : '#0f766e';
}

function pointToSegmentDistance(x: number, y: number, first: Point, second: Point): number {
  const deltaX = second.x - first.x;
  const deltaY = second.y - first.y;
  if (deltaX === 0 && deltaY === 0) return Math.hypot(x - first.x, y - first.y);
  const projection = Math.max(
    0,
    Math.min(1, ((x - first.x) * deltaX + (y - first.y) * deltaY) / (deltaX * deltaX + deltaY * deltaY)),
  );
  return Math.hypot(x - (first.x + projection * deltaX), y - (first.y + projection * deltaY));
}
