import { createMockNetwork, normalizeImportedNetwork, shiftTrain } from '../src/app/utils/timetable-utils';
import {
  buildConflictCache,
  orderedConflicts,
  reconcilePlans,
  refreshPlanConflicts,
  refreshTrainConflicts,
} from '../src/app/utils/conflict-engine';
import { ConstructionPlan, TimetableConflict, TrainNetwork } from '../src/app/types/timetable';

declare const process: { exit(code: number): never };

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.error(`  ✘ ${message}`);
  }
}

// ---- 1. 容量互斥与排队 ----
const network = createMockNetwork();
const statuses = reconcilePlans(network);
const plan1 = statuses.find((s) => s.plan.id === 'PLAN-1');
const plan2 = statuses.find((s) => s.plan.id === 'PLAN-2');
assert(!!plan1?.active, 'PLAN-1（换轨施工）占用容量生效');
assert(!!plan2 && !plan2.active, 'PLAN-2 同向同时段排队');
assert(
  !!plan2 && plan2.blockedBy.some((p) => p.id === 'PLAN-1'),
  'PLAN-2 的互斥原因指向 PLAN-1',
);
assert(statuses.filter((s) => s.active).length === 3, '其余计划（PLAN-3/4）正常生效');

// 队列计划解除：错开 PLAN-2 时间后应转为生效
const shiftedNetwork: TrainNetwork = {
  ...network,
  constructionPlans: network.constructionPlans.map((p) =>
    p.id === 'PLAN-2' ? { ...p, start: 13 * 60, end: 14 * 60 } : p,
  ),
};
const statuses2 = reconcilePlans(shiftedNetwork);
assert(statuses2.find((s) => s.plan.id === 'PLAN-2')?.active === true, '时间错开后排队计划生效');

// ---- 2. 全量缓存 ----
const cache = buildConflictCache(network);
const all = orderedConflicts(cache);
const ids = all.map((c) => c.id);
assert(new Set(ids).size === ids.length, '冲突 id 唯一');
assert(all.some((c) => c.type === 'plan-overlap'), '生成了计划互斥记录');
assert(all.some((c) => c.type === 'construction'), '生成了施工限速影响记录');
const overlapId = ids.find((id) => id.startsWith('plan-overlap:PLAN-2:PLAN-1'));
assert(!!overlapId, '互斥记录 id 为 plan-overlap:PLAN-2:PLAN-1');
const constructionRecord = all.find((c) => c.type === 'construction');
assert(!!constructionRecord?.planId, '施工记录带有 planId，可反查影响哪份计划');
assert(constructionRecord!.trainIds.length === 1, '施工记录标注被影响的单趟列车');

// ---- 3. 运行线变化：只失效相关记录，其余保留（同对象引用 & 同顺序） ----
const unrelatedBefore = all.filter((c) => !c.trainIds.includes('T1') && c.type !== 'plan-overlap' && c.type !== 'construction');
const moved: TrainNetwork = {
  ...network,
  trains: network.trains.map((t) => (t.id === 'T1' ? shiftTrain(t, 3) : t)),
};
const cacheAfterTrain = refreshTrainConflicts(cache, moved, new Set(['T1']));
const afterTrain = orderedConflicts(cacheAfterTrain);
const preserved = unrelatedBefore.every((c) => cacheAfterTrain.byId[c.id] === c);
assert(preserved, '移动 T1 后，与 T1 无关的列车间冲突记录对象原样保留');
assert(cacheAfterTrain.order.includes(overlapId!), '移动列车后计划互斥记录照旧保留');
// 无关的施工记录对象应保持引用
const otherConstruction = all.find((c) => c.type === 'construction' && c.trainIds[0] !== 'T1');
if (otherConstruction) {
  assert(cacheAfterTrain.byId[otherConstruction.id] === otherConstruction, '其他列车的施工影响记录未重算');
}

// ---- 4. 施工计划变化：只重算 plan 衍生记录，列车间冲突保留 ----
const trainConflictSample = all.find((c) => c.type === 'headway' || c.type === 'track' || c.type === 'overtake');
const cacheAfterPlan = refreshPlanConflicts(cache, shiftedNetwork);
if (trainConflictSample) {
  assert(
    cacheAfterPlan.byId[trainConflictSample.id] === trainConflictSample,
    '计划变化后 headway/track/overtake 记录对象原样保留',
  );
}
const afterPlan = orderedConflicts(cacheAfterPlan);
assert(!afterPlan.some((c) => c.id === overlapId), '互斥解除后排队记录消失');

// 新增一份计划，构造新的限速影响
const newPlan: ConstructionPlan = {
  id: 'PLAN-NEW',
  sectionId: network.sections[2].id,
  direction: 'down',
  start: 8 * 60,
  end: 18 * 60,
  speedLimitKmh: 30,
  note: '新增慢行',
};
const withNewPlan: TrainNetwork = { ...network, constructionPlans: [...network.constructionPlans, newPlan] };
const cacheAfterNewPlan = refreshPlanConflicts(cache, withNewPlan);
const afterNew = orderedConflicts(cacheAfterNewPlan);
assert(
  afterNew.some((c) => c.type === 'construction' && c.planId === 'PLAN-NEW'),
  '新计划立即产生对应的列车影响记录',
);
assert(
  cacheAfterNewPlan.byId[overlapId!] === cache.byId[overlapId!],
  '与既有互斥记录无关，旧互斥记录对象保留',
);

// ---- 5. 顺序稳定性：未受影响记录的相对顺序保持不变 ----
const orderOf = (list: TimetableConflict[]): string[] => list.map((x) => x.id);
const retainedIds = orderOf(all).filter(
  (id) => cacheAfterTrain.byId[id] && cache.byId[id] === cacheAfterTrain.byId[id],
);
const retainedInAfter = orderOf(afterTrain).filter((id) => retainedIds.includes(id));
assert(
  JSON.stringify(retainedIds) === JSON.stringify(retainedInAfter),
  '未受影响记录在列表中的相对顺序保持不变',
);

// ---- 6. 旧数据（缺少 constructionPlans 字段）继续可用 ----
const oldFile = {
  stations: network.stations,
  sections: network.sections,
  trains: network.trains.slice(0, 3),
};
const imported = normalizeImportedNetwork(oldFile, network);
assert(Array.isArray(imported.constructionPlans) && imported.constructionPlans.length === 0, '旧数据导入后 constructionPlans 兜底为空数组');
const cacheOld = buildConflictCache(imported);
assert(Array.isArray(orderedConflicts(cacheOld)), '旧数据可正常完成冲突分析');

// 导入导出往返：计划字段保留
const roundtrip = JSON.parse(JSON.stringify(network)) as TrainNetwork;
assert(Array.isArray(roundtrip.constructionPlans) && roundtrip.constructionPlans.length === 4, '导出 JSON 带上施工计划');

if (failures > 0) {
  console.error(`\n${failures} 项断言失败`);
  process.exit(1);
}
console.log('\n全部断言通过');
