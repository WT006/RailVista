import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTicketConfig, makeTicketSerial, type TicketKind } from './index.js';

describe('ticket/makeTicketSerial', () => {
  it('前缀按票种映射 R / D / F', () => {
    assert.equal(makeTicketSerial('railway', '20261003', 7), 'R-20261003-0007');
    assert.equal(makeTicketSerial('drive', '20261003', 7), 'D-20261003-0007');
    assert.equal(makeTicketSerial('flight', '20261003', 7), 'F-20261003-0007');
  });

  it('纯函数：同输入必同输出（草稿反复落盘票号不得漂移）', () => {
    const a = makeTicketSerial('railway', '20261003', 12);
    const b = makeTicketSerial('railway', '20261003', 12);
    assert.equal(a, b);
  });

  it('容忍日期里的分隔符', () => {
    assert.equal(makeTicketSerial('railway', '2026-10-03', 1), 'R-20261003-0001');
    assert.equal(makeTicketSerial('railway', '2026/10/03', 1), 'R-20261003-0001');
  });

  it('日期非法时回落到全0而非抛错（编辑器允许临时空输入）', () => {
    assert.equal(makeTicketSerial('railway', '', 1), 'R-00000000-0001');
    assert.equal(makeTicketSerial('railway', 'abc', 1), 'R-00000000-0001');
  });

  it('序号下限为 1 且补齐 4 位', () => {
    assert.equal(makeTicketSerial('railway', '20261003', 0), 'R-20261003-0001');
    assert.equal(makeTicketSerial('railway', '20261003', -5), 'R-20261003-0001');
    assert.equal(makeTicketSerial('railway', '20261003', 12345), 'R-20261003-12345');
  });
});

describe('ticket/createTicketConfig', () => {
  const kinds: TicketKind[] = ['railway', 'drive', 'flight'];

  it('三种票种都能开出合法票面', () => {
    for (const kind of kinds) {
      const c = createTicketConfig(kind);
      assert.equal(c.kind, kind);
      assert.ok(c.id.length > 0, 'id 必须非空');
      assert.equal(c.route.ends.length, 2);
      assert.ok(c.route.ends[0]!.name.length > 0);
      assert.ok(c.route.ends[1]!.name.length > 0);
      assert.ok(c.title.length > 0);
      assert.ok(c.serial.startsWith(c.serial[0]!));
    }
  });

  it('徽记随票种切换', () => {
    assert.equal(createTicketConfig('railway').seal.emblem, 'rail');
    assert.equal(createTicketConfig('drive').seal.emblem, 'road');
    assert.equal(createTicketConfig('flight').seal.emblem, 'air');
  });

  it('主题 id 与票种匹配（前端 themesForKind 按 kind 过滤，串了会空列表）', () => {
    assert.equal(createTicketConfig('railway').background.theme, 'rail-xuanlan');
    assert.equal(createTicketConfig('drive').background.theme, 'drive-dusk');
    assert.equal(createTicketConfig('flight').background.theme, 'flight-night');
  });

  it('每次调用都是独立对象（改一处不污染另一处）', () => {
    const a = createTicketConfig('railway');
    const b = createTicketConfig('railway');
    a.stats[0]!.value = 'X';
    a.tags.push({ text: '额外' });
    a.route.ends[0]!.name = '改名';
    assert.notEqual(b.stats[0]!.value, 'X');
    assert.ok(!b.tags.some((t) => t.text === '额外'));
    assert.notEqual(b.route.ends[0]!.name, '改名');
  });

  it('背景图初始为空、叠加强度在合法区间', () => {
    const c = createTicketConfig('railway');
    assert.equal(c.background.imageUrl, undefined);
    assert.ok(c.background.opacity >= 0 && c.background.opacity <= 0.6);
  });

  it('飞行票之外的 airline 留空（组件按 kind === flight 才渲染航司区）', () => {
    assert.equal(createTicketConfig('railway').airline, undefined);
    assert.equal(createTicketConfig('drive').airline, undefined);
  });

  it('可 JSON 往返（草稿落盘的前提）', () => {
    const c = createTicketConfig('flight');
    const round = JSON.parse(JSON.stringify(c));
    assert.deepEqual(round, c);
  });
});