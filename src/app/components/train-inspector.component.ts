import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import { Station, StopKind, Train, TrainStop } from '../types/timetable';
import { formatDuration, formatTime } from '../utils/time';

@Component({
  selector: 'app-train-inspector',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputNumberModule, SelectModule, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel inspector" *ngIf="train; else noTrain">
      <header class="panel__header">
        <div>
          <span class="eyebrow">运行线参数</span>
          <h2>{{ train.number }}</h2>
        </div>
        <span class="train-category" [style.background]="train.color">{{ train.category }}</span>
      </header>
      <div class="train-facts">
        <div><small>方向</small><strong>{{ train.direction === 'up' ? '上行' : '下行' }}</strong></div>
        <div><small>始发</small><strong>{{ formatTime(train.stops[0]?.departure || 0) }}</strong></div>
        <div><small>终到</small><strong>{{ formatTime(train.stops[train.stops.length - 1]?.arrival || 0) }}</strong></div>
        <div><small>全程</small><strong>{{ duration }}</strong></div>
      </div>
      <div class="inspector__section">
        <div class="section-title">
          <strong>逐站时刻与作业</strong>
          <span>{{ train.stops.length }} 站</span>
        </div>
        <div class="stop-list">
          <article class="stop-row" *ngFor="let stop of train.stops; let index = index">
            <div class="stop-row__station">
              <i></i>
              <div>
                <strong>{{ stationMap[stop.stationId]?.name || stop.stationId }}</strong>
                <small>{{ stop.trackId.split('-').pop() }}道 · {{ stop.kind }}</small>
              </div>
            </div>
            <div class="stop-row__times">
              <span>{{ formatTime(stop.arrival) }}</span>
              <span class="arrow">→</span>
              <span>{{ formatTime(stop.departure) }}</span>
            </div>
            <p-select
              [options]="stopKinds"
              [(ngModel)]="stop.kind"
              optionLabel="label"
              optionValue="value"
              (ngModelChange)="changeKind(stop, $event)"
              size="small"
              [ariaLabel]="'设置 ' + (stationMap[stop.stationId]?.name || '') + ' 作业方式'"
            ></p-select>
            <p-inputNumber
              [(ngModel)]="stop.departure"
              [min]="stop.arrival"
              [max]="stop.arrival + 60"
              [showButtons]="true"
              buttonLayout="horizontal"
              [step]="1"
              (ngModelChange)="changeDeparture(stop, $event)"
              size="small"
              [ariaLabel]="'调整停站分钟'"
            ></p-inputNumber>
          </article>
        </div>
      </div>
      <footer class="inspector__footer">
        <p-button
          icon="pi pi-arrow-left"
          label="提前 2 分"
          severity="secondary"
          size="small"
          (onClick)="shift.emit(-2)"
        ></p-button>
        <p-button
          icon="pi pi-arrow-right"
          label="推后 2 分"
          size="small"
          (onClick)="shift.emit(2)"
        ></p-button>
      </footer>
    </section>
    <ng-template #noTrain>
      <section class="panel empty-panel">
        <i class="pi pi-chart-line"></i>
        <h3>选择一条运行线</h3>
        <p>在运行图中点击列车，随后可精细调整停站和股道。</p>
      </section>
    </ng-template>
  `,
  styles: [
    `
      .inspector {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }

      .panel__header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: 16px 16px 12px;
        border-bottom: 1px solid #e5e9ef;
      }

      .eyebrow,
      .section-title span,
      small {
        color: #738094;
        font-size: 11px;
      }

      h2 {
        margin: 3px 0 0;
        color: #102b46;
        font-size: 22px;
      }

      .train-category {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        border-radius: 4px;
        color: #fff;
        font-size: 11px;
        font-weight: 700;
      }

      .train-facts {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 1px;
        background: #e8edf3;
      }

      .train-facts div {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 10px 8px;
        background: #fff;
      }

      .train-facts strong {
        color: #243a52;
        font-size: 12px;
      }

      .inspector__section {
        min-height: 0;
        flex: 1;
        overflow: auto;
        padding: 12px;
      }

      .section-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
        color: #30475f;
      }

      .stop-list {
        display: flex;
        flex-direction: column;
        gap: 7px;
      }

      .stop-row {
        display: grid;
        grid-template-columns: minmax(110px, 1.35fr) 80px minmax(82px, 0.8fr) 108px;
        gap: 7px;
        align-items: center;
        padding: 8px;
        border: 1px solid #e1e6ed;
        border-radius: 6px;
        background: #fbfcfd;
      }

      .stop-row__station {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .stop-row__station > i {
        width: 8px;
        height: 8px;
        flex: 0 0 auto;
        border: 2px solid #fff;
        border-radius: 50%;
        background: #2563eb;
        box-shadow: 0 0 0 1px #2563eb;
      }

      .stop-row__station div {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .stop-row__station strong {
        overflow: hidden;
        color: #263d55;
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .stop-row__times {
        display: flex;
        justify-content: space-between;
        color: #344b63;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
      }

      .arrow {
        color: #9aa5b4;
      }

      .inspector__footer {
        display: flex;
        gap: 8px;
        padding: 10px 12px;
        border-top: 1px solid #e5e9ef;
        background: #f8fafc;
      }

      .empty-panel {
        display: grid;
        place-items: center;
        align-content: center;
        height: 100%;
        padding: 24px;
        text-align: center;
      }

      .empty-panel i {
        color: #678199;
        font-size: 30px;
      }

      .empty-panel h3 {
        margin: 14px 0 6px;
        color: #2f475f;
      }

      .empty-panel p {
        max-width: 230px;
        margin: 0;
        color: #738094;
        font-size: 12px;
        line-height: 1.7;
      }
    `,
  ],
})
export class TrainInspectorComponent {
  @Input() train: Train | null = null;
  @Input() stations: Station[] = [];
  @Output() trainShifted = new EventEmitter<number>();
  @Output() stopUpdated = new EventEmitter<{ stationId: string; changes: Partial<TrainStop> }>();

  readonly stopKinds: Array<{ label: string; value: StopKind }> = [
    { label: '停站', value: 'stop' },
    { label: '通过', value: 'pass' },
    { label: '会让', value: 'meet' },
    { label: '越行', value: 'overtake' },
  ];

  get stationMap(): Record<string, Station> {
    return Object.fromEntries(this.stations.map((station) => [station.id, station]));
  }

  get duration(): string {
    if (!this.train || this.train.stops.length === 0) return '—';
    const first = this.train.stops[0].departure;
    const last = this.train.stops[this.train.stops.length - 1].arrival;
    return formatDuration(last - first);
  }

  get shift(): EventEmitter<number> {
    return this.trainShifted;
  }

  changeKind(stop: TrainStop, kind: StopKind): void {
    stop.kind = kind;
    this.stopUpdated.emit({ stationId: stop.stationId, changes: { kind } });
  }

  changeDeparture(stop: TrainStop, departure: number | null): void {
    if (departure == null) return;
    const safeDeparture = Math.max(stop.arrival, Math.min(stop.arrival + 60, departure));
    stop.departure = safeDeparture;
    this.stopUpdated.emit({ stationId: stop.stationId, changes: { departure: safeDeparture } });
  }

  formatTime(value: number): string {
    return formatTime(value);
  }
}
