/**
 * Dark Aero v4.2 - Interactive CSA RADARSAT-1 / RCM SAR Polarimetry & Rover Slip Module
 * Converts C-band HH/HV radar backscatter (dB) and incidence angle into surface roughness,
 * Circular Polarization Ratio (CPR) proxy, and planetary rover wheel-slip risk in real time.
 */

window.SarPolarimetryLab = (function () {
  function computeSarMetrics(sigmaHhDb, sigmaHvDb, incidenceDeg, slopeDeg, gravityMs2) {
    const incRad = (incidenceDeg * Math.PI) / 180.0;
    const depolarizationDb = sigmaHvDb - sigmaHhDb;

    const cosCorrection = Math.pow(Math.cos(incRad), 1.5);
    const correctedHhDb = sigmaHhDb - 10.0 * Math.log10(Math.max(cosCorrection, 0.1));
    const roughnessIndex = Math.min(1.0, Math.max(0.0, (correctedHhDb + 18.0) / 16.0));
    const estimatedCpr = Math.min(1.2, Math.max(0.15, 0.85 + depolarizationDb * 0.045));

    const gravityFactor = 9.81 / Math.max(gravityMs2 || 1.62, 1.0);
    const rawSlip =
      (slopeDeg / 25.0) * 36.0 +
      roughnessIndex * 24.0 +
      Math.log10(gravityFactor) * 12.0;
    const wheelSlipPct = Math.min(98.0, Math.max(3.0, rawSlip));

    let terrainClass = "Moderately Rough Regolith";
    if (roughnessIndex >= 0.75) {
      terrainClass = "Blocky Basalt / Ejecta";
    } else if (roughnessIndex <= 0.45) {
      terrainClass = "Smooth Aeolian Playa";
    }

    return {
      depolarizationDb: Number(depolarizationDb.toFixed(2)),
      correctedHhDb: Number(correctedHhDb.toFixed(2)),
      roughnessIndex: Number(roughnessIndex.toFixed(3)),
      estimatedCpr: Number(estimatedCpr.toFixed(3)),
      wheelSlipPct: Number(wheelSlipPct.toFixed(1)),
      terrainClass: terrainClass
    };
  }

  return {
    computeSarMetrics: computeSarMetrics
  };
})();
