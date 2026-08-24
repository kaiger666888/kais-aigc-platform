/**
 * src/lib/__tests__/reviewBridge.test.ts — DEBT-02 尾斜杠回归锁 (61-02)
 *
 * 运行: cd /data/workspace/kais-aigc-platform && node --import tsx --test src/lib/__tests__/reviewBridge.test.ts
 *
 * Pitfall 2 (61-RESEARCH) 防假绿:注入 fetchImpl 捕获出站 URL 后断言**字面量**
 * (`/api/v1/reviews/?` 在场 + 裸 `/api/v1/reviews?` 无命中),而非「请求成功」——
 * 注入 fetch 天然不走真 307,只断言响应成功会在斜杠被删后依然恒绿。
 * baseUrl 用 http://mock-review 假主机,零真实网络调用(T-61-07)。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOpenReviewForSelection } from "../reviewBridge";

/** phaseToken 门放行:derivePhaseToken 取 leading "_" 前('p11a0' → 'p11a0')。 */
const mkParams = {
  projectId: 1,
  episodesId: 1,
  groupId: "g",
  winnerNodeId: "n",
  variantIndex: 1,
  winnerPhaseName: "p11a0",
};

/** 注入 fetch:记录出站 URL,按调用序吐出分页 body(零网络)。 */
const mkFetch = (capturedUrls: string[], pages: unknown[]): typeof fetch =>
  (async (url: unknown) => {
    capturedUrls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: pages.shift() }),
    } as unknown as Response;
  }) as unknown as typeof fetch;

const silentLogger = { info: () => {}, warn: () => {} };

test("列表 URL 带尾斜杠直连 (61-02/DEBT-02)", async () => {
  const urls: string[] = [];
  const pages = [{ items: [], next_cursor: null, has_more: false }];
  await resolveOpenReviewForSelection(mkParams, {
    baseUrl: "http://mock-review",
    fetchImpl: mkFetch(urls, pages),
    logger: silentLogger,
  });
  // 正断言:字面量 /api/v1/reviews/?(带斜杠直连,307 → Location 丢端口 → 404 链路消除)
  assert.equal(urls.length, 1, `应恰发一次列表请求,实际 ${urls.length}: ${JSON.stringify(urls)}`);
  assert.ok(
    urls[0].includes("/api/v1/reviews/?"),
    `URL 须含 /api/v1/reviews/?(61-02),实际: ${urls[0]}`,
  );
  // 反断言(Pitfall 2):裸 /api/v1/reviews? 无命中——删掉斜杠此行必红
  assert.ok(
    !/\/api\/v1\/reviews\?/.test(urls[0]),
    `URL 不得含无斜杠 /api/v1/reviews?,实际: ${urls[0]}`,
  );
});

test("分页第二跳 (next_cursor 跟进) 同样带斜杠", async () => {
  const urls: string[] = [];
  const pages = [
    { items: [], next_cursor: "c1", has_more: true },
    { items: [], next_cursor: null, has_more: false },
  ];
  await resolveOpenReviewForSelection(mkParams, {
    baseUrl: "http://mock-review",
    fetchImpl: mkFetch(urls, pages),
    logger: silentLogger,
  });
  assert.equal(urls.length, 2, `两页应恰两次列表请求,实际 ${urls.length}: ${JSON.stringify(urls)}`);
  assert.ok(
    urls.every((u) => u.includes("/api/v1/reviews/?")),
    `每一跳 URL 都须带尾斜杠,实际: ${JSON.stringify(urls)}`,
  );
  assert.ok(
    urls[1].includes("cursor=c1"),
    `第二跳须透传 next_cursor(querystring cursor=c1),实际: ${urls[1]}`,
  );
});

test("winnerPhaseName 为空 → 不发列表请求(回归网)", async () => {
  const urls: string[] = [];
  await resolveOpenReviewForSelection({ ...mkParams, winnerPhaseName: null }, {
    baseUrl: "http://mock-review",
    fetchImpl: mkFetch(urls, [{ items: [], next_cursor: null, has_more: false }]),
    logger: silentLogger,
  });
  assert.equal(urls.length, 0, `phaseToken 门应在列表请求前 skip,实际出站 ${urls.length}: ${JSON.stringify(urls)}`);
});
