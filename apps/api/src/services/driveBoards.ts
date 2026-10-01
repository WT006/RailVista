/**
 * 万里路书 · 全国公路旅游网 —— 统一榜单服务（PRD §7）。
 *
 * 关键设计：榜单条目不是独立数据，是 roadKeys[] 指向路网的「引用 + 精选」。
 *   - 点榜单里的一条 → 复用主功能沿程页（C2 整条公路 / C1 OD 兜底）
 *   - 一条路可同时出现在多个榜单（alsoIn 交叉推荐）
 *   - 加一个新榜单 = 加一个 JSON，零代码
 *
 * 纪律（与 driveRoutes.ts 一致）：列表只读 _index.json，详情按 id 读单文件，
 * 禁止运行时目录遍历。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RankingBoard, RankingBoardSummary, RankingItem } from '@railvista/shared';
import { getRoadEntry } from './roadNetwork.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOARDS_DIR = join(__dirname, '../../../../data/roads/boards');

interface BoardsIndex {
  version: number;
  updated: string;
  boards: RankingBoardSummary[];
}

let indexCache: { mtime: number; index: BoardsIndex } | null = null;

function readBoardsIndex(): BoardsIndex {
  const path = join(BOARDS_DIR, '_index.json');
  if (!existsSync(path)) return { version: 1, updated: '', boards: [] };
  try {
    if (indexCache) return indexCache.index;
    const index = JSON.parse(readFileSync(path, 'utf8')) as BoardsIndex;
    indexCache = { mtime: 0, index };
    return index;
  } catch {
    return { version: 1, updated: '', boards: [] };
  }
}

/** 榜单列表（从属页；摘要不含 items） */
export function listBoards(): { boards: RankingBoardSummary[]; updated: string } {
  const idx = readBoardsIndex();
  return { boards: idx.boards, updated: idx.updated };
}

/** 单个榜单详情（items 全量；roadKeys 几何可用性由 itemHasGeometry 现算） */
export function getBoard(boardId: string): (RankingBoard & { items: RankingItem[] }) | null {
  const path = join(BOARDS_DIR, `${boardId}.json`);
  if (!existsSync(path)) return null;
  try {
    const board = JSON.parse(readFileSync(path, 'utf8')) as RankingBoard;
    return board;
  } catch {
    return null;
  }
}

/** 条目可通行性：任一 roadKey 有 L1 几何即可走 C2 整条公路入口 */
export function itemHasGeometry(item: RankingItem): boolean {
  return item.roadKeys.some((k) => getRoadEntry(k)?.hasGeom);
}

/** 交叉索引：这条路还出现在哪些榜（读取全部榜单文件的 roadKeys，进程内只算一次） */
let crossIndex: Map<string, string[]> | null = null;

export function boardsAlsoIn(roadKey: string): string[] {
  if (!crossIndex) {
    crossIndex = new Map();
    for (const b of readBoardsIndex().boards) {
      const path = join(BOARDS_DIR, `${b.id}.json`);
      if (!existsSync(path)) continue;
      try {
        const board = JSON.parse(readFileSync(path, 'utf8')) as RankingBoard;
        for (const item of board.items) {
          for (const k of item.roadKeys) {
            const list = crossIndex.get(k) ?? [];
            if (!list.includes(board.id)) list.push(board.id);
            crossIndex.set(k, list);
          }
        }
      } catch {
        /* 单文件损坏跳过 */
      }
    }
  }
  return crossIndex.get(roadKey) ?? [];
}
