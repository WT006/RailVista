/** 全站主导航（顶栏桌面端 + 底栏移动端共用） */
export type AppNavItem = {
  id: string;
  to?: string;
  label: string;
  match: (path: string) => boolean;
  /** 移动端底栏居中强调项 */
  center?: boolean;
  /** 占位入口，尚未开放 */
  placeholder?: boolean;
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  {
    id: 'rail',
    to: '/',
    label: '铁路线',
    match: (p) => p === '/' || p === '/trip' || p.startsWith('/route/'),
  },
  {
    id: 'drive',
    to: '/drive',
    label: '自驾线',
    match: (p) => p.startsWith('/drive') && !p.startsWith('/drive/atlas'),
  },
  {
    id: 'atlas',
    to: '/atlas',
    label: '全国地图',
    match: (p) => p.startsWith('/atlas') || p.startsWith('/drive/atlas'),
    center: true,
  },
  {
    id: 'ticket',
    to: '/ticket',
    label: '纪念票',
    match: (p) => p.startsWith('/ticket'),
  },
  {
    id: 'roadbook',
    to: '/roadbook',
    label: '旅行路书',
    match: (p) => p.startsWith('/roadbook'),
  },
];
