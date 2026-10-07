import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TagModule } from 'primeng/tag';
import {
  ConstructionPlan,
  RailSection,
  Station,
  TrainDirection,
} from '../types/timetable';
import { directionLabel, PlanStatus } from '../utils/conflict-engine';
import { formatTime, minutesFromClock } from '../utils/time';

@Component({
  selector: 'app-construction-planner',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    InputTextModule,
    SelectModule,
    TagModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      header="区间施工（临时限速）计划"
      [visible]="visible"
      (visibleChange)="visibleChange.emit($event)"
      [modal]="true"
      [style]="{ width: '860px' }"
      [draggable]="false"
    >
      <div class="planner">
        <p class="planner__intro">
          每份计划登记区间、方向、起止时刻与限速值。同一区间同一方向同一时段只有
          <strong>1 份</strong>计划容量，超出的计划自动排队并列出互斥原因。
        </p>

        <form class="planner__form" (ngSubmit)="submitDraft()">
          <p-select
            [options]="sectionOptions"
            [(ngModel)]="draft.sectionId"
            name="draft-section"
            optionLabel="label"
            optionValue="value"
            placeholder="选择区间"
            [style]="{ minWidth: '190px' }"
          ></p-select>
          <p-select
            [options]="directionOptions"
            [(ngModel)]="draft.direction"
            name="draft-direction"
            optionLabel="label"
            optionValue="value"
            [style]="{ width: '104px' }"
          ></p-select>
          <label class="time-field">
            <span>起</span>
            <input type="time" [(ngModel)]="draft.startText" name="draft-start" required />
          </label>
          <label class="time-field">
            <span>止</span>
            <input type="time" [(ngModel)]="draft.endText" name="draft-end" required />
          </label>
          <p-inputNumber
            [(ngModel)]="draft.speedLimitKmh"
            name="draft-speed"
            [min]="5"
            [max]="400"
            [step]="5"
            suffix=" km/h"
            [style]="{ width: '128px' }"
          ></p-inputNumber>
          <input
            pInputText
            [(ngModel)]="draft.note"
            name="draft-note"
            placeholder="施工内容（选填）"
            class="note-input"
          />
          <p-button type="submit" icon="pi pi-plus" label="登记计划" size="small"></p-button>
        </form>
        <p class="planner__error" *ngIf="draftError">{{ draftError }}</p>

        <div class="planner__table-wrap">
          <table class="planner__table">
            <thead>
              <tr>
                <th>状态</th>
                <th>区间 / 方向</th>
                <th>起止时刻</th>
                <th>限速</th>
                <th>施工内容</th>
                <th>互斥原因</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <ng-container *ngIf="statuses.length; else emptyRow">
                <tr *ngFor="let status of statuses" [class.row--queued]="!status.active">
                  <td>
                    <p-tag
                      [value]="status.active ? '生效中' : '排队中'"
                      [severity]="status.active ? 'success' : 'warn'"
                    ></p-tag>
                  </td>
                  <td>
                    <select
                      [ngModel]="status.plan.sectionId"
                      (ngModelChange)="update(status.plan.id, { sectionId: $event })"
                      [ngModelOptions]="{ standalone: true }"
                    >
                      <option *ngFor="let option of sectionOptions" [value]="option.value">
                        {{ option.label }}
                      </option>
                    </select>
                    <select
                      [ngModel]="status.plan.direction"
                      (ngModelChange)="update(status.plan.id, { direction: $event })"
                      [ngModelOptions]="{ standalone: true }"
                    >
                      <option value="up">上行</option>
                      <option value="down">下行</option>
                    </select>
                  </td>
                  <td class="time-cell">
                    <input
                      type="time"
                      [ngModel]="toClock(status.plan.start)"
                      (ngModelChange)="update(status.plan.id, { start: minutesFromClock($event) })"
                      [ngModelOptions]="{ standalone: true }"
                    />
                    <span>–</span>
                    <input
                      type="time"
                      [ngModel]="toClock(status.plan.end)"
                      (ngModelChange)="update(status.plan.id, { end: minutesFromClock($event) })"
                      [ngModelOptions]="{ standalone: true }"
                    />
                  </td>
                  <td>
                    <p-inputNumber
                      [ngModel]="status.plan.speedLimitKmh"
                      (ngModelChange)="update(status.plan.id, { speedLimitKmh: $event ?? 0 })"
                      [ngModelOptions]="{ standalone: true }"
                      [min]="5"
                      [max]="400"
                      [step]="5"
                      suffix=" km/h"
                      size="small"
                    ></p-inputNumber>
                  </td>
                  <td>
                    <input
                      pInputText
                      [ngModel]="status.plan.note ?? ''"
                      (ngModelChange)="update(status.plan.id, { note: $event })"
                      [ngModelOptions]="{ standalone: true }"
                      placeholder="—"
                      class="note-edit"
                    />
                  </td>
                  <td class="mutex-cell">
                    <ng-container *ngIf="!status.active">
                      <div *ngFor="let holder of status.blockedBy" class="mutex-reason">
                        <i class="pi pi-ban"></i>
                        与 {{ formatTime(holder.start) }}–{{ formatTime(holder.end) }}
                        {{ directionLabel(holder.direction) }}线限速 {{ holder.speedLimitKmh }} km/h 时段重叠
                      </div>
                      <div *ngIf="status.blockedBy.length === 0" class="mutex-reason mutex-reason--soft">
                        <i class="pi pi-hourglass"></i>
                        容量已被占用，等待既有计划结束
                      </div>
                    </ng-container>
                    <span *ngIf="status.active" class="ok-text">容量空闲</span>
                  </td>
                  <td>
                    <p-button
                      icon="pi pi-trash"
                      severity="danger"
                      [text]="true"
                      pTooltip="删除计划"
                      (onClick)="remove(status.plan.id)"
                    ></p-button>
                  </td>
                </tr>
              </ng-container>
              <ng-template #emptyRow>
                <tr>
                  <td colspan="7" class="empty-cell">尚未登记施工计划，区间放车仍按口头确认。</td>
                </tr>
              </ng-template>
            </tbody>
          </table>
        </div>
      </div>
    </p-dialog>
  `,
  styles: [
    `
      .planner__intro {
        margin: 0 0 12px;
        color: #5d6d80;
        font-size: 12px;
        line-height: 1.7;
      }

      .planner__form {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        padding: 12px;
        border: 1px solid #d8e0e9;
        border-radius: 7px;
        background: #f7fafc;
      }

      .time-field {
        display: inline-flex;
        gap: 5px;
        align-items: center;
        color: #667386;
        font-size: 11px;
      }

      .time-field input,
      .time-cell input,
      td select {
        padding: 5px 7px;
        border: 1px solid #cdd7e2;
        border-radius: 5px;
        background: #fff;
        color: #243a52;
        font-size: 12px;
      }

      .note-input {
        width: 170px;
      }

      .planner__error {
        margin: 7px 0 0;
        color: #c92734;
        font-size: 11px;
      }

      .planner__table-wrap {
        margin-top: 14px;
        max-height: 380px;
        overflow: auto;
        border: 1px solid #dde4ec;
        border-radius: 7px;
      }

      .planner__table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
      }

      .planner__table th {
        position: sticky;
        top: 0;
        padding: 8px 9px;
        border-bottom: 1px solid #d8e0e9;
        background: #f4f7fa;
        color: #5a6a7e;
        font-weight: 700;
        text-align: left;
        white-space: nowrap;
      }

      .planner__table td {
        padding: 7px 9px;
        border-bottom: 1px solid #e9edf2;
        vertical-align: middle;
      }

      .planner__table td select + select {
        margin-left: 5px;
      }

      .row--queued {
        background: #fffaeb;
      }

      .time-cell {
        display: flex;
        gap: 4px;
        align-items: center;
        white-space: nowrap;
        color: #8a96a4;
      }

      .mutex-cell {
        min-width: 210px;
        color: #92400e;
        line-height: 1.5;
      }

      .mutex-reason {
        display: flex;
        gap: 5px;
        align-items: flex-start;
      }

      .mutex-reason i {
        margin-top: 2px;
      }

      .mutex-reason--soft {
        color: #a16207;
      }

      .ok-text {
        color: #138a63;
      }

      .note-edit {
        width: 120px;
      }

      .empty-cell {
        padding: 26px !important;
        color: #8a96a4;
        text-align: center;
      }
    `,
  ],
})
export class ConstructionPlannerComponent {
  @Input() visible = false;
  @Input() stations: Station[] = [];
  @Input() sections: RailSection[] = [];
  @Input() statuses: PlanStatus[] = [];
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() planAdded = new EventEmitter<ConstructionPlan>();
  @Output() planUpdated = new EventEmitter<{ planId: string; changes: Partial<ConstructionPlan> }>();
  @Output() planRemoved = new EventEmitter<string>();

  readonly directionOptions: Array<{ label: string; value: TrainDirection }> = [
    { label: '上行', value: 'up' },
    { label: '下行', value: 'down' },
  ];

  draft = {
    sectionId: '',
    direction: 'up' as TrainDirection,
    startText: '09:00',
    endText: '11:00',
    speedLimitKmh: 80,
    note: '',
  };
  draftError = '';

  get sectionOptions(): Array<{ label: string; value: string }> {
    const stationName = (id: string) => this.stations.find((station) => station.id === id)?.name ?? id;
    return this.sections.map((section) => ({
      label: `${section.id} ${stationName(section.fromStationId)}—${stationName(section.toStationId)}`,
      value: section.id,
    }));
  }

  submitDraft(): void {
    this.draftError = '';
    const start = minutesFromClock(this.draft.startText);
    const end = minutesFromClock(this.draft.endText);
    if (!this.draft.sectionId) {
      this.draftError = '请先选择施工区间。';
      return;
    }
    if (end <= start) {
      this.draftError = '结束时刻必须晚于开始时刻。';
      return;
    }
    if (!this.draft.speedLimitKmh || this.draft.speedLimitKmh <= 0) {
      this.draftError = '请填写有效的限速值。';
      return;
    }
    this.planAdded.emit({
      id: `PLAN-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      sectionId: this.draft.sectionId,
      direction: this.draft.direction,
      start,
      end,
      speedLimitKmh: this.draft.speedLimitKmh,
      note: this.draft.note.trim() || undefined,
    });
    this.draft.note = '';
  }

  update(planId: string, changes: Partial<ConstructionPlan>): void {
    this.planUpdated.emit({ planId, changes });
  }

  remove(planId: string): void {
    this.planRemoved.emit(planId);
  }

  toClock(minutes: number): string {
    return formatTime(minutes);
  }

  minutesFromClock(value: string): number {
    return minutesFromClock(value);
  }

  formatTime(value: number): string {
    return formatTime(value);
  }

  directionLabel(direction: TrainDirection): string {
    return directionLabel(direction);
  }
}
