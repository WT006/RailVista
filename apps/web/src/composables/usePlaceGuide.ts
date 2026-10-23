/**
 * 跟随「当前地点」变化拉取路书库玩法。
 * 地点按 省/市 比较，避免地图每秒 tick 造成的重复请求；迟到响应用序号丢弃。
 * `pending` 用于让调用方在「查询中」与「确实没有」之间做让位决策。
 */
import { ref, watch, type Ref } from 'vue';
import { guidesForPlace, type PlaceGuides, type PlaceKey } from '../lib/placeGuides';

export function usePlaceGuide(source: () => PlaceKey | null): {
  guide: Ref<PlaceGuides | null>;
  pending: Ref<boolean>;
} {
  const guide = ref<PlaceGuides | null>(null);
  const pending = ref(false);
  let seq = 0;

  watch(
    () => {
      const p = source();
      return p ? `${p.province}/${p.city}` : '';
    },
    async (key) => {
      const mine = ++seq;
      guide.value = null;
      pending.value = false;
      if (!key) return;
      const place = source();
      if (!place) return;
      pending.value = true;
      const res = await guidesForPlace(place).catch(() => null);
      if (mine !== seq) return;
      guide.value = res;
      pending.value = false;
    },
    { immediate: true },
  );

  return { guide, pending };
}
