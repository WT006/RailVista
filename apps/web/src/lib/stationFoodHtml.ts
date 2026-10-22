import { escHtml } from '../data/spotDimensions';
import type { StationFood } from '../data/stationFoods';

/**
 * 地图 InfoWindow 是字符串 HTML（非 scoped 样式），故美食区块在此统一拼装，
 * TripMap / CorridorMap 复用同一份结构与样式类（map.css 的 .map-info-card__food*）。
 */
/** 卡片尺寸有限（max-width 300px / 手机 78vw），最多列 4 道 */
const MAX_CARD_DISHES = 4;

export function stationFoodCardHtml(food: StationFood | null): string {
  if (!food || !food.dishes.length) return '';
  const place = food.city && food.city !== food.province ? `${food.province}${food.city}` : food.province;
  const rows = food.dishes
    .slice(0, MAX_CARD_DISHES)
    .map(
      (d) =>
        `<li class="map-info-card__food-item"><span class="map-info-card__food-name">${escHtml(d.name)}</span><span class="map-info-card__food-note">${escHtml(d.note)}</span></li>`,
    )
    .join('');
  return `<div class="map-info-card__food">
    <div class="map-info-card__food-head">
      <span class="map-info-card__food-label">本站风味</span>
      <span class="map-info-card__food-place">${escHtml(place)}${food.tag ? ` · ${escHtml(food.tag)}` : ''}</span>
    </div>
    <ul class="map-info-card__food-list">${rows}</ul>
  </div>`;
}
