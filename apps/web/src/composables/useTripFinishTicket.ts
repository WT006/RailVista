/**
 * 「走完了一趟 → 提示生成纪念票」的共用逻辑（铁路 TripMap / 自驾 DriveTrip / 自驾地图）。
 * 三个页面的差异只在票面怎么生成，由调用方给 `makeTicket`；
 * 这里统一处理：只在完成态出现、同一趟只提示一次（本机记住）、点了就写入草稿并跳纪念票页。
 */
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { TicketConfig } from '@railvista/shared';
import { upsertTicketTrace } from '../lib/ticketTrace';
import { hasPromptedTripTicket, markTripTicketPrompted } from '../lib/ticketPrompted';
import { useTicketStore } from '../stores/ticketStore';

export function useTripFinishTicket(opts: {
  /** 行程唯一键（铁路 tripCacheKey / 自驾 driveTripKey），用于去重与痕迹 sourceKey */
  key: () => string;
  /** 是否已走完 */
  finished: () => boolean;
  /** 生成票面草稿；返回 null 表示数据不全，不出提示 */
  makeTicket: () => TicketConfig | null;
  /** 跳转来源标记（/ticket?src=），票页据此说明这张票是从哪儿生成的 */
  src: string;
}) {
  const router = useRouter();
  const ticketStore = useTicketStore();
  const visible = ref(false);

  watch(
    () => (opts.finished() && opts.key() ? opts.key() : ''),
    (key) => {
      if (!key) {
        visible.value = false;
        return;
      }
      if (hasPromptedTripTicket(key) || !opts.makeTicket()) return;
      markTripTicketPrompted(key);
      visible.value = true;
    },
  );

  function dismiss() {
    visible.value = false;
  }

  function go() {
    const cfg = opts.makeTicket();
    if (!cfg) return;
    try {
      upsertTicketTrace({ sourceKey: opts.key(), config: cfg });
    } catch {
      /* 痕迹落盘失败不挡住进票页 */
    }
    ticketStore.loadConfig(cfg);
    visible.value = false;
    void router.push({ path: '/ticket', query: { src: opts.src } });
  }

  return { visible, dismiss, go };
}
