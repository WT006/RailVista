/**
 * 天地图合规署名（公开上线前以主管部门审图结果为准）。
 * 产品文案勿自称「天地图」商标；底图版权条不得遮挡。
 */
export const TIANDITU_SOURCE_LABEL = '国家地理信息公共服务平台天地图';

/** 审图号占位：取得正式审图号后改此常量或改为环境变量 */
export const TIANDITU_REVIEW_NO = import.meta.env.VITE_TIANDITU_REVIEW_NO || '审图号待标注';

export function tiandituAttributionHtml(): string {
  return `${TIANDITU_SOURCE_LABEL} · ${TIANDITU_REVIEW_NO}`;
}
