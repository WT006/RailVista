/**
 * 全局搜索 HTTP 路由（挂 /api/search）。
 *
 *   GET /?q=xxx      聚合搜索：车次 / 走廊 / 编号公路 / 景点 / 路书 五类命中
 *                     景点附带 corridorNames（关联铁路线）与 roadbookNames（关联路书）
 *
 * q 为空或缺失时返回空结果（不是 400）——命令面板输入为空稳定兜底。
 */
import { Hono } from 'hono';
import { searchAll } from '../services/searchIndex.js';

export const searchRoute = new Hono();

searchRoute.get('/', (c) => {
  const q = c.req.query('q') ?? '';
  return c.json({ ok: true, data: searchAll(q) });
});