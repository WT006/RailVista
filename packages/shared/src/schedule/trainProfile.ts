/** 车型分类 */
export type TrainClass = 'G' | 'D' | 'C' | 'Z' | 'T' | 'K' | 'OTHER';

/** 车型运动学/统计参数 */
export interface TrainProfile {
  /** 车型分类 */
  trainClass: TrainClass;
  /** 巡航上限速度 (m/s) */
  vCap: number;
  /** 有效加速度 (m/s²) */
  aAcc: number;
  /** 有效减速度 (m/s²) */
  aDec: number;
  /** 单位图定时间的期望新增延误 (min/h) */
  mu: number;
  /** 图定基础不可信度 (min) */
  sigma0: number;
  /** 不可信度增长率 (min/√h) */
  gamma: number;
  /** 赶点恢复上限 (min) */
  recoverCap: number;
}

/** 参数修正标记 */
export interface ProfileModifiers {
  /** 单线区段（青藏格拉段、成昆部分等） */
  singleLine?: boolean;
  /** 大面积山区/隧道密集 */
  mountainous?: boolean;
  /** 夜间 0:00-5:00 */
  nighttime?: boolean;
  /** 进出厂枢纽 30km 内 */
  hubArea?: boolean;
  /** Z 走高铁覆写（如 Z509 兰新高铁） */
  hsrOverride?: boolean;
}

const KMH_TO_MS = 1000 / 3600;

const PROFILE_TABLE: Record<TrainClass, Omit<TrainProfile, 'trainClass'>> = {
  G:     { vCap: 310 * KMH_TO_MS, aAcc: 0.30, aDec: 0.45, mu: 0.4, sigma0: 1.0, gamma: 0.35, recoverCap: 8 },
  D:     { vCap: 250 * KMH_TO_MS, aAcc: 0.35, aDec: 0.50, mu: 0.6, sigma0: 1.5, gamma: 0.45, recoverCap: 10 },
  C:     { vCap: 200 * KMH_TO_MS, aAcc: 0.45, aDec: 0.60, mu: 0.8, sigma0: 1.5, gamma: 0.5,  recoverCap: 5 },
  Z:     { vCap: 160 * KMH_TO_MS, aAcc: 0.18, aDec: 0.25, mu: 1.5, sigma0: 2.5, gamma: 0.8,  recoverCap: 5 },
  T:     { vCap: 140 * KMH_TO_MS, aAcc: 0.16, aDec: 0.22, mu: 2.0, sigma0: 3.0, gamma: 1.0,  recoverCap: 5 },
  K:     { vCap: 120 * KMH_TO_MS, aAcc: 0.14, aDec: 0.20, mu: 3.0, sigma0: 3.5, gamma: 1.2,  recoverCap: 3 },
  OTHER: { vCap: 100 * KMH_TO_MS, aAcc: 0.12, aDec: 0.18, mu: 4.0, sigma0: 4.0, gamma: 1.4,  recoverCap: 0 },
};

/**
 * 车次代码 → 车型分类（G/D/C/Z/T/K/OTHER）。
 * 复用 corridors.ts 的判定口径。
 */
export function classifyTrain(code?: string): TrainClass {
  const c = (code || '').trim().toUpperCase();
  if (/^G/.test(c)) return 'G';
  if (/^D/.test(c)) return 'D';
  if (/^C/.test(c)) return 'C';
  if (/^Z/.test(c)) return 'Z';
  if (/^T/.test(c)) return 'T';
  if (/^K/.test(c)) return 'K';
  return 'OTHER';
}

/**
 * 获取车型参数。支持 Z 走高铁覆写（hsrOverride 时改用 G/D 档）。
 */
export function getTrainProfile(trainClass: TrainClass, modifiers?: ProfileModifiers): TrainProfile {
  let cls = trainClass;
  if (modifiers?.hsrOverride && (cls === 'Z' || cls === 'T' || cls === 'K')) {
    cls = 'D';
  }
  const base = PROFILE_TABLE[cls];
  const prof: TrainProfile = { trainClass: cls, ...base };
  if (modifiers) {
    applyProfileModifiers(prof, modifiers);
  }
  return prof;
}

/**
 * 原地应用参数修正项（单线/山区/夜间/枢纽）。
 */
export function applyProfileModifiers(prof: TrainProfile, mods: ProfileModifiers): void {
  if (mods.singleLine) {
    prof.mu *= 1.8;
    prof.recoverCap *= 0.4;
  }
  if (mods.mountainous) {
    prof.sigma0 *= 1.5;
  }
  if (mods.nighttime) {
    prof.mu *= 1.3;
  }
  if (mods.hubArea) {
    prof.vCap *= 0.6;
  }
}

/** 便捷：由车次代码直接获取参数 */
export function profileForTrain(code?: string, modifiers?: ProfileModifiers): TrainProfile {
  return getTrainProfile(classifyTrain(code), modifiers);
}