import { ref, type Ref } from 'vue';
import type { GpsSample, RailwayPoint, ScenicSpot, SpotEta, Stop } from '@railvista/shared';
import {
  createFusionState,
  predict,
  update as kalmanUpdate,
  passGates,
  type FusionStateInternal,
} from '@railvista/shared';
import { createDelayField, addAnchor, type DelayField } from '@railvista/shared';
import { estimateSpotEtas } from '@railvista/shared';
import type { ScheduleCurve, TrainProfile } from '@railvista/shared';

export type TrackerMode = 'RUNNING' | 'DWELL' | 'UNPLANNED_STOP' | 'NO_SIGNAL';

export function useTrainTracker(params: {
  curve: ScheduleCurve;
  prof: TrainProfile;
  geoSigma: number;
  path: RailwayPoint[];
  lengthKm: number;
  stops: Stop[];
}) {
  const geoSigma = params.geoSigma;
  const state: Ref<FusionStateInternal> = ref(createFusionState({ s0: 0, v0: 0, t0: Date.now() }));
  const etas: Ref<SpotEta[]> = ref([]);
  const mode: Ref<TrackerMode> = ref('RUNNING');
  const delays: DelayField = createDelayField();

  let dwellTimer = 0;
  let stopTimer = 0;
  let exitTimer = 0;

  function nearestStationKm(s: number): number {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < params.stops.length; i++) {
      const km = params.curve.stationKm[i] ?? 0;
      const d = Math.abs(s - km);
      if (d < bestDist) {
        bestDist = d;
        best = km;
      }
    }
    return best;
  }

  function onTick(dt: number, gps: GpsSample | null, now: number, spots: ScenicSpot[]) {
    state.value = predict(state.value, dt, params.curve, params.prof, gps != null);

    if (gps && mode.value !== 'DWELL') {
      const gate = passGates({
        gps,
        state: state.value,
        path: params.path,
        lengthKm: params.lengthKm,
        prof: params.prof,
        lastS: state.value.lastS,
        dt,
      });
      if (gate.pass && gate.z != null && gate.R != null) {
        state.value = kalmanUpdate(state.value, gate.z, gate.R, params.prof);
      } else if (gate.soft && gate.z != null && gate.R != null) {
        state.value = kalmanUpdate(state.value, gate.z, gate.R, params.prof);
      }
    }

    const near = nearestStationKm(state.value.s);
    const isNearStation = Math.abs(state.value.s - near) < 1200;

    if (state.value.v < 2) {
      dwellTimer += dt;
      stopTimer += dt;
    } else {
      if (state.value.v > 5) exitTimer += dt;
      else exitTimer = 0;
      if (exitTimer > 10) {
        dwellTimer = 0;
        stopTimer = 0;
      }
    }

    const prevMode = mode.value;
    if (state.value.v < 2 && dwellTimer > 45 && isNearStation) {
      mode.value = 'DWELL';
      if (prevMode !== 'DWELL') {
        addAnchor(delays, {
          u: near,
          delta: now - params.curve.timeAtKm(near),
          t: now,
          credibility: 'high',
          recoverable: true,
        });
      }
    } else if (state.value.v < 2 && stopTimer > 60 && !isNearStation) {
      mode.value = 'UNPLANNED_STOP';
      if (prevMode !== 'UNPLANNED_STOP') {
        addAnchor(delays, {
          u: state.value.s,
          delta: stopTimer,
          t: now,
          credibility: 'mid',
          recoverable: false,
        });
      }
    } else if (state.value.gapSec > 90) {
      mode.value = 'NO_SIGNAL';
    } else {
      mode.value = 'RUNNING';
    }

    state.value.s = Math.max(state.value.s, state.value.lastS);

    etas.value = estimateSpotEtas({
      curve: params.curve,
      spots,
      now,
      fusion: {
        s: state.value.s,
        v: state.value.v,
        t: now,
        gapSec: state.value.gapSec,
        basis: state.value.basis,
      },
      prof: params.prof,
      geoSigma,
      delays,
    });
  }

  function addManualAnchor(stationKm: number, now: number) {
    addAnchor(delays, {
      u: stationKm,
      delta: now - params.curve.timeAtKm(stationKm),
      t: now,
      credibility: 'high',
      recoverable: true,
    });
  }

  return { state, etas, mode, onTick, addManualAnchor };
}