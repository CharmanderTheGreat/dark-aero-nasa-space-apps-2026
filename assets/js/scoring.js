/**
 * Dark Aero v4.2 - Shared scoring engine (browser + Node).
 *
 * This file is the single JS implementation of the similarity maths. The Python engine
 * (scripts/analog_matching_engine.py) implements the SAME formulas, and
 * tests/parity_test.js checks that both give identical results for every target/analog pair.
 *
 * Includes:
 *  - per-parameter similarity (incl. diurnal-swing aware thermal score)
 *  - weighted overall score
 *  - "weakest link" flags (a high overall score must not hide a failed critical parameter)
 *  - "points lost" explainability
 *  - Monte-Carlo weight-robustness analysis (how stable is the #1 pick?)
 */
(function (root) {
  "use strict";

  const PARAMS = ["geology", "roughness", "slope", "thermal", "aridity", "ice"];

  const PARAM_LABELS = {
    geology: "Basalt / Silicate Geology",
    roughness: "SAR Roughness vs CPR",
    slope: "Terrain Slope",
    thermal: "Thermal Regime",
    aridity: "Hyper-Aridity",
    ice: "Subsurface Ice"
  };

  // Thermal score = mean-temperature match (60%) + diurnal-swing match (40%).
  const THERMAL_MEAN_WEIGHT = 0.6;
  const THERMAL_SWING_WEIGHT = 0.4;
  const THERMAL_MEAN_RANGE_K = 220.0;
  const THERMAL_SWING_RANGE_K = 200.0;
  const SLOPE_RANGE_DEG = 25.0;

  // A parameter is "critical" when its normalised weight >= this and its score is below LOW_SCORE.
  const CRITICAL_WEIGHT = 0.1;
  const LOW_SCORE = 0.4;

  function clamp01(x) {
    return Math.max(0, Math.min(1, x));
  }

  function swingOf(extremes) {
    return Array.isArray(extremes) && extremes.length === 2 ? extremes[1] - extremes[0] : null;
  }

  /** Raw (0..1) similarity for each parameter. */
  function parameterScores(target, earth) {
    const meanScore = clamp01(1 - Math.abs(target.mean_temp_k - earth.mean_temp_k) / THERMAL_MEAN_RANGE_K);
    const swingT = swingOf(target.temp_extremes_k);
    const swingE = swingOf(earth.temp_extremes_k);
    const swingScore =
      swingT === null || swingE === null
        ? meanScore
        : clamp01(1 - Math.abs(swingT - swingE) / THERMAL_SWING_RANGE_K);

    return {
      geology: clamp01(1 - Math.abs(target.basalt_index - earth.basalt_index)),
      roughness: clamp01(1 - Math.abs(target.radar_cpr - earth.sar_roughness)),
      slope: clamp01(1 - Math.abs(target.slope_deg - earth.slope_deg) / SLOPE_RANGE_DEG),
      thermal: THERMAL_MEAN_WEIGHT * meanScore + THERMAL_SWING_WEIGHT * swingScore,
      aridity: clamp01(1 - Math.abs(target.aridity_index - earth.aridity_index)),
      ice: clamp01(1 - Math.abs(target.ice_potential - earth.ice_potential))
    };
  }

  function weightSum(weights) {
    return PARAMS.reduce((s, k) => s + (weights[k] || 0), 0) || 1.0;
  }

  function overallFromRaw(raw, weights) {
    const total = weightSum(weights);
    return PARAMS.reduce((s, k) => s + raw[k] * (weights[k] || 0), 0) / total;
  }

  function round1(x) {
    return Number((x * 100).toFixed(1));
  }

  /** Percent scores (1 decimal) + raw fractions. */
  function computeScores(target, earth, weights) {
    const raw = parameterScores(target, earth);
    const overall = overallFromRaw(raw, weights);
    return {
      overall: round1(overall),
      geology: round1(raw.geology),
      roughness: round1(raw.roughness),
      slope: round1(raw.slope),
      thermal: round1(raw.thermal),
      aridity: round1(raw.aridity),
      ice: round1(raw.ice),
      raw: raw
    };
  }

  /** Critical parameters that fail badly, even when the overall score looks fine. */
  function criticalFlags(raw, weights) {
    const total = weightSum(weights);
    return PARAMS.filter((k) => (weights[k] || 0) / total >= CRITICAL_WEIGHT && raw[k] < LOW_SCORE).map((k) => ({
      param: k,
      label: PARAM_LABELS[k],
      score: round1(raw[k])
    }));
  }

  /** Weighted points lost per parameter (sum of all = 100 - overall), sorted worst-first. */
  function pointsLost(raw, weights) {
    const total = weightSum(weights);
    return PARAMS.map((k) => ({
      param: k,
      label: PARAM_LABELS[k],
      score: round1(raw[k]),
      lost: Number((((1 - raw[k]) * (weights[k] || 0)) / total * 100).toFixed(1))
    })).sort((a, b) => b.lost - a.lost);
  }

  // Small deterministic PRNG so the robustness numbers are reproducible between page loads.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Monte-Carlo weight robustness. Draws `n` weight vectors uniformly from the 6-parameter
   * simplex (normalised Exp(1) samples = Dirichlet(1,...,1)) and records how often each analog
   * ranks #1 / top-3. Answers: "does the recommendation depend on my weight choices?"
   */
  function weightRobustness(target, earths, n, seed) {
    const draws = n || 2000;
    const rand = mulberry32(seed || 20261114);
    const raws = earths.map((e) => parameterScores(target, e));
    const top1 = new Array(earths.length).fill(0);
    const top3 = new Array(earths.length).fill(0);
    const rankSum = new Array(earths.length).fill(0);

    for (let d = 0; d < draws; d++) {
      const w = PARAMS.map(() => -Math.log(1 - rand()));
      const wsum = w.reduce((a, b) => a + b, 0);
      const totals = raws.map((raw) => PARAMS.reduce((s, k, i) => s + raw[k] * w[i], 0) / wsum);
      const order = totals.map((t, i) => i).sort((a, b) => totals[b] - totals[a]);
      order.forEach((idx, rank) => {
        rankSum[idx] += rank + 1;
        if (rank === 0) top1[idx]++;
        if (rank < 3) top3[idx]++;
      });
    }

    const out = {};
    earths.forEach((e, i) => {
      out[e.id] = {
        top1Pct: Number(((top1[i] / draws) * 100).toFixed(1)),
        top3Pct: Number(((top3[i] / draws) * 100).toFixed(1)),
        meanRank: Number((rankSum[i] / draws).toFixed(2))
      };
    });
    return out;
  }

  /** Best analog for a given weight preset (percent weights). */
  function bestForWeights(target, earths, weights) {
    let best = null;
    earths.forEach((e) => {
      const s = computeScores(target, e, weights);
      if (!best || s.overall > best.scores.overall) best = { earth: e, scores: s };
    });
    return best;
  }

  const api = {
    PARAMS: PARAMS,
    PARAM_LABELS: PARAM_LABELS,
    parameterScores: parameterScores,
    computeScores: computeScores,
    criticalFlags: criticalFlags,
    pointsLost: pointsLost,
    weightRobustness: weightRobustness,
    bestForWeights: bestForWeights,
    constants: {
      THERMAL_MEAN_WEIGHT: THERMAL_MEAN_WEIGHT,
      THERMAL_SWING_WEIGHT: THERMAL_SWING_WEIGHT,
      CRITICAL_WEIGHT: CRITICAL_WEIGHT,
      LOW_SCORE: LOW_SCORE
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.DarkAeroScoring = api;
})(typeof window !== "undefined" ? window : globalThis);
