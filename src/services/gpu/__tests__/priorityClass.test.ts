/**
 * 优先级类模型单测 — M1 双卡调度 (docs/gpu-scheduling-architecture.md §2.1)。
 *
 * 运行方式 (仿 gpuRoles.test.ts, node:test + tsx; 仓库无 vitest):
 *   node --import tsx --test src/services/gpu/__tests__/priorityClass.test.ts
 *
 * 隔离策略: validatePriorityOptions 是纯函数 (零 IO 零副作用), 直接断言输入→输出。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PRIORITY_CLASS,
  DEFAULT_DEV_TTL_MIN,
  MAX_DEV_TTL_MIN,
  validatePriorityOptions,
  isDevClass,
  isProdClass,
  isPriorityClass,
} from "../priority";

describe("优先级类模型 — 缺省折叠 (红线: 默认参数 = 今日行为)", () => {
  it("无任何字段 → prod-P3 / force=false / ttlMin=null", () => {
    const r = validatePriorityOptions({});
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.value.priorityClass, "prod-P3");
      assert.equal(r.value.force, false);
      assert.equal(r.value.ttlMin, null);
    }
    assert.equal(DEFAULT_PRIORITY_CLASS, "prod-P3");
  });

  it("仅显式 prod 类 → 同缺省语义 (无 TTL)", () => {
    for (const pc of ["prod-P2", "prod-P3"] as const) {
      const r = validatePriorityOptions({ priorityClass: pc });
      assert.ok(r.ok);
      if (r.ok) {
        assert.equal(r.value.priorityClass, pc);
        assert.equal(r.value.ttlMin, null);
        assert.equal(r.value.force, false);
      }
    }
  });
});

describe("优先级类模型 — force 非法组合拒绝 (§2.1: 仅 dev-P0 可 --force)", () => {
  it("force+dev-P0 合法", () => {
    const r = validatePriorityOptions({ priorityClass: "dev-P0", force: true });
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.value.force, true);
  });

  it("force+其他全部类拒绝 (dev-P1/prod-P2/prod-P3 及缺省)", () => {
    for (const pc of ["dev-P1", "prod-P2", "prod-P3"] as const) {
      const r = validatePriorityOptions({ priorityClass: pc, force: true });
      assert.ok(!r.ok, `force+${pc} 应拒绝`);
      if (!r.ok) assert.match(r.reason, /force 仅 dev-P0 合法/);
    }
    // 缺省 (prod-P3) + force 也拒绝
    const r = validatePriorityOptions({ force: true });
    assert.ok(!r.ok);
  });

  it("force:false 显式传 prod 类合法 (非 true 即非 force)", () => {
    const r = validatePriorityOptions({ priorityClass: "prod-P2", force: false });
    assert.ok(r.ok);
  });
});

describe("优先级类模型 — ttlMin 校验 (§2.3: 仅 dev 类, 默认 120, 上限 480)", () => {
  it("dev 类不传 ttlMin → 缺省 120", () => {
    for (const pc of ["dev-P0", "dev-P1"] as const) {
      const r = validatePriorityOptions({ priorityClass: pc });
      assert.ok(r.ok);
      if (r.ok) assert.equal(r.value.ttlMin, DEFAULT_DEV_TTL_MIN);
    }
  });

  it("dev 类显式 ttlMin 生效 (1 与 480 边界均合法)", () => {
    const lo = validatePriorityOptions({ priorityClass: "dev-P1", ttlMin: 1 });
    assert.ok(lo.ok && lo.value.ttlMin === 1);
    const hi = validatePriorityOptions({ priorityClass: "dev-P0", ttlMin: MAX_DEV_TTL_MIN });
    assert.ok(hi.ok && hi.value.ttlMin === MAX_DEV_TTL_MIN);
  });

  it("prod 类传 ttlMin → 拒绝 (prod 任务不做占用 TTL)", () => {
    const r = validatePriorityOptions({ priorityClass: "prod-P2", ttlMin: 30 });
    assert.ok(!r.ok);
    if (!r.ok) assert.match(r.reason, /ttlMin 仅 dev 类合法/);
  });

  it("ttlMin 非法值拒绝 (0 / 负数 / NaN / >480 / 非数值)", () => {
    for (const bad of [0, -5, NaN, Infinity, MAX_DEV_TTL_MIN + 1, "30", null]) {
      const r = validatePriorityOptions({ priorityClass: "dev-P0", ttlMin: bad as number });
      assert.ok(!r.ok, `ttlMin=${String(bad)} 应拒绝`);
    }
  });
});

describe("优先级类模型 — 类值合法性", () => {
  it("非法 priorityClass 字符串拒绝", () => {
    const r = validatePriorityOptions({ priorityClass: "dev-P9" as never });
    assert.ok(!r.ok);
    if (!r.ok) assert.match(r.reason, /priorityClass 非法/);
  });

  it("isPriorityClass/isDevClass/isProdClass 真值表", () => {
    assert.deepEqual(
      (["dev-P0", "dev-P1", "prod-P2", "prod-P3"] as const).map(isPriorityClass),
      [true, true, true, true],
    );
    assert.equal(isPriorityClass("dev-P9"), false);
    assert.equal(isPriorityClass(42), false);
    assert.deepEqual(
      (["dev-P0", "dev-P1"] as const).map(isDevClass),
      [true, true],
    );
    assert.deepEqual(
      (["prod-P2", "prod-P3"] as const).map(isProdClass),
      [true, true],
    );
    assert.equal(isDevClass("prod-P3"), false);
    assert.equal(isProdClass("dev-P0"), false);
  });
});
