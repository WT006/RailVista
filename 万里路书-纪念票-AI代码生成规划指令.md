# 万里路书 · 旅行纪念票 — AI 代码生成规划指令

> 本文档是交给 AI 编码助手（如 Cursor / Copilot / QwenWork）的完整实现规划。
> 按照此文档逐步生成代码，即可完成「旅行纪念票」功能的全栈开发。

---

## 〇、项目上下文

| 项目 | 说明 |
|------|------|
| 仓库 | RailVista monorepo (pnpm workspace) |
| 前端 | `apps/web` — Vue 3 + TypeScript + Vite + TailwindCSS |
| 后端 | `apps/api` — Hono + TypeScript |
| 共享 | `packages/shared` — 纯 TypeScript 类型/工具函数 |
| 现有数据 | 248条走廊 + 432个景点 + 12306代理 + OSM Overpass + 高德地图 |
| 目标平台 | Web (H5) + 鸿蒙 HarmonyOS NEXT (ArkTS，Phase 3) |

---

## 一、数据模型（packages/shared）

### 1.1 核心类型定义

```typescript
// packages/shared/src/types/ticket.ts

/** 票种枚举 */
export enum TicketType {
  RAILWAY = 'railway',      // 铁路纪念票
  DRIVE = 'drive',          // 自驾纪念票
  FLIGHT = 'flight',        // 飞行纪念票
  COMBINED = 'combined',    // 综合旅行纪念票
  ANNUAL = 'annual',        // 年度纪念票
}

/** 票面风格 */
export interface TicketStyle {
  id: string;
  name: string;              // "青藏线·雪山蓝金"
  type: TicketType;
  isFree: boolean;
  isLimited: boolean;        // 节日限定/博主联名
  colorScheme: {
    bgGradient: [string, string, string]; // 三色渐变
    accentColor: string;     // 金色强调
    textColor: string;
    mutedColor: string;
  };
  backgroundPattern?: string; // SVG pattern data URI
  coverImageUrl?: string;     // 可选背景图
}

/** 票据基础数据 */
export interface TicketBase {
  id: string;                // UUID
  serialNumber: string;      // "HW-RAIL-20260715-001"
  type: TicketType;
  styleId: string;
  userId: string;
  createdAt: string;         // ISO 8601
  tripId: string;            // 关联行程
  
  // 自定义内容
  customTitle?: string;      // 用户自定义标题
  quote: string;             // 一句话感言
  backgroundPhotoUrl?: string; // 票面背景照片
  
  // 显示控制
  visibleFields: string[];   // 可见字段列表
  
  // 输出
  exportRatios: ExportRatio[];
  hasWatermark: boolean;     // 免费版 true
}

export type ExportRatio = '1:1' | '4:5' | '16:9' | '2:3';

/** 铁路纪念票数据 */
export interface RailwayTicketData extends TicketBase {
  type: TicketType.RAILWAY;
  departure: StationInfo;
  arrival: StationInfo;
  trainNumber: string;       // "Z8991"
  railwayName: string;       // "青藏铁路"
  departureTime: string;     // ISO
  seatInfo?: string;         // "07车15号下铺"
  isScenicSide?: boolean;    // 风景侧
  distanceKm: number;
  durationMinutes: number;
  altitudeGain: number;      // 海拔爬升 m
  maxAltitude: number;       // 最高海拔 m
  highlights: number;        // 小确幸数
  photos: number;            // 取景框照片数
}

/** 自驾纪念票数据 */
export interface DriveTicketData extends TicketBase {
  type: TicketType.DRIVE;
  routeName: string;         // "青甘环线"
  routeLevel?: string;       // "国家级精品自驾公路"
  waypoints: string[];       // ["西宁","青海湖","茶卡","敦煌","西宁"]
  startDate: string;
  endDate: string;
  days: number;
  nights: number;
  distanceKm: number;
  drivingHours: number;
  provincesCount: number;
  citiesCount: number;
  maxAltitude: number;
  fuelStops: number;
  chargeStops: number;
  vehicleModel?: string;     // "坦克300"
  highlights: number;
  photos: number;
}

/** 飞行纪念票数据 */
export interface FlightTicketData extends TicketBase {
  type: TicketType.FLIGHT;
  departureAirport: AirportInfo;
  arrivalAirport: AirportInfo;
  flightNumber: string;      // "CZ3467"
  airline: string;           // "中国南方航空"
  date: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  distanceKm: number;
  seatNumber?: string;       // "32A"
  windowSide?: 'left' | 'right';
  cruiseAltitude: number;    // 巡航高度 m
  windowHighlights?: string[]; // ["雪山","云海"]
}

/** 综合旅行纪念票数据 */
export interface CombinedTicketData extends TicketBase {
  type: TicketType.COMBINED;
  tripTitle: string;         // "川西秘境·我的毕业旅行"
  startDate: string;
  endDate: string;
  days: number;
  nights: number;
  totalDistanceKm: number;
  cities: string[];
  maxAltitude: number;
  maxAltitudeLocation?: string;
  segments: {
    flights: number;
    railways: number;
    drives: number;
  };
  highlights: number;
  photos: number;
}

/** 年度纪念票数据 */
export interface AnnualTicketData extends TicketBase {
  type: TicketType.ANNUAL;
  year: number;
  totalDistanceKm: number;
  equatorLaps: number;       // 绕地球赤道圈数
  tripCount: number;
  totalDays: number;
  provincesCount: number;
  citiesCount: number;
  segments: {
    flights: number;
    railways: number;
    drives: number;
  };
  farthestDestination: string;
  farthestDistanceKm: number;
  highestPoint: string;
  highestAltitude: number;
  totalHighlights: number;
  totalPhotos: number;
  annualQuote: string;       // AI生成的年度金句
}

/** 站点信息 */
export interface StationInfo {
  name: string;              // "西宁西"
  code?: string;             // 站码
  city?: string;
  province?: string;
  lat?: number;
  lng?: number;
}

/** 机场信息 */
export interface AirportInfo {
  name: string;              // "广州白云"
  iataCode: string;          // "CAN"
  city: string;
}

/** 联合类型 */
export type TicketData =
  | RailwayTicketData
  | DriveTicketData
  | FlightTicketData
  | CombinedTicketData
  | AnnualTicketData;
```

### 1.2 成就系统类型

```typescript
// packages/shared/src/types/achievement.ts

export interface Badge {
  id: string;
  name: string;              // "旅行新人"
  description: string;
  icon: string;              // emoji or SVG path
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  requirement: BadgeRequirement;
}

export type BadgeRequirement =
  | { type: 'ticket_count'; count: number }
  | { type: 'route_collection'; routeIds: string[] }
  | { type: 'distance_total'; km: number }
  | { type: 'altitude_max'; meters: number };

export interface UserBadge {
  userId: string;
  badgeId: string;
  unlockedAt: string;
}
```

### 1.3 票根墙类型

```typescript
// packages/shared/src/types/ticket-wall.ts

export interface TicketWall {
  userId: string;
  tickets: TicketData[];
  layout: 'timeline' | 'route' | 'transport';
  lastUpdated: string;
}

export interface TicketWallShareImage {
  url: string;
  width: number;
  height: number;
  ticketCount: number;
}
```

---

## 二、后端 API 设计（apps/api）

### 2.1 路由结构

```
/api/v1/tickets/
├── GET    /templates          获取可用模板列表
├── GET    /templates/:id      获取单个模板详情
├── POST   /generate           生成纪念票（核心接口）
├── GET    /:id                获取票据详情
├── GET    /user               获取当前用户所有票据
├── PUT    /:id                更新票据（自定义内容）
├── DELETE /:id                删除票据
├── POST   /:id/export         导出高清图（指定比例）
├── GET    /:id/share          获取分享链接+二维码
├── GET    /wall               获取票根墙数据
├── POST   /wall/share         生成票根墙长图
├── GET    /stats/annual/:year 获取年度统计数据
├── GET    /badges             获取用户徽章列表
└── POST   /auto-generate      自动生成（旅程结束触发）
```

### 2.2 核心接口详细设计

```typescript
// apps/api/src/routes/tickets.ts

import { Hono } from 'hono';

const ticketRoutes = new Hono();

/**
 * POST /api/v1/tickets/generate
 * 生成纪念票
 * 
 * Request Body:
 */
interface GenerateTicketRequest {
  tripId: string;            // 关联行程ID
  type: TicketType;          // 票种
  styleId: string;           // 风格模板ID
  customTitle?: string;      // 自定义标题
  quote?: string;            // 一句话（不填则AI生成）
  backgroundPhotoUrl?: string;
  visibleFields?: string[];  // 不传则全部显示
  exportRatios?: ExportRatio[]; // 默认 ['2:3']
}

/**
 * Response:
 */
interface GenerateTicketResponse {
  ticket: TicketData;
  previewUrl: string;        // 低分辨率预览
  serialNumber: string;
  suggestedQuote: string;    // AI建议的一句话
}

/**
 * POST /api/v1/tickets/:id/export
 * 导出高清图
 * 
 * Request Body:
 */
interface ExportTicketRequest {
  ratio: ExportRatio;        // '1:1' | '4:5' | '16:9' | '2:3'
  format: 'png' | 'jpeg' | 'webp';
  quality?: number;          // 0-100, 默认95
  withWatermark?: boolean;   // 免费版强制true
}

/**
 * Response: 
 */
interface ExportTicketResponse {
  downloadUrl: string;       // CDN地址
  width: number;
  height: number;
  fileSize: number;          // bytes
}
```

### 2.3 自动填充逻辑

```typescript
// apps/api/src/services/ticket-data-filler.ts

/**
 * 从行程数据自动填充票据字段
 * 核心原则：零输入，所有信息自动填入
 */
export class TicketDataFiller {
  
  /** 铁路票数据填充 */
  async fillRailwayData(tripId: string): Promise<Partial<RailwayTicketData>> {
    // 1. 从 12306 代理获取车次信息
    // 2. 从 RailVista 走廊数据获取里程/海拔
    // 3. 从用户定位记录计算实际时长
    // 4. 从小确幸模块同步打卡数
    // 5. 从取景框同步照片数
  }
  
  /** 自驾票数据填充 */
  async fillDriveData(tripId: string): Promise<Partial<DriveTicketData>> {
    // 1. 从GPS轨迹提取途经点
    // 2. 计算总里程/驾驶时长
    // 3. 匹配精品公路数据库
    // 4. 统计省市数
    // 5. 从高德数据获取海拔信息
  }
  
  /** 年度统计汇总 */
  async fillAnnualData(userId: string, year: number): Promise<AnnualTicketData> {
    // 1. 聚合该用户全年所有行程
    // 2. 计算总里程/次数/天数
    // 3. 统计省市覆盖
    // 4. 找出最远/最高记录
    // 5. AI生成年度金句
  }
}
```

### 2.4 AI 金句生成

```typescript
// apps/api/src/services/quote-generator.ts

interface QuoteContext {
  ticketType: TicketType;
  route: string;
  highlights: string[];      // 用户的小确幸记录
  season: string;
  mood?: string;             // 可选情绪标签
}

/**
 * 基于行程上下文生成个性化一句话
 * 使用 prompt engineering，非简单模板
 */
export async function generateQuote(ctx: QuoteContext): Promise<string[]> {
  // 返回3条建议供用户选择
  // prompt: 根据{route}的{season}旅行，用户打卡了{highlights}，
  //         生成3句简短有诗意的旅行感言，20字以内，
  //         风格：温暖、有画面感、不矫情
}
```

---

## 三、前端组件架构（apps/web）

### 3.1 目录结构

```
apps/web/src/
├── views/
│   └── ticket/
│       ├── TicketHomeView.vue        # 纪念票主页（票根墙入口）
│       ├── TicketCreateView.vue      # 创建流程（6步）
│       ├── TicketDetailView.vue      # 单张票详情
│       ├── TicketWallView.vue        # 票根墙
│       └── TicketAnnualView.vue      # 年度报告页
├── components/
│   └── ticket/
│       ├── TicketCanvas.vue          # 票据渲染画布（核心）
│       ├── TicketPreview.vue         # 实时预览组件
│       ├── TicketTypeSelector.vue    # 票种选择器
│       ├── TicketStyleCarousel.vue   # 风格滑动选择
│       ├── TicketFieldEditor.vue     # 字段自定义编辑
│       ├── TicketQuoteInput.vue      # 一句话输入（含AI建议）
│       ├── TicketPhotoPicker.vue     # 背景照片选择
│       ├── TicketExportDialog.vue    # 导出对话框
│       ├── TicketShareSheet.vue      # 分享面板
│       ├── TicketWallGrid.vue        # 票根墙网格
│       ├── TicketWallTimeline.vue    # 票根墙时间线
│       ├── BadgeShowcase.vue         # 徽章展示
│       └── templates/               # 票面模板组件
│           ├── RailwayTemplate.vue
│           ├── DriveTemplate.vue
│           ├── FlightTemplate.vue
│           ├── CombinedTemplate.vue
│           └── AnnualTemplate.vue
├── composables/
│   ├── useTicketGenerator.ts         # 票据生成逻辑
│   ├── useTicketExport.ts            # 导出为图片
│   ├── useTicketWall.ts              # 票根墙数据
│   └── useBadges.ts                  # 成就系统
├── stores/
│   └── ticketStore.ts                # Pinia store
└── utils/
    ├── ticket-serial.ts              # 编号生成器
    ├── ticket-qr.ts                  # 二维码生成
    └── ticket-render.ts              # Canvas 渲染引擎
```

### 3.2 核心组件设计

#### TicketCanvas.vue — 票据渲染核心

```vue
<!-- 
  核心渲染组件
  职责：将 TicketData + TicketStyle 渲染为可视化票面
  技术方案：SVG + foreignObject（开发时） → Canvas 2D（导出时）
  
  Props:
  - ticketData: TicketData       票据数据
  - style: TicketStyle           风格配置
  - ratio: ExportRatio           画面比例
  - scale: number                缩放 (预览0.5x, 导出4x)
  - showWatermark: boolean       是否显示水印
  
  事件:
  - @rendered: (canvas: HTMLCanvasElement) => void
  - @click-field: (fieldName: string) => void   点击可编辑区域
-->
```

#### 渲染引擎实现方案

```typescript
// apps/web/src/utils/ticket-render.ts

/**
 * 票据渲染引擎
 * 
 * 为什么用 Canvas 2D 而非 html2canvas：
 * 1. 4K 输出需要精确控制像素
 * 2. 渐变/图案/文字排版需要底层API
 * 3. 性能：直接绘制比DOM截图快10x
 * 4. 跨平台：鸿蒙端也可复用相同绘制逻辑
 * 
 * 架构：Layer-based rendering
 * Layer 0: 背景渐变 + 图案纹理
 * Layer 1: 照片叠加（半透明）
 * Layer 2: 文字信息层
 * Layer 3: 装饰元素（分割线、图标）
 * Layer 4: 二维码 + 编号
 * Layer 5: 水印（免费版）
 */

export interface RenderConfig {
  width: number;              // 输出宽度 px
  height: number;             // 输出高度 px
  dpr: number;                // device pixel ratio (4K = 4)
  style: TicketStyle;
  data: TicketData;
  showWatermark: boolean;
  backgroundPhoto?: ImageBitmap;
}

export async function renderTicket(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  config: RenderConfig
): Promise<void> {
  const ctx = canvas.getContext('2d')!;
  const { width, height, dpr } = config;
  
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  
  // Layer 0: Background
  await renderBackground(ctx, config);
  
  // Layer 1: Photo overlay
  if (config.backgroundPhoto) {
    await renderPhotoOverlay(ctx, config);
  }
  
  // Layer 2: Content
  await renderContent(ctx, config);
  
  // Layer 3: Decorations
  await renderDecorations(ctx, config);
  
  // Layer 4: QR + Serial
  await renderFooter(ctx, config);
  
  // Layer 5: Watermark
  if (config.showWatermark) {
    await renderWatermark(ctx, config);
  }
}

/**
 * 尺寸规格表（像素）
 */
export const TICKET_SIZES: Record<ExportRatio, { w: number; h: number }> = {
  '2:3': { w: 1080, h: 1620 },   // 默认票面比例
  '1:1': { w: 1080, h: 1080 },   // 社交平台
  '4:5': { w: 1080, h: 1350 },   // 小红书
  '16:9': { w: 1920, h: 1080 },  // 壁纸
};
```

### 3.3 创建流程（6步）状态管理

```typescript
// apps/web/src/stores/ticketStore.ts

import { defineStore } from 'pinia';

interface TicketCreateState {
  step: 1 | 2 | 3 | 4 | 5 | 6;
  
  // Step 1: 触发/选择行程
  selectedTripId: string | null;
  availableTrips: Trip[];
  
  // Step 2: 选模板
  selectedType: TicketType | null;
  selectedStyleId: string | null;
  availableStyles: TicketStyle[];
  
  // Step 3: 自动填充
  filledData: Partial<TicketData> | null;
  isAutoFilling: boolean;
  
  // Step 4: 自定义
  customTitle: string;
  quote: string;
  suggestedQuotes: string[];
  backgroundPhoto: File | null;
  colorAdjust: { hue: number; saturation: number; brightness: number };
  visibleFields: Set<string>;
  
  // Step 5: 生成
  generatedTicket: TicketData | null;
  isGenerating: boolean;
  
  // Step 6: 导出/分享
  selectedRatio: ExportRatio;
  exportUrl: string | null;
}

export const useTicketStore = defineStore('ticket', {
  state: (): TicketCreateState => ({ /* ... */ }),
  
  actions: {
    /** Step 3: 自动填充 */
    async autoFill() {
      this.isAutoFilling = true;
      const res = await api.post('/tickets/generate', {
        tripId: this.selectedTripId,
        type: this.selectedType,
        styleId: this.selectedStyleId,
      });
      this.filledData = res.ticket;
      this.suggestedQuotes = res.suggestedQuotes;
      this.isAutoFilling = false;
    },
    
    /** Step 5: 生成票据 */
    async generate() {
      this.isGenerating = true;
      // ... 调用后端 + 前端渲染
      this.isGenerating = false;
    },
    
    /** Step 6: 导出 */
    async exportImage(ratio: ExportRatio) {
      // Canvas → Blob → Upload → URL
    },
  },
});
```

---

## 四、触发机制设计

### 4.1 自动触发（旅程结束）

```typescript
// apps/api/src/services/trip-watcher.ts

/**
 * 旅程结束检测逻辑：
 * 1. 用户最后一次定位更新 > 30分钟前
 * 2. 且定位在目的地城市（非出发城市）
 * 3. 且行程状态为 "进行中"
 * → 触发 "生成纪念票" 推送通知
 */
export class TripWatcher {
  private readonly SETTLE_THRESHOLD_MS = 30 * 60 * 1000; // 30分钟
  
  async checkTripEnd(userId: string): Promise<boolean> {
    // ...
  }
  
  async triggerTicketSuggestion(userId: string, tripId: string) {
    // 生成推送通知
    // 标题："你的青藏线纪念票已准备就绪"
    // 正文："点击查看并保存这段旅程的纪念"
    // 深链：hw://ticket/create?tripId=xxx&type=railway
  }
}
```

### 4.2 取景框触发

```typescript
/**
 * 当用户在取景框模块拍完一组照片（≥3张，同一行程）
 * → 弹出底部Sheet："这组照片来自青藏线，要生成纪念票吗？"
 */
```

---

## 五、社交传播系统

### 5.1 二维码生成

```typescript
// apps/web/src/utils/ticket-qr.ts

import QRCode from 'qrcode';

/**
 * 二维码内容：分享页短链
 * 扫码直达：
 * 1. 这张票对应的完整路书（公开版）
 * 2. 万里路书下载页
 * 3. "生成你的旅行纪念票" 入口
 */
export async function generateTicketQR(ticketId: string): Promise<string> {
  const shareUrl = `https://hw.hey.world/t/${ticketId.slice(0, 8)}`;
  return QRCode.toDataURL(shareUrl, {
    width: 200,
    margin: 1,
    color: { dark: '#1a1a2e', light: '#ffffff' },
  });
}
```

### 5.2 票根墙长图生成

```typescript
/**
 * 票根墙分享 = 所有票据缩略图排列成一面墙 → 拼接为长图
 * 布局算法：
 * - timeline: 按时间从新到旧，每行3张
 * - route: 按地理位置排列（需要经纬度）
 * - transport: 按交通方式分组
 * 
 * 输出：竖版长图 (1080 x N)，底部带品牌信息
 */
```

### 5.3 年度传播事件

```typescript
// apps/api/src/services/annual-campaign.ts

/**
 * 每年12月20日自动触发：
 * 1. 为所有活跃用户计算年度数据
 * 2. 自动生成年度纪念票（默认最佳风格）
 * 3. 推送通知："你的2026年度纪念票已生成"
 * 4. 话题标签：#我的万里路书年度票#
 * 5. 博主带头分享 → 自然裂变
 */
export class AnnualCampaign {
  async generateAllAnnualTickets(year: number) { /* ... */ }
  async sendPushNotifications() { /* ... */ }
}
```

---

## 六、成就徽章系统

### 6.1 预定义徽章

```typescript
// packages/shared/src/constants/badges.ts

export const BADGES: Badge[] = [
  {
    id: 'newcomer',
    name: '旅行新人',
    description: '收集10张纪念票',
    icon: '🎫',
    tier: 'bronze',
    requirement: { type: 'ticket_count', count: 10 },
  },
  {
    id: 'enthusiast',
    name: '旅行达人',
    description: '收集50张纪念票',
    icon: '🏅',
    tier: 'silver',
    requirement: { type: 'ticket_count', count: 50 },
  },
  {
    id: 'explorer',
    name: '旅行家',
    description: '收集100张纪念票',
    icon: '🏆',
    tier: 'gold',
    requirement: { type: 'ticket_count', count: 100 },
  },
  {
    id: 'highway_pilgrim',
    name: '国家公路巡礼者',
    description: '集齐12条国家级精品公路',
    icon: '🛣️',
    tier: 'platinum',
    requirement: { type: 'route_collection', routeIds: [/* 12条国道ID */] },
  },
];
```

---

## 七、技术实现要点

### 7.1 Canvas 文字排版

```typescript
/**
 * 中文字体渲染注意事项：
 * 1. 字体加载：使用 FontFace API 确保字体加载完成再绘制
 * 2. 推荐字体：
 *    - 标题：思源宋体 (Noto Serif SC) — 有文化感
 *    - 正文：思源黑体 (Noto Sans SC) — 清晰
 *    - 编号：JetBrains Mono — 等宽科技感
 * 3. 文字换行：Canvas 无自动换行，需手动 measureText 断行
 * 4. 长文字截断：站名超过4字缩小字号
 */
export async function loadFonts(): Promise<void> {
  const fonts = [
    new FontFace('NotoSerifSC', 'url(/fonts/NotoSerifSC-Bold.woff2)'),
    new FontFace('NotoSansSC', 'url(/fonts/NotoSansSC-Regular.woff2)'),
    new FontFace('JetBrainsMono', 'url(/fonts/JetBrainsMono-Regular.woff2)'),
  ];
  await Promise.all(fonts.map(f => f.load().then(loaded => document.fonts.add(loaded))));
}
```

### 7.2 高性能导出

```typescript
/**
 * 4K导出流程（目标 2秒内完成）：
 * 1. 使用 OffscreenCanvas（Web Worker中渲染，不阻塞主线程）
 * 2. 预加载所有素材（字体、图案、照片）
 * 3. 分层缓存：背景层不变时可复用
 * 4. 导出格式选择：
 *    - PNG: 无损，文件大（约3-5MB）
 *    - WebP: 高质量+小体积（约800KB）← 推荐默认
 *    - JPEG: 最小（约500KB），适合分享
 */
export async function exportTicket(
  config: RenderConfig,
  format: 'png' | 'jpeg' | 'webp' = 'webp',
  quality = 0.95
): Promise<Blob> {
  const canvas = new OffscreenCanvas(config.width * config.dpr, config.height * config.dpr);
  await renderTicket(canvas, config);
  return canvas.convertToBlob({ type: `image/${format}`, quality });
}
```

### 7.3 鸿蒙端适配预案

```typescript
/**
 * HarmonyOS NEXT 适配要点：
 * 1. 渲染引擎：ArkTS Canvas API 与 Web Canvas 2D 高度兼容
 *    - renderTicket() 函数可直接迁移
 *    - 需替换 FontFace → 鸿蒙字体加载API
 * 2. 分享能力：
 *    - 使用 @ohos.sharing 系统分享
 *    - 支持分享到微信/小红书（鸿蒙版SDK）
 * 3. 推送通知：
 *    - 使用 @ohos.notificationManager
 *    - 支持富媒体通知（带票面缩略图）
 * 4. 存储：
 *    - 票据数据使用 @ohos.data.relationalStore (SQLite)
 *    - 图片缓存使用 @ohos.file.fs
 */
```

---

## 八、数据库表设计

```sql
-- 纪念票主表
CREATE TABLE tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  trip_id UUID REFERENCES trips(id),
  type VARCHAR(20) NOT NULL,           -- railway/drive/flight/combined/annual
  style_id VARCHAR(50) NOT NULL,
  serial_number VARCHAR(30) UNIQUE NOT NULL,
  
  -- 自定义
  custom_title TEXT,
  quote TEXT NOT NULL DEFAULT '',
  background_photo_url TEXT,
  visible_fields JSONB DEFAULT '[]',
  color_adjust JSONB DEFAULT '{"hue":0,"saturation":0,"brightness":0}',
  
  -- 票据数据（JSON存储，结构由 type 决定）
  data JSONB NOT NULL,
  
  -- 导出记录
  exported_urls JSONB DEFAULT '{}',     -- { "2:3": "cdn://...", "1:1": "..." }
  has_watermark BOOLEAN DEFAULT true,
  
  -- 分享
  share_slug VARCHAR(8) UNIQUE,         -- 短链标识
  share_count INT DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tickets_user ON tickets(user_id);
CREATE INDEX idx_tickets_type ON tickets(type);
CREATE INDEX idx_tickets_year ON tickets(EXTRACT(YEAR FROM created_at));

-- 徽章表
CREATE TABLE badges (
  id VARCHAR(30) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  description TEXT,
  icon TEXT,
  tier VARCHAR(10) NOT NULL,
  requirement JSONB NOT NULL
);

-- 用户徽章
CREATE TABLE user_badges (
  user_id UUID NOT NULL REFERENCES users(id),
  badge_id VARCHAR(30) NOT NULL REFERENCES badges(id),
  unlocked_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);

-- 票根墙分享记录
CREATE TABLE ticket_wall_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  layout VARCHAR(20) NOT NULL,
  image_url TEXT NOT NULL,
  ticket_count INT NOT NULL,
  shared_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 九、实施阶段划分

### Phase 1：MVP（2周）
- [ ] `packages/shared` 类型定义
- [ ] 铁路纪念票（单一票种）完整流程
- [ ] Canvas 渲染引擎 v1（基础排版）
- [ ] 3套免费风格模板
- [ ] 导出 2:3 比例 PNG
- [ ] 后端 generate + export API

### Phase 2：完善（3周）
- [ ] 自驾票 + 飞行票 + 综合票
- [ ] 票根墙页面
- [ ] 二维码 + 分享短链
- [ ] AI 金句生成
- [ ] 自动触发机制
- [ ] 多比例导出（1:1, 4:5, 16:9）
- [ ] WebP 格式支持

### Phase 3：增长（2周）
- [ ] 年度纪念票 + 12月自动生成
- [ ] 成就徽章系统
- [ ] 票根墙长图分享
- [ ] 博主联名款模板
- [ ] 节日限定模板
- [ ] 会员无水印

### Phase 4：鸿蒙 + 商业化（3周）
- [ ] 鸿蒙端 ArkTS 渲染引擎迁移
- [ ] 鸿蒙推送通知
- [ ] 实体票打印服务接入
- [ ] 付费模板商店
- [ ] 高级定制功能（字体/布局/动画）

---

## 十、AI 编码指令模板

> 以下是可以直接复制给 AI 编码助手的 prompt，按步骤执行。

### Prompt 1：创建类型定义

```
在 packages/shared/src/types/ 目录下创建 ticket.ts 文件。
这是一个 pnpm monorepo 项目，packages/shared 是纯 TypeScript 包。

需要定义以下类型：
1. TicketType 枚举（railway/drive/flight/combined/annual）
2. TicketStyle 接口（风格模板配置）
3. TicketBase 基础接口（所有票据共有字段）
4. 5种票据的具体数据接口（RailwayTicketData, DriveTicketData, FlightTicketData, CombinedTicketData, AnnualTicketData）
5. TicketData 联合类型
6. ExportRatio 类型
7. StationInfo 和 AirportInfo 辅助接口

在 packages/shared/src/index.ts 中导出这些类型。
参考上方"一、数据模型"中的完整定义。
```

### Prompt 2：创建渲染引擎

```
在 apps/web/src/utils/ticket-render.ts 中实现 Canvas 2D 票据渲染引擎。

技术栈：Vue 3 + TypeScript + Vite
要求：
1. 支持 OffscreenCanvas（用于 Web Worker 高性能导出）
2. 分层渲染：背景→照片→文字→装饰→二维码→水印
3. 中文字体加载（FontFace API）
4. 支持 4 种输出比例：2:3(1080x1620), 1:1(1080x1080), 4:5(1080x1350), 16:9(1920x1080)
5. DPR 支持（预览1x，导出4x=4K）
6. 渐变色背景 + SVG pattern 纹理叠加
7. 文字自动换行（measureText断行）
8. 圆角裁切 + 左侧锯齿边效果

渲染引擎是纯函数，不依赖 Vue 响应式系统，方便后续迁移到鸿蒙 ArkTS。
```

### Prompt 3：创建后端 API

```
在 apps/api/src/routes/ 下创建 tickets.ts，实现纪念票 CRUD API。

技术栈：Hono + TypeScript
数据库：PostgreSQL（通过 Drizzle ORM）
需要实现：
1. GET /templates — 返回可用模板列表（从配置文件/数据库读取）
2. POST /generate — 接收 tripId + type + styleId，自动填充数据，返回完整票据
3. GET /user — 返回当前用户所有票据（分页）
4. PUT /:id — 更新自定义字段（title, quote, photo, visibleFields）
5. POST /:id/export — 触发高清渲染并上传CDN，返回下载URL
6. GET /:id/share — 生成分享短链 + 二维码数据

自动填充逻辑：
- 铁路票：调用 12306 代理获取车次信息，从走廊数据获取里程/海拔
- 自驾票：从GPS轨迹提取途经点和里程
- 飞行票：从航班查询记录获取
- 综合票：聚合行程内所有段
- 年度票：汇总全年数据
```

### Prompt 4：创建前端页面

```
在 apps/web/src/views/ticket/ 下创建纪念票功能的完整前端页面。

技术栈：Vue 3 Composition API + TypeScript + TailwindCSS + Pinia
需要实现：
1. TicketHomeView.vue — 主页，展示票根墙入口 + 最近票据 + "生成纪念票"按钮
2. TicketCreateView.vue — 6步创建流程：
   Step1: 选择行程（列表展示历史行程）
   Step2: 选票种+风格（横向滑动卡片）
   Step3: 自动填充（loading动画 → 数据逐项出现）
   Step4: 自定义（编辑标题/选照片/写感言/调颜色/开关字段）
   Step5: 生成（渲染动画 → 展示成品）
   Step6: 导出分享（选比例 → 下载/分享/加入票根墙）
3. TicketDetailView.vue — 单张票全屏展示 + 操作按钮
4. TicketWallView.vue — 票根墙（网格/时间线/地图 三种视图切换）

设计要求：
- 深色主题为主（#0f0f1a 背景）
- 金色强调色（#D4A853）
- 流畅的页面切换动画
- 步骤指示器
- 移动端优先响应式
```

### Prompt 5：创建成就系统

```
实现旅行纪念票的成就徽章系统。

需要：
1. 在 packages/shared/src/constants/badges.ts 定义徽章常量
2. 在 apps/api/src/services/badge-service.ts 实现解锁检测逻辑
   - 每次生成新票据后检查是否满足解锁条件
   - 条件类型：票据数量、特定线路集合、总里程、最高海拔
3. 在 apps/web/src/components/ticket/BadgeShowcase.vue 实现徽章展示组件
   - 已解锁：彩色 + 解锁日期
   - 未解锁：灰色剪影 + 进度条（如 "已收集 7/10"）
4. 解锁时弹出全屏动画（粒子特效 + 徽章放大）
5. 徽章展示在票根墙顶部和个人主页
```

---

## 十一、风格模板配置格式

```typescript
// 模板配置存储格式（JSON/数据库）
export const RAILWAY_STYLES: TicketStyle[] = [
  {
    id: 'railway-qingzang-blue-gold',
    name: '青藏线·雪山蓝金',
    type: TicketType.RAILWAY,
    isFree: true,
    isLimited: false,
    colorScheme: {
      bgGradient: ['#1a1a2e', '#16213e', '#0f3460'],
      accentColor: '#D4A853',
      textColor: '#ffffff',
      mutedColor: 'rgba(255,255,255,0.5)',
    },
    backgroundPattern: 'topographic-mountains', // 预定义图案ID
  },
  {
    id: 'railway-chuanyu-green',
    name: '川渝线·巴蜀墨绿',
    type: TicketType.RAILWAY,
    isFree: true,
    isLimited: false,
    colorScheme: {
      bgGradient: ['#0d1f0d', '#1a3a1a', '#2d5a2d'],
      accentColor: '#8fbc8f',
      textColor: '#ffffff',
      mutedColor: 'rgba(255,255,255,0.5)',
    },
    backgroundPattern: 'bamboo-leaves',
  },
  {
    id: 'railway-jinghu-silver',
    name: '京沪线·都市银灰',
    type: TicketType.RAILWAY,
    isFree: true,
    isLimited: false,
    colorScheme: {
      bgGradient: ['#1a1a1a', '#2d2d2d', '#404040'],
      accentColor: '#c0c0c0',
      textColor: '#ffffff',
      mutedColor: 'rgba(255,255,255,0.5)',
    },
    backgroundPattern: 'city-skyline',
  },
  // ... 更多风格
];
```

---

## 十二、关键设计决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 渲染方案 | Canvas 2D | 4K精确控制 + 鸿蒙迁移 + 性能 |
| 数据存储 | JSONB | 5种票据结构不同，关系型拆表过复杂 |
| 模板系统 | 配置驱动 | 新增风格只需加JSON配置，无需改代码 |
| 导出格式 | WebP默认 | 高质量+小体积，适合社交分享 |
| 短链服务 | 自建8字符 | 避免第三方依赖，支持统计 |
| 字体 | 思源系列 | 开源免费 + 中文覆盖全 + 有文化感 |
| 状态管理 | Pinia | Vue3官方推荐，TypeScript友好 |
| 二维码 | qrcode库 | 轻量 + 支持Canvas直接绘制 |
| 年度票触发 | Cron 12月20日 | 留10天缓冲让用户查看和分享 |

---

## 附录：编号规则

```
格式：HW-{TYPE}-{DATE}-{SEQ}
示例：
  HW-RAIL-20260715-001     铁路票，2026.07.15，当日第1张
  HW-DRIVE-20260801-003    自驾票，2026.08.01，当日第3张
  HW-FLIGHT-20260715-007   飞行票
  HW-TRIP-20260615-001     综合票
  HW-YEAR-2026-08973       年度票，2026年，用户序号

TYPE 映射：
  railway → RAIL
  drive → DRIVE
  flight → FLIGHT
  combined → TRIP
  annual → YEAR
```
