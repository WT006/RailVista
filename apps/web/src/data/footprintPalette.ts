/**
 * 立体足迹地图色板 —— 单一来源
 *
 * 配色基调：冷石墨蓝（未到访的大地）× 香槟金（走过的地方）。
 * 三条硬约束，都是上一版「看起来脏」的反面：
 *  1. 金色只出现在**顶面与轮廓光**。侧壁一律走中性石墨蓝，最多向暖偏一档——
 *     板块一旦连侧面都镀金，整块就变成一块金疙瘩，34 块堆在一起只剩「土黄」。
 *  2. 不掺焦棕。亮部到暗部始终留在 hue 38~48 的香槟区间，最暗也保持
 *     明度 ≥ 45%，宁可淡也不要糊。
 *  3. 未点亮 ≠ 纯黑。大地要有可辨识的冷灰蓝明暗，否则点亮的省份是
 *     「黑底上的橙色斑块」，读起来像热力图故障而不是足迹。
 *
 * 点亮比例改由**整面不透明度**承载（见组件里的 goldOpacity），不再用
 * 「按 sqrt(比例) 缩放半径的径向渐变」——那个做法在只点亮 1/21 座城市时
 * 只剩中心一小坨高亮，正是上一版满地图橙色烧斑的成因。
 *
 * 这些色值以 inline 属性写入 SVG 元素（而非 scoped CSS class），原因有二：
 *  1. 导出 PNG / 逐帧合成视频时会克隆 SVG 节点，inline 属性会被一并带走，
 *     无需再维护一份「导出专用样式表」，避免两处色值漂移；
 *  2. 色阶只需随点亮状态切换，inline 绑定的重算频率很低。
 *
 * 因此：交互相关（transition / animation / cursor）留在 CSS，视觉色值放这里。
 */

/**
 * 侧壁 6 档色阶（未点亮）：index 0 紧贴顶面 → 5 位于最底。
 * 最底档刻意留在 #101720 而不是压到黑：侧壁一旦接近背景色，
 * 大陆外缘那圈厚度就会从「板块的阴影」读成「地图上的洞」。
 */
export const WALL: readonly string[] = [
  '#33475f',
  '#2c3d52',
  '#253343',
  '#1e2835',
  '#172029',
  '#101720',
];

/**
 * 侧壁 6 档色阶（已点亮）：顶上一两档走暗古铜，让镀金顶面与侧面之间
 * 有一道「包金边」的过渡，再往下回落到中性石墨。
 * 整条侧壁都镀金是上一版的败笔——34 块金疙瘩堆在一起只剩土黄。
 */
export const WALL_LIT: readonly string[] = [
  '#96793f',
  '#7c6336',
  '#5f4c2e',
  '#453a27',
  '#302a20',
  '#211d18',
];

/**
 * 未点亮顶面：从西北到东南的一束光，2 档交替让相邻省之间有呼吸感。
 * 每档是 [亮端, 暗端]。
 *
 * 关键是**近中性、低饱和**。这版底色一开始是冷蓝，结果暖金覆层一叠上去，
 * 蓝 + 黄在感知上直接混成橄榄灰，整张图「金色发灰」；把底压成中性石墨之后，
 * 同样的金色立刻干净。要冷调，靠侧壁和氛围光给就够了，别放进顶面。
 */
export const TOP_DIM_GRADS: ReadonlyArray<readonly [string, string]> = [
  ['#2a2e35', '#171a1f'],
  ['#252931', '#14171b'],
];

/**
 * 已点亮顶面的金色覆层：饱和琥珀金，边缘收深以保留板块体积感。
 * 这里刻意用「颜料级」的饱和金而不是淡香槟——淡金叠在暗底上只会发灰，
 * 要的是「这块大地被走过」一眼可辨。
 */
export const TOP_LIT_GRADS: ReadonlyArray<readonly [string, string]> = [
  ['#ffe0a0', '#d99a3a'],
  ['#fbd794', '#cf8f2f'],
];

/** 省界：未点亮 / 已点亮 */
export const EDGE_DIM = 'rgba(158, 188, 220, 0.20)';
export const EDGE_LIT = 'rgba(255, 240, 208, 0.78)';
export const EDGE_W_DIM = 0.6;
export const EDGE_W_LIT = 0.95;

/** 已点亮省份外扩的一圈柔光（粗描边假光，不用 filter，导出时可原样带走） */
export const RIM_GLOW = 'rgba(255, 214, 140, 0.10)';
export const RIM_GLOW_W = 3.4;

/** 悬停态：冷光提亮，与点亮的暖金区分开，避免「hover 就像已点亮」 */
export const EDGE_HOVER = 'rgba(198, 224, 255, 0.62)';
export const EDGE_W_HOVER = 1;

/** 大陆之下的氛围光：冷蓝为主，右下角掺一丝暖金，避免深底死板 */
export const AMBIENT_COOL = 'rgba(72, 132, 190, 0.18)';
export const AMBIENT_WARM = 'rgba(226, 176, 92, 0.07)';
export const AMBIENT_EDGE = 'rgba(72, 132, 190, 0)';

/** 经纬网与图幅边框：测绘底图质感，压到刚好「看得见但不会注意」 */
export const GRATICULE = 'rgba(150, 186, 226, 0.055)';
export const GRATICULE_FRAME = 'rgba(150, 186, 226, 0.10)';

/**
 * 城市光点：实心点 / 内环 / 近场光晕 / 扩散涟漪 / 大范围暖光。
 * 光点本身要小而锐（r 1.5~3），氛围交给 CITY_GLOW 那层大范围径向渐变——
 * 这样「走过的城市」是钉在大地上的亮点，而不是一团糊开的色斑。
 */
export const CITY_DOT = '#fffdf6';
export const CITY_RING = 'rgba(255, 240, 208, 0.62)';
export const CITY_HALO = 'rgba(255, 208, 118, 0.22)';
export const CITY_RIPPLE = 'rgba(255, 216, 148, 0.42)';
export const CITY_GLOW_IN = 'rgba(255, 196, 96, 0.34)';
export const CITY_GLOW_OUT = 'rgba(255, 176, 64, 0)';

/** 南海诸岛附图（岛礁属于未到访区域，用青蓝而非金色） */
export const INSET_BG = 'rgba(11, 17, 27, 0.72)';
export const INSET_BORDER = 'rgba(150, 186, 226, 0.24)';
export const INSET_ISLAND = 'rgba(150, 184, 216, 0.62)';
export const INSET_ISLAND_LINE = 'rgba(168, 200, 230, 0.32)';
export const INSET_DASH = 'rgba(172, 204, 236, 0.55)';
export const INSET_LABEL = 'rgba(176, 196, 222, 0.72)';

/** 导出图片/视频的画布底色 */
export const EXPORT_BG = '#080b12';

/** 导出标题区的金色文字（与 --ticket-gold-bright 同族） */
export const EXPORT_GOLD_TEXT = '#e8cd92';
