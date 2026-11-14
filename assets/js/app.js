/**
 * Dark Aero v4.2 - Aerospace Mission Control Controller
 * Fixed-Viewport Single-Screen Architecture (100vh)
 * Features:
 * 1. Keyless Esri Orbital Satellite + NASA Worldview GIBS WMTS Map
 * 2. Interactive 3D Planetary Target Globe (Moon & Mars)
 * 3. Live NASA Langley POWER Satellite API Coordinate Scanner (with localStorage persistence)
 * 4. Rover Traverse & EVA Route Polyline Planner (Haversine Distance + Wh Energy Estimator)
 * 5. Head-to-Head A/B Earth Analog Comparator (3-Dataset Radar + Parameter Winner Table)
 * 6. 24-Hour Diurnal Thermal Cycle Chart (Day/Night Kelvin Swing)
 * 7. Interactive CSA RADARSAT SAR Polarimetry Lab + Hardware Stress Simulator
 * 8. 60-Second Judge Guided Tour
 */

(function () {
  const dataset = window.DARK_AERO_DATA;
  const Scoring = window.DarkAeroScoring;
  // v42: older saved scans used placeholder (non-measured) slope/roughness values, so they are not restored.
  const STORAGE_KEY = "dark_aero_v42_custom_scans";
  const TOUR_SEEN_KEY = "dark_aero_v42_tour_seen";
  const ROBUSTNESS_DRAWS = 2000;
  const prefersReducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Restore any user-scanned NASA POWER locations from localStorage
  try {
    const savedScans = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(savedScans) && savedScans.length > 0) {
      savedScans.forEach((scan) => {
        if (!dataset.earth_analogs.some((e) => e.id === scan.id)) {
          dataset.earth_analogs.push(scan);
        }
      });
    }
  } catch (e) {
    // Ignore storage access errors in restricted contexts
  }

  let currentTargetId = dataset.target_bases[0].id;
  let selectedEarthId = dataset.earth_analogs[0].id;
  let compareSiteBId = dataset.earth_analogs[1].id;
  let selectedHardwareId = "ltv_rover";
  let searchFilterText = "";

  let map = null;
  let markersLayer = null;
  let customScanMarker = null;
  let lastScannedCandidate = null;

  let traverseModeActive = false;
  let traverseWaypoints = [];
  let traversePolyline = null;
  let traverseMarkersLayer = null;

  let radarChart = null;
  let abRadarChart = null;
  let diurnalChart = null;

  const weights = {
    geology: 0.25,
    roughness: 0.20,
    slope: 0.15,
    thermal: 0.15,
    aridity: 0.15,
    ice: 0.10
  };

  const MISSION_PRESETS = {
    balanced: { geology: 25, roughness: 20, slope: 15, thermal: 15, aridity: 15, ice: 10 },
    isru_ice: { geology: 15, roughness: 15, slope: 10, thermal: 20, aridity: 10, ice: 30 },
    rover_mobility: { geology: 15, roughness: 35, slope: 30, thermal: 5, aridity: 10, ice: 5 },
    lava_habitat: { geology: 40, roughness: 20, slope: 15, thermal: 10, aridity: 10, ice: 5 }
  };

  // ============================================================================
  // 1. SIMILARITY & HARDWARE ENGINEERING ENGINE
  // ============================================================================
  function computeCustomScore(target, earth) {
    // Shared engine (assets/js/scoring.js) - identical maths to the Python engine.
    return Scoring.computeScores(target, earth, weights);
  }

  function computeHardwareTelemetry(target, earth, hardwareId) {
    const gravityRatio = 9.81 / (target.gravity_m_s2 || 1.62);
    const deltaTempK = Math.abs(earth.mean_temp_k - target.mean_temp_k);

    let slipRiskPct = (earth.slope_deg / 25.0) * 36.0 + earth.sar_roughness * 24.0 + Math.log10(gravityRatio) * 12.0;
    let powerLoadW = 420 + earth.sar_roughness * 380 + earth.ice_potential * 310;
    let abrasiveWearPct = earth.basalt_index * 48.0 + earth.sar_roughness * 39.0;

    if (hardwareId === "xemu_suit") {
      slipRiskPct *= 0.85;
      powerLoadW = 185 + deltaTempK * 1.45;
      abrasiveWearPct = earth.sar_roughness * 55.0 + earth.aridity_index * 28.0;
    } else if (hardwareId === "trident_drill") {
      slipRiskPct = earth.sar_roughness * 42.0 + (1.0 - earth.ice_potential) * 25.0;
      powerLoadW = 780 + earth.basalt_index * 420 + earth.ice_potential * 290;
      abrasiveWearPct = earth.basalt_index * 58.0 + earth.sar_roughness * 34.0;
    } else if (hardwareId === "fission_habitat") {
      slipRiskPct = (earth.slope_deg / 20.0) * 45.0;
      powerLoadW = 1250 + deltaTempK * 3.2;
      abrasiveWearPct = (1.0 - earth.aridity_index) * 35.0 + earth.sar_roughness * 30.0;
    }

    slipRiskPct = Math.min(98, Math.max(4, Number(slipRiskPct.toFixed(1))));
    powerLoadW = Math.round(powerLoadW);
    abrasiveWearPct = Math.min(98, Math.max(8, Number(abrasiveWearPct.toFixed(1))));

    const isOptimal = slipRiskPct < 48 && abrasiveWearPct < 78;
    return {
      slipRiskPct,
      deltaTempK: Number(deltaTempK.toFixed(1)),
      powerLoadW,
      abrasiveWearPct,
      verdictClass: isOptimal ? "optimal" : "moderate",
      verdictText: isOptimal
        ? "OPTIMAL ANALOG TESTBED — High Mechanical Fidelity"
        : "MODERATE STRESS — Active Suspension / Thermal Control"
    };
  }

  // ============================================================================
  // 2. INTERACTIVE 3D PLANETARY TARGET GLOBE
  // ============================================================================
  const globeState = {
    rotLon: 0,
    rotLat: -25,
    targetLon: 0,
    targetLat: -89.9,
    body: "Moon",
    isDragging: false,
    lastX: 0,
    lastY: 0
  };

  function initPlanetaryGlobe() {
    const canvas = document.getElementById("planetaryGlobeCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    canvas.addEventListener("mousedown", (e) => {
      globeState.isDragging = true;
      globeState.lastX = e.clientX;
      globeState.lastY = e.clientY;
    });

    window.addEventListener("mouseup", () => {
      globeState.isDragging = false;
    });

    // Touch support (tablets / phones)
    canvas.addEventListener(
      "touchstart",
      (e) => {
        if (!e.touches.length) return;
        globeState.isDragging = true;
        globeState.lastX = e.touches[0].clientX;
        globeState.lastY = e.touches[0].clientY;
      },
      { passive: true }
    );
    canvas.addEventListener(
      "touchmove",
      (e) => {
        if (!globeState.isDragging || !e.touches.length) return;
        const t = e.touches[0];
        globeState.rotLon += (t.clientX - globeState.lastX) * 0.8;
        globeState.rotLat = Math.max(-85, Math.min(85, globeState.rotLat + (t.clientY - globeState.lastY) * 0.8));
        globeState.lastX = t.clientX;
        globeState.lastY = t.clientY;
      },
      { passive: true }
    );
    window.addEventListener("touchend", () => {
      globeState.isDragging = false;
    });

    window.addEventListener("mousemove", (e) => {
      if (!globeState.isDragging) return;
      const dx = e.clientX - globeState.lastX;
      const dy = e.clientY - globeState.lastY;
      globeState.rotLon += dx * 0.8;
      globeState.rotLat = Math.max(-85, Math.min(85, globeState.rotLat + dy * 0.8));
      globeState.lastX = e.clientX;
      globeState.lastY = e.clientY;
    });

    function project3D(latDeg, lonDeg, radius, cx, cy) {
      const lat = (latDeg * Math.PI) / 180;
      const lon = ((lonDeg - globeState.rotLon) * Math.PI) / 180;
      const tilt = (globeState.rotLat * Math.PI) / 180;

      const x = Math.cos(lat) * Math.sin(lon);
      const y = Math.sin(lat) * Math.cos(tilt) - Math.cos(lat) * Math.cos(lon) * Math.sin(tilt);
      const z = Math.sin(lat) * Math.sin(tilt) + Math.cos(lat) * Math.cos(lon) * Math.cos(tilt);

      return { px: cx + x * radius, py: cy - y * radius, z: z };
    }

    function renderGlobeFrame() {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const r = w * 0.42;

      ctx.clearRect(0, 0, w, h);

      if (!globeState.isDragging && !prefersReducedMotion) {
        globeState.rotLon = (globeState.rotLon + 0.32) % 360;
      }

      const isMoon = globeState.body === "Moon";

      ctx.beginPath();
      ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
      ctx.strokeStyle = isMoon ? "rgba(56, 189, 248, 0.28)" : "rgba(245, 158, 11, 0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();

      const grad = ctx.createRadialGradient(cx - r * 0.32, cy - r * 0.32, r * 0.08, cx, cy, r);
      if (isMoon) {
        grad.addColorStop(0, "#94a3b8");
        grad.addColorStop(0.55, "#475569");
        grad.addColorStop(1, "#090d16");
      } else {
        grad.addColorStop(0, "#fb923c");
        grad.addColorStop(0.55, "#b45309");
        grad.addColorStop(1, "#1c0a04");
      }

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.lineWidth = 0.65;
      ctx.strokeStyle = isMoon ? "rgba(148, 163, 184, 0.22)" : "rgba(253, 186, 116, 0.22)";

      for (let lon = -180; lon < 180; lon += 45) {
        ctx.beginPath();
        let started = false;
        for (let lat = -80; lat <= 80; lat += 10) {
          const pt = project3D(lat, lon, r, cx, cy);
          if (pt.z > 0) {
            if (!started) {
              ctx.moveTo(pt.px, pt.py);
              started = true;
            } else {
              ctx.lineTo(pt.px, pt.py);
            }
          } else {
            started = false;
          }
        }
        ctx.stroke();
      }

      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath();
        let started = false;
        for (let lon = -180; lon <= 180; lon += 10) {
          const pt = project3D(lat, lon, r, cx, cy);
          if (pt.z > 0) {
            if (!started) {
              ctx.moveTo(pt.px, pt.py);
              started = true;
            } else {
              ctx.lineTo(pt.px, pt.py);
            }
          } else {
            started = false;
          }
        }
        ctx.stroke();
      }

      const targetPt = project3D(globeState.targetLat, globeState.targetLon, r, cx, cy);
      if (targetPt.z > -0.15) {
        ctx.beginPath();
        ctx.arc(targetPt.px, targetPt.py, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = isMoon ? "#38bdf8" : "#fbbf24";
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(targetPt.px, targetPt.py, 8.5, 0, Math.PI * 2);
        ctx.strokeStyle = isMoon ? "rgba(56, 189, 248, 0.65)" : "rgba(251, 191, 36, 0.65)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      requestAnimationFrame(renderGlobeFrame);
    }

    renderGlobeFrame();
  }

  function syncGlobeToTarget(target) {
    globeState.body = target.body;
    globeState.targetLat = target.coordinates[0];
    globeState.targetLon = target.coordinates[1];
    globeState.rotLat = Math.max(-70, Math.min(70, target.coordinates[0] * 0.6));
    globeState.rotLon = target.coordinates[1];

    const badge = document.getElementById("globeBodyBadge");
    badge.textContent = `${target.body.toUpperCase()} TARGET`;
    badge.className = `globe-body-badge ${target.body.toLowerCase()}`;

    document.getElementById("globeCoordText").textContent =
      `${target.coordinates[0].toFixed(1)}°, ${target.coordinates[1].toFixed(1)}°`;
    document.getElementById("globeGravityText").textContent = `${target.gravity_m_s2} m/s²`;
    document.getElementById("globeSolarText").textContent = `${target.solar_irradiance_w_m2} W/m²`;
  }

  // ============================================================================
  // 3. SATELLITE MAP, ROVER TRAVERSE PLANNER & LIVE NASA POWER SCANNER
  // ============================================================================
  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371.0;
    const dLat = ((lat2 - lat1) * Math.PI) / 180.0;
    const dLon = ((lon2 - lon1) * Math.PI) / 180.0;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180.0) *
        Math.cos((lat2 * Math.PI) / 180.0) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function updateTraverseTelemetry() {
    const distEl = document.getElementById("traverseDistanceText");
    const energyEl = document.getElementById("traverseEnergyText");
    const timeEl = document.getElementById("traverseTimeText");
    const hazardEl = document.getElementById("traverseHazardText");

    if (traverseWaypoints.length < 2) {
      distEl.textContent = "0.00 km";
      energyEl.textContent = "0 Wh";
      timeEl.textContent = "0.0 hrs";
      hazardEl.textContent = traverseWaypoints.length === 1 ? "Click WP-2..." : "Standby";
      return;
    }

    let totalKm = 0.0;
    for (let i = 1; i < traverseWaypoints.length; i++) {
      totalKm += haversineKm(
        traverseWaypoints[i - 1][0],
        traverseWaypoints[i - 1][1],
        traverseWaypoints[i][0],
        traverseWaypoints[i][1]
      );
    }

    const earth = dataset.earth_analogs.find((e) => e.id === selectedEarthId) || dataset.earth_analogs[0];
    const target = dataset.target_bases.find((t) => t.id === currentTargetId);

    const whPerKm = 145 + earth.slope_deg * 12.5 + earth.sar_roughness * 95 + target.gravity_m_s2 * 18;
    const totalWh = Math.round(totalKm * whPerKm);
    const nominalSpeedKmh = Math.max(2.5, 9.5 - earth.sar_roughness * 4.2);
    const estHours = (totalKm / nominalSpeedKmh).toFixed(1);

    distEl.textContent = `${totalKm.toFixed(2)} km`;
    energyEl.textContent = `${totalWh.toLocaleString()} Wh`;
    timeEl.textContent = `${estHours} hrs`;
    hazardEl.textContent =
      earth.slope_deg > 13.5 ? "HIGH GRADE" : earth.slope_deg > 8.5 ? "MODERATE" : "NOMINAL";
  }

  function clearRoverTraverse() {
    traverseWaypoints = [];
    if (traversePolyline) {
      map.removeLayer(traversePolyline);
      traversePolyline = null;
    }
    if (traverseMarkersLayer) {
      traverseMarkersLayer.clearLayers();
    }
    updateTraverseTelemetry();
  }

  function initMap() {
    map = L.map("map", {
      center: [22.0, -25.0],
      zoom: 2,
      minZoom: 2,
      maxZoom: 17,
      worldCopyJump: true
    });

    const esriSatellite = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "Esri, Maxar & NASA Space Apps",
        maxNativeZoom: 17,
        maxZoom: 17
      }
    ).addTo(map);

    const nasaTrueColor = L.tileLayer(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2025-07-15/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",
      {
        attribution: "NASA Earthdata / Worldview GIBS",
        maxNativeZoom: 9,
        maxZoom: 17
      }
    );

    const nasaBlueMarble = L.tileLayer(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
      {
        attribution: "NASA GIBS Blue Marble",
        maxNativeZoom: 8,
        maxZoom: 17
      }
    );

    const openTopo = L.tileLayer(
      "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      {
        attribution: "OpenTopoMap & SRTM DEM",
        maxNativeZoom: 15,
        maxZoom: 17
      }
    );

    const nasaSurfaceTemp = L.tileLayer(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Land_Surface_Temp_Day/default/2025-07-15/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png",
      {
        attribution: "NASA MODIS LST",
        maxNativeZoom: 7,
        maxZoom: 17,
        opacity: 0.65
      }
    );

    L.control
      .layers(
        {
          "Orbital Satellite (Esri World Imagery)": esriSatellite,
          "NASA Worldview True Color (MODIS)": nasaTrueColor,
          "NASA Blue Marble (Cloud-Free)": nasaBlueMarble,
          "Elevation Contours (SRTM/OpenTopo)": openTopo
        },
        {
          "NASA Land Surface Temperature (MODIS)": nasaSurfaceTemp
        }
      )
      .addTo(map);

    // Graceful degradation when tile servers are unreachable (offline venue Wi-Fi etc.)
    const notice = document.getElementById("mapOfflineNotice");
    let tileErrors = 0;
    [esriSatellite, nasaTrueColor, nasaBlueMarble, openTopo, nasaSurfaceTemp].forEach((layer) => {
      layer.on("tileerror", () => {
        tileErrors++;
        if (tileErrors > 4 && notice) notice.hidden = false;
      });
      layer.on("tileload", () => {
        if (notice && tileErrors > 0) {
          tileErrors = 0;
          notice.hidden = true;
        }
      });
    });

    // Legend explaining the marker colours
    const legend = L.control({ position: "bottomleft" });
    legend.onAdd = function () {
      const div = L.DomUtil.create("div", "map-legend");
      div.innerHTML =
        '<span><i style="background:#38bdf8"></i>Selected</span>' +
        '<span><i style="background:#10b981"></i>#1 match</span>' +
        '<span><i style="background:#64748b"></i>Other analogs</span>' +
        '<span><i style="background:#f59e0b"></i>Live scan</span>';
      return div;
    };
    legend.addTo(map);

    markersLayer = L.layerGroup().addTo(map);
    traverseMarkersLayer = L.layerGroup().addTo(map);

    const toggleTraverseBtn = document.getElementById("toggleTraverseBtn");
    const clearTraverseBtn = document.getElementById("clearTraverseBtn");

    toggleTraverseBtn.addEventListener("click", () => {
      traverseModeActive = !traverseModeActive;
      toggleTraverseBtn.classList.toggle("active-mode", traverseModeActive);
      toggleTraverseBtn.textContent = traverseModeActive
        ? "Traverse Mode: ON"
        : "Plot Rover Traverse";
    });

    clearTraverseBtn.addEventListener("click", () => {
      clearRoverTraverse();
      clearScanSelection();
    });

    enableMapClickController();
  }

  // ---- Live data helpers -----------------------------------------------------
  let scanSequence = 0;
  const DEFAULT_SCAN_HINT =
    "Click any coordinate on Earth to fetch live NASA satellite temperature, precip & solar flux.";

  /** Removes the yellow scan marker, cancels any in-flight scan and resets the scanner strip. */
  function clearScanSelection() {
    scanSequence++; // invalidates a pending scan so a late response cannot bring the marker back
    if (customScanMarker && map) map.removeLayer(customScanMarker);
    customScanMarker = null;
    lastScannedCandidate = null;
    const statusText = document.getElementById("scannerStatusText");
    const addBtn = document.getElementById("addScannedSiteBtn");
    if (statusText) statusText.textContent = DEFAULT_SCAN_HINT;
    if (addBtn) addBtn.style.display = "none";
  }

  /** Deletes a saved live-scan site (memory + localStorage). */
  function removeSavedScan(id) {
    const idx = dataset.earth_analogs.findIndex((e) => e.id === id && e.is_live_scan);
    if (idx === -1) return;
    dataset.earth_analogs.splice(idx, 1);
    try {
      const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.filter((e) => e.id !== id)));
    } catch (e) {
      /* storage unavailable */
    }
    if (selectedEarthId === id) selectedEarthId = dataset.earth_analogs[0].id;
    if (compareSiteBId === id) compareSiteBId = dataset.earth_analogs[1].id;
    populateCompareDropdowns();
    refreshDashboard(false);
  }

  async function fetchJson(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (err && err.name === "AbortError") throw new Error("timed out");
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // NASA POWER uses -999 as a "no data" fill value.
  function validPower(v) {
    return typeof v === "number" && isFinite(v) && v > -900;
  }

  async function fetchPowerClimatology(lat, lon) {
    const url =
      "https://power.larc.nasa.gov/api/temporal/climatology/point" +
      "?parameters=TS,T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN&community=SB" +
      `&longitude=${lon}&latitude=${lat}&format=JSON`;
    const json = await fetchJson(url, 15000);
    const p = json && json.properties && json.properties.parameter;
    if (!p || !p.TS) throw new Error("no data returned");
    const out = {
      ts: p.TS.ANN,
      t2mMax: p.T2M_MAX ? p.T2M_MAX.ANN : NaN,
      t2mMin: p.T2M_MIN ? p.T2M_MIN.ANN : NaN,
      precip: p.PRECTOTCORR ? p.PRECTOTCORR.ANN : NaN,
      solar: p.ALLSKY_SFC_SW_DWN ? p.ALLSKY_SFC_SW_DWN.ANN : NaN
    };
    if (!validPower(out.ts) || !validPower(out.precip)) throw new Error("no valid data at this location");
    return out;
  }

  /**
   * Real elevation + regional slope from a ~90 m DEM (Open-Meteo elevation API, Copernicus GLO-90).
   * Slope = central differences over a ~1 km cross around the clicked point.
   */
  async function fetchTerrain(lat, lon) {
    const clampLat = (v) => Math.max(-89.99, Math.min(89.99, v));
    const clampLon = (v) => Math.max(-180, Math.min(180, v));
    const d = 0.01;
    const dLon = d / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const pts = [
      [lat, lon],
      [clampLat(lat + d), lon],
      [clampLat(lat - d), lon],
      [lat, clampLon(lon + dLon)],
      [lat, clampLon(lon - dLon)]
    ];
    const url =
      "https://api.open-meteo.com/v1/elevation" +
      `?latitude=${pts.map((q) => q[0].toFixed(5)).join(",")}` +
      `&longitude=${pts.map((q) => q[1].toFixed(5)).join(",")}`;
    const json = await fetchJson(url, 10000);
    const z = json && json.elevation;
    if (!Array.isArray(z) || z.length !== 5 || z.some((v) => typeof v !== "number")) {
      throw new Error("no elevation data");
    }
    const nsMeters = haversineKm(pts[2][0], pts[2][1], pts[1][0], pts[1][1]) * 1000;
    const ewMeters = haversineKm(pts[4][0], pts[4][1], pts[3][0], pts[3][1]) * 1000;
    const dzdy = nsMeters > 0 ? (z[1] - z[2]) / nsMeters : 0;
    const dzdx = ewMeters > 0 ? (z[3] - z[4]) / ewMeters : 0;
    const slopeDeg = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
    return { elevation: Math.round(z[0]), slopeDeg: Number(slopeDeg.toFixed(1)) };
  }

  /**
   * Builds an Earth-analog candidate from a live scan. Every parameter carries a data-basis tag:
   *   measured  = taken directly from a satellite/climatology product
   *   derived   = computed from measured data with a documented rule
   *   estimated = heuristic proxy
   *   assumed   = neutral default (no data available in-browser)
   */
  function buildScanCandidate(lat, lon, power, terrain) {
    const meanTempK = Number((power.ts + 273.15).toFixed(2));
    const hasRange = validPower(power.t2mMax) && validPower(power.t2mMin) && power.t2mMax > power.t2mMin;
    const tMin = hasRange ? power.t2mMin + 273.15 : meanTempK - 12;
    const tMax = hasRange ? power.t2mMax + 273.15 : meanTempK + 12;
    const annualPrecipMm = Number((power.precip * 365).toFixed(1));
    const aridity = Number(Math.max(0.05, Math.min(0.99, 1.0 - annualPrecipMm / 950.0)).toFixed(2));
    const ice = power.ts < -2.0 ? 0.9 : power.ts < 5.0 ? 0.55 : 0.15;
    const slope = terrain ? terrain.slopeDeg : 8.0;
    const roughness = Number(Math.max(0.35, Math.min(0.9, 0.4 + slope * 0.02)).toFixed(2));
    const solar = validPower(power.solar) ? Number(power.solar.toFixed(2)) : null;

    const basis = {
      geology: "assumed",
      roughness: "estimated",
      slope: terrain ? "derived" : "assumed",
      thermal: hasRange ? "measured" : "derived",
      aridity: "derived",
      ice: "estimated"
    };
    const live = Object.values(basis).filter((b) => b === "measured" || b === "derived").length;

    return {
      id: `custom_scan_${Date.now()}`,
      name: `Live Scan (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`,
      country: "User-scanned location",
      coordinates: [lat, lon],
      elevation_m: terrain ? terrain.elevation : 0,
      mean_temp_k: meanTempK,
      temp_extremes_k: [Number(tMin.toFixed(1)), Number(tMax.toFixed(1))],
      slope_deg: slope,
      basalt_index: 0.5,
      sar_roughness: roughness,
      aridity_index: aridity,
      ice_potential: ice,
      annual_precip_mm: annualPrecipMm,
      agency_sources: [
        "NASA POWER climatology (TS, T2M_MAX/MIN, PRECTOTCORR)",
        terrain ? "Copernicus GLO-90 DEM via Open-Meteo" : "DEM unavailable (slope assumed)"
      ],
      best_for: ["Custom Field Trial", solar !== null ? `Solar: ${solar} kWh/m²/d` : "Solar: n/a"],
      geological_summary:
        `Live scan: ${meanTempK} K mean skin temperature, ${annualPrecipMm} mm/yr precipitation` +
        (terrain ? `, ~${slope}° regional slope at ${terrain.elevation} m.` : ".") +
        " Basalt geology is an assumed neutral value (0.5) and SAR roughness is a slope-based proxy; treat the match as a first-pass screen.",
      gibs_layer_focus: "MODIS_Terra_CorrectedReflectance_TrueColor",
      data_basis: basis,
      live_params: live,
      heritage: "",
      is_live_scan: true
    };
  }

  function enableMapClickController() {
    const statusText = document.getElementById("scannerStatusText");
    const addBtn = document.getElementById("addScannedSiteBtn");

    map.on("click", async function (e) {
      // wrap() keeps longitude inside -180..180 (the map repeats horizontally, the APIs do not)
      const wrapped = e.latlng.wrap();
      const lat = Number(wrapped.lat.toFixed(4));
      const lon = Number(wrapped.lng.toFixed(4));

      if (traverseModeActive) {
        traverseWaypoints.push([lat, lon]);
        const wpIdx = traverseWaypoints.length;

        const wpMarker = L.circleMarker([lat, lon], {
          radius: 5,
          fillColor: "#38bdf8",
          color: "#ffffff",
          weight: 1.5,
          fillOpacity: 1
        }).bindTooltip(`WP-${wpIdx}`, { permanent: true, direction: "top" });
        traverseMarkersLayer.addLayer(wpMarker);

        if (traversePolyline) {
          map.removeLayer(traversePolyline);
        }
        traversePolyline = L.polyline(traverseWaypoints, {
          color: "#38bdf8",
          weight: 2.5,
          dashArray: "5, 5"
        }).addTo(map);

        updateTraverseTelemetry();
        return;
      }

      const target = dataset.target_bases.find((t) => t.id === currentTargetId);

      if (customScanMarker) {
        map.removeLayer(customScanMarker);
      }

      customScanMarker = L.circleMarker([lat, lon], {
        radius: 9,
        fillColor: "#f59e0b",
        color: "#ffffff",
        weight: 2,
        fillOpacity: 0.95
      }).addTo(map);

      statusText.innerHTML = `Querying <strong>NASA POWER</strong> + <strong>DEM</strong> at <code>${lat}°, ${lon}°</code>...`;
      addBtn.style.display = "none";
      lastScannedCandidate = null;
      const scanId = ++scanSequence;

      customScanMarker
        .bindPopup(`<strong>Scanning NASA POWER + DEM...</strong><br/>Coords: ${lat}°, ${lon}°`)
        .openPopup();

      const [powerRes, terrainRes] = await Promise.allSettled([fetchPowerClimatology(lat, lon), fetchTerrain(lat, lon)]);
      if (scanId !== scanSequence) return; // a newer click superseded this one

      if (powerRes.status !== "fulfilled") {
        const reason = powerRes.reason && powerRes.reason.message ? powerRes.reason.message : "request failed";
        statusText.innerHTML = `<span style="color:#fb7185;">NASA POWER scan failed (${reason}).</span> Check your connection and click again.`;
        customScanMarker.setPopupContent(`<strong>Scan failed</strong><br/><small>${reason}</small>`);
        return;
      }

      const terrain = terrainRes.status === "fulfilled" ? terrainRes.value : null;
      lastScannedCandidate = buildScanCandidate(lat, lon, powerRes.value, terrain);
      const c = lastScannedCandidate;
      const liveScore = computeCustomScore(target, c);

      statusText.innerHTML = `
        <span><strong>${lat}°, ${lon}°</strong></span> &bull;
        <span>Temp: <strong>${c.mean_temp_k} K</strong></span> &bull;
        <span>Precip: <strong>${c.annual_precip_mm} mm/yr</strong></span> &bull;
        <span>Slope: <strong>${c.slope_deg}°</strong>${terrain ? "" : " (assumed)"}</span> &bull;
        <span>Match: <strong style="color:#34d399;">${liveScore.overall}%</strong></span> &bull;
        <span style="color:#fbbf24;">${c.live_params}/6 live</span>
      `;
      addBtn.style.display = "inline-flex";

      customScanMarker.setPopupContent(`
        <div style="font-family:sans-serif; min-width:215px;">
          <strong style="color:#0284c7;">LIVE SCAN (${c.live_params}/6 live)</strong><br/>
          <small>Coords: ${lat}°, ${lon}°</small>
          <hr style="margin:4px 0; border-color:#cbd5e1;"/>
          <strong>Match vs ${target.name}: <span style="color:#059669;">${liveScore.overall}%</span></strong><br/>
          <small>• Temp: <strong>${c.mean_temp_k} K</strong> (day/night ${c.temp_extremes_k[0]}–${c.temp_extremes_k[1]} K)</small><br/>
          <small>• Precip: <strong>${c.annual_precip_mm} mm/yr</strong></small><br/>
          <small>• Slope (~1 km): <strong>${c.slope_deg}°</strong> &bull; Elev: <strong>${c.elevation_m} m</strong></small><br/>
          <small>• Geology &amp; SAR roughness: <em>assumed</em></small>
        </div>
      `);
    });

    addBtn.addEventListener("click", () => {
      if (!lastScannedCandidate) return;
      const saved = lastScannedCandidate;
      dataset.earth_analogs.push(saved);
      selectedEarthId = saved.id;
      clearScanSelection();

      try {
        const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        existing.push(saved);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
      } catch (e) {}

      populateCompareDropdowns();
      refreshDashboard(false);
    });
  }

  // ============================================================================
  // 4. UI BINDINGS, TABS, PRESETS & DASHBOARD RENDERING
  // ============================================================================
  function populateTargetDropdown() {
    const select = document.getElementById("targetBaseSelect");
    select.innerHTML = "";
    dataset.target_bases.forEach((base) => {
      const opt = document.createElement("option");
      opt.value = base.id;
      opt.textContent = `[${base.body.toUpperCase()}] ${base.name}`;
      select.appendChild(opt);
    });

    select.addEventListener("change", (e) => {
      currentTargetId = e.target.value;
      refreshDashboard(true);
    });
  }

  function populateCompareDropdowns() {
    const selA = document.getElementById("compareSiteASelect");
    const selB = document.getElementById("compareSiteBSelect");
    if (!selA || !selB) return;

    selA.innerHTML = "";
    selB.innerHTML = "";

    dataset.earth_analogs.forEach((site) => {
      const optA = document.createElement("option");
      optA.value = site.id;
      optA.textContent = site.name;
      selA.appendChild(optA);

      const optB = document.createElement("option");
      optB.value = site.id;
      optB.textContent = site.name;
      selB.appendChild(optB);
    });

    selA.value = selectedEarthId;
    if (!dataset.earth_analogs.some((e) => e.id === compareSiteBId)) {
      compareSiteBId = dataset.earth_analogs[1] ? dataset.earth_analogs[1].id : dataset.earth_analogs[0].id;
    }
    selB.value = compareSiteBId;
  }

  function activateInspectorTab(tabId) {
    const tabBtns = document.querySelectorAll(".tab-btn");
    const tabPanes = document.querySelectorAll(".tab-pane");
    tabBtns.forEach((b) => {
      const on = b.dataset.tab === tabId;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    tabPanes.forEach((p) => p.classList.toggle("active", p.id === tabId));
    refreshDashboard(false);
  }

  function bindInspectorTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        activateInspectorTab(btn.dataset.tab);
      });
    });

    document.getElementById("compareSiteASelect").addEventListener("change", (e) => {
      selectedEarthId = e.target.value;
      refreshDashboard(false);
    });

    document.getElementById("compareSiteBSelect").addEventListener("change", (e) => {
      compareSiteBId = e.target.value;
      refreshDashboard(false);
    });
  }

  function bindSarPolarimetryLab() {
    const hhSlider = document.getElementById("sarHhSlider");
    const hvSlider = document.getElementById("sarHvSlider");
    const incSlider = document.getElementById("sarIncSlider");
    const applyBtn = document.getElementById("applySarToSiteBtn");

    function updateSarLabReadout() {
      const hh = parseFloat(hhSlider.value);
      const hv = parseFloat(hvSlider.value);
      const inc = parseFloat(incSlider.value);

      document.getElementById("sarHhVal").textContent = `${hh.toFixed(1)} dB`;
      document.getElementById("sarHvVal").textContent = `${hv.toFixed(1)} dB`;
      document.getElementById("sarIncVal").textContent = `${inc}°`;

      const earth = dataset.earth_analogs.find((e) => e.id === selectedEarthId) || dataset.earth_analogs[0];
      const target = dataset.target_bases.find((t) => t.id === currentTargetId);

      const sarRes = window.SarPolarimetryLab.computeSarMetrics(
        hh,
        hv,
        inc,
        earth.slope_deg,
        target.gravity_m_s2
      );

      document.getElementById("sarDepolVal").textContent = `${sarRes.depolarizationDb} dB`;
      document.getElementById("sarCorrHhVal").textContent = `${sarRes.correctedHhDb} dB`;
      document.getElementById("sarRoughnessVal").textContent = `${sarRes.roughnessIndex}`;
      document.getElementById("sarCprVal").textContent = `${sarRes.estimatedCpr} vs ${target.radar_cpr}`;
      document.getElementById("sarSlipVal").textContent = `${sarRes.wheelSlipPct}%`;
      document.getElementById("sarTerrainClassText").textContent = sarRes.terrainClass;

      return sarRes;
    }

    hhSlider.addEventListener("input", updateSarLabReadout);
    hvSlider.addEventListener("input", updateSarLabReadout);
    incSlider.addEventListener("input", updateSarLabReadout);

    applyBtn.addEventListener("click", () => {
      const sarRes = updateSarLabReadout();
      const earth = dataset.earth_analogs.find((e) => e.id === selectedEarthId);
      if (earth) {
        earth.sar_roughness = sarRes.roughnessIndex;
        earth.data_basis = Object.assign({}, earth.data_basis || {}, { roughness: "calibrated" });
        refreshDashboard(false);
      }
    });

    updateSarLabReadout();
  }

  function applyWeightPreset(presetKey) {
    const preset = MISSION_PRESETS[presetKey];
    if (!preset) return;
    Object.keys(preset).forEach((k) => {
      weights[k] = preset[k] / 100.0;
      document.getElementById(`weight-${k}`).value = preset[k];
      document.getElementById(`val-${k}`).textContent = `${preset[k]}%`;
    });

    document.querySelectorAll(".preset-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.preset === presetKey);
    });

    refreshDashboard(false);
  }

  function bindSlidersAndPresets() {
    const sliderKeys = ["geology", "roughness", "slope", "thermal", "aridity", "ice"];
    sliderKeys.forEach((key) => {
      const slider = document.getElementById(`weight-${key}`);
      const label = document.getElementById(`val-${key}`);
      slider.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        weights[key] = val / 100.0;
        label.textContent = `${val}%`;
        document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
        refreshDashboard(false);
      });
    });

    document.querySelectorAll(".preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        applyWeightPreset(btn.dataset.preset);
      });
    });

    document.getElementById("resetWeightsBtn").addEventListener("click", () => {
      applyWeightPreset("balanced");
    });

    const searchInput = document.getElementById("candidateSearchInput");
    searchInput.addEventListener("input", (e) => {
      searchFilterText = e.target.value.trim().toLowerCase();
      refreshDashboard(false);
    });

    document.querySelectorAll('input[type="range"]').forEach((input) => {
      const labelSpan = input.parentElement && input.parentElement.querySelector("label span");
      if (labelSpan) input.setAttribute("aria-label", labelSpan.textContent.trim());
    });
    searchInput.setAttribute("aria-label", "Filter analog sites by name, country or use");
    document.getElementById("hardwareSystemSelect").setAttribute("aria-label", "Hardware system to stress-test");

    const hwSelect = document.getElementById("hardwareSystemSelect");
    hwSelect.addEventListener("change", (e) => {
      selectedHardwareId = e.target.value;
      refreshDashboard(false);
    });
  }

  function renderTargetSummary(target) {
    const container = document.getElementById("targetSummaryBox");
    container.innerHTML = `
      <div style="font-family:var(--font-display); font-weight:700; font-size:11px; color:#f1f5f9;">${target.name}</div>
      <div class="rationale-text">${target.mission_rationale}</div>
      <div class="meta-row">
        <span>TEMP: <strong>${target.mean_temp_k}K</strong></span>
        <span>SLOPE: <strong>${target.slope_deg}&deg;</strong></span>
        <span>CPR: <strong>${target.radar_cpr}</strong></span>
      </div>
    `;
    syncGlobeToTarget(target);
  }

  function refreshDashboard(autoSelectTop) {
    const target = dataset.target_bases.find((t) => t.id === currentTargetId);
    renderTargetSummary(target);

    const allRanked = dataset.earth_analogs
      .map((earth) => {
        const scores = computeCustomScore(target, earth);
        return { earth, scores };
      })
      .sort((a, b) => b.scores.overall - a.scores.overall);

    if (autoSelectTop && allRanked.length > 0) {
      selectedEarthId = allRanked[0].earth.id;
      if (allRanked.length > 1) {
        compareSiteBId = allRanked[1].earth.id;
      }
    }

    const selA = document.getElementById("compareSiteASelect");
    const selB = document.getElementById("compareSiteBSelect");
    if (selA) selA.value = selectedEarthId;
    if (selB) selB.value = compareSiteBId;

    const filteredRanked = allRanked.filter((item) => {
      if (!searchFilterText) return true;
      return (
        item.earth.name.toLowerCase().includes(searchFilterText) ||
        item.earth.country.toLowerCase().includes(searchFilterText) ||
        item.earth.best_for.some((tag) => tag.toLowerCase().includes(searchFilterText))
      );
    });

    allRanked.forEach((item, i) => {
      item.rank = i + 1;
    });
    const robustness = Scoring.weightRobustness(target, dataset.earth_analogs, ROBUSTNESS_DRAWS);
    renderRobustnessStrip(allRanked, robustness);
    renderRecommendations(target);

    renderAnalogCards(filteredRanked, robustness);
    renderMapMarkers(allRanked);

    const activeEntry = allRanked.find((r) => r.earth.id === selectedEarthId) || allRanked[0];
    const compareBEntry = allRanked.find((r) => r.earth.id === compareSiteBId) || allRanked[1] || activeEntry;

    renderInspector(target, activeEntry.earth, activeEntry.scores);
    renderWhyTab(target, activeEntry.earth, activeEntry.scores);
    renderHeadToHeadComparator(target, activeEntry, compareBEntry);
    renderDiurnalThermalChart(target, activeEntry.earth);
    updateTraverseTelemetry();
  }

  function shortName(name) {
    return String(name).split(",")[0].replace(/\s*\(.*\)\s*$/, "");
  }

  const PRESET_LABELS = {
    balanced: "Balanced Science",
    isru_ice: "ISRU Ice Mining",
    rover_mobility: "Rover Mobility",
    lava_habitat: "Lava Habitat"
  };

  function renderRobustnessStrip(allRanked, rob) {
    const el = document.getElementById("robustnessStrip");
    if (!el || !allRanked.length) return;
    const leaderEntry = Object.entries(rob).sort((a, b) => b[1].top1Pct - a[1].top1Pct)[0];
    const leader = dataset.earth_analogs.find((e) => e.id === leaderEntry[0]);
    const current = allRanked[0].earth;
    let html =
      `<span class="robust-label">WEIGHT ROBUSTNESS</span> ` +
      `<strong>${shortName(leader.name)}</strong> is #1 in <strong>${leaderEntry[1].top1Pct}%</strong> of ` +
      `${ROBUSTNESS_DRAWS.toLocaleString()} random weightings (top-3: ${leaderEntry[1].top3Pct}%).`;
    if (current.id !== leader.id) {
      html += ` Your current weights favour <strong>${shortName(current.name)}</strong> (#1 in ${rob[current.id].top1Pct}%).`;
    }
    el.innerHTML = html;
  }

  function renderRecommendations(target) {
    const el = document.getElementById("recommendStrip");
    if (!el) return;
    el.innerHTML = "";
    Object.keys(MISSION_PRESETS).forEach((key) => {
      const w = {};
      Object.keys(MISSION_PRESETS[key]).forEach((k) => {
        w[k] = MISSION_PRESETS[key][k] / 100.0;
      });
      const best = Scoring.bestForWeights(target, dataset.earth_analogs, w);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rec-chip";
      btn.title = `Apply the "${PRESET_LABELS[key]}" weights. Best analog: ${best.earth.name}`;
      btn.innerHTML = `<span class="rec-use">${PRESET_LABELS[key]}</span><span class="rec-site"><span class="rec-name">${shortName(best.earth.name)}</span><b>${best.scores.overall}%</b></span>`;
      btn.addEventListener("click", () => applyWeightPreset(key));
      el.appendChild(btn);
    });
  }

  function renderAnalogCards(ranked, rob) {
    const listEl = document.getElementById("analogRankingList");
    listEl.innerHTML = "";

    ranked.forEach((item) => {
      const flags = Scoring.criticalFlags(item.scores.raw, weights);
      const r = rob && rob[item.earth.id];
      const card = document.createElement("div");
      card.className = `analog-card ${item.earth.id === selectedEarthId ? "active" : ""}`;
      card.setAttribute("role", "listitem");
      card.tabIndex = 0;
      card.setAttribute(
        "aria-label",
        `Rank ${item.rank}, ${item.earth.name}, ${item.scores.overall} percent match` +
          (flags.length ? `, warning: ${flags.map((f) => f.label).join(", ")}` : "")
      );
      card.innerHTML = `
        <div>
          <div class="analog-card-header">
            <div class="analog-card-title">#${item.rank} ${item.earth.name}</div>
            <span class="score-badge">${item.scores.overall}%</span>
            ${item.earth.is_live_scan ? `<button type="button" class="card-remove" title="Remove this saved scan" aria-label="Remove saved scan ${item.earth.name}">&#10005;</button>` : ""}
          </div>
          <div style="font-size:10px; color:#64748b; margin-top:1px;">
            ${item.earth.country} &bull; ${item.earth.elevation_m}m
            ${item.earth.is_live_scan ? '&bull; <span class="basis estimated">live scan</span>' : ""}
          </div>
        </div>
        <div>
          <div class="progress-track">
            <div class="progress-fill" style="width:${item.scores.overall}%;"></div>
          </div>
          <div class="card-submetrics">
            <span>GEO:${item.scores.geology}%</span>
            <span>SAR:${item.scores.roughness}%</span>
            <span>SLP:${item.scores.slope}%</span>
            <span>ICE:${item.scores.ice}%</span>
            ${r ? `<span class="rob-tag" title="Share of ${ROBUSTNESS_DRAWS} random weightings where this site ranks #1">#1:${r.top1Pct}%</span>` : ""}
            ${flags.length ? `<span class="warn-tag" title="${flags.map((f) => f.label + " " + f.score + "%").join("; ")}">&#9888; ${flags.map((f) => f.param).join(",")}</span>` : ""}
          </div>
        </div>
      `;
      const choose = () => {
        selectedEarthId = item.earth.id;
        map.flyTo(item.earth.coordinates, 6, { duration: 1.0 });
        refreshDashboard(false);
      };
      const removeBtn = card.querySelector(".card-remove");
      if (removeBtn) {
        removeBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          removeSavedScan(item.earth.id);
        });
        removeBtn.addEventListener("keydown", (ev) => ev.stopPropagation());
      }
      card.addEventListener("click", choose);
      card.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          choose();
        }
      });
      listEl.appendChild(card);
    });
  }

  // "Why this score?" tab: weakest links, points lost, data provenance and field heritage.
  function renderWhyTab(target, earth, scores) {
    const flags = Scoring.criticalFlags(scores.raw, weights);
    const flagEl = document.getElementById("whyFlags");
    flagEl.innerHTML = flags.length
      ? `<div class="flag-banner">&#9888; CRITICAL MISMATCH: ${flags
          .map((f) => `${f.label} ${f.score}%`)
          .join(" &bull; ")} &mdash; the overall ${scores.overall}% hides a failed priority.</div>`
      : `<div class="flag-banner ok">No critical mismatch: every parameter weighted &ge;10% scores &ge;40%.</div>`;

    const lost = Scoring.pointsLost(scores.raw, weights);
    const maxLost = Math.max(5, lost[0].lost);
    document.getElementById("whyLimiting").textContent = `limiting factor: ${lost[0].label}`;
    document.getElementById("whyLostBars").innerHTML = lost
      .map(
        (row) => `
        <div class="lost-row">
          <span class="lost-name">${row.label}</span>
          <span class="lost-track"><span class="lost-fill" style="width:${(row.lost / maxLost) * 100}%;"></span></span>
          <span class="lost-val">&minus;${row.lost} pts <em>(${row.score}%)</em></span>
        </div>`
      )
      .join("");

    const basis = earth.data_basis || {};
    const grid = document.getElementById("whyDataBasis");
    grid.innerHTML = Scoring.PARAMS.map((k) => {
      const b = basis[k] || "curated";
      return `<span class="basis ${b}" title="${Scoring.PARAM_LABELS[k]}: ${b}">${Scoring.PARAM_LABELS[k]} &middot; ${b}</span>`;
    }).join("");
    document.getElementById("whyLiveCount").textContent = earth.is_live_scan
      ? `${earth.live_params}/6 from live data`
      : "curated reference values";

    document.getElementById("whyHeritage").textContent =
      earth.heritage ||
      (earth.is_live_scan
        ? "User-scanned location: no documented analog heritage. Validate with field/literature data before use."
        : "No documented heritage recorded.");

    document.getElementById("whyGravity").textContent =
      `Gravity is 9.81 m/s² on Earth vs ${target.gravity_m_s2} m/s² on ${target.body}. ` +
      `Vacuum, radiation and perchlorate chemistry cannot be reproduced either, so this site tests terrain, thermal ` +
      `and operations, not low-gravity dynamics.`;
  }

  function renderMapMarkers(ranked) {
    markersLayer.clearLayers();

    ranked.forEach((item, idx) => {
      const isSelected = item.earth.id === selectedEarthId;
      const circle = L.circleMarker(item.earth.coordinates, {
        radius: isSelected ? 10 : 7,
        fillColor: isSelected ? "#38bdf8" : idx === 0 ? "#10b981" : "#64748b",
        color: "#06080d",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.92,
        bubblingMouseEvents: false
      });

      circle.bindTooltip(`#${idx + 1} ${shortName(item.earth.name)} · ${item.scores.overall}%`, { direction: "top", offset: [0, -6] });
      circle.bindPopup(`
        <div style="font-family:sans-serif; min-width:195px;">
          <strong style="font-size:12px;">#${idx + 1} ${item.earth.name}</strong><br/>
          <span style="color:#0284c7; font-weight:700;">Analog Match: ${item.scores.overall}%</span><br/>
          <small>${item.earth.country} (${item.earth.coordinates[0].toFixed(2)}°, ${item.earth.coordinates[1].toFixed(2)}°)</small><br/>
          <small>SAR Roughness: ${item.earth.sar_roughness} | Slope: ${item.earth.slope_deg}&deg;</small>
        </div>
      `);

      circle.on("click", () => {
        selectedEarthId = item.earth.id;
        refreshDashboard(false);
      });

      markersLayer.addLayer(circle);
    });
  }

  function buildNormalizedAxisArray(siteObj, isTarget) {
    return [
      Math.round(siteObj.basalt_index * 100),
      Math.round((isTarget ? siteObj.radar_cpr : siteObj.sar_roughness) * 100),
      Math.round(Math.min(100, (siteObj.slope_deg / 20.0) * 100)),
      Math.round(Math.min(100, (siteObj.mean_temp_k / 310.0) * 100)),
      Math.round(siteObj.aridity_index * 100),
      Math.round(siteObj.ice_potential * 100)
    ];
  }

  function renderInspector(target, earth, scores) {
    document.getElementById("inspectorTitle").textContent = earth.name;
    document.getElementById("inspectorSubtitle").textContent =
      `${earth.country} • ${earth.coordinates[0].toFixed(2)}°, ${earth.coordinates[1].toFixed(2)}°` +
      (earth.is_live_scan ? " • LIVE SCAN" : "");
    document.getElementById("inspectorOverallScore").textContent = `${scores.overall}%`;
    document.getElementById("inspectorSummary").textContent = earth.geological_summary;

    document.getElementById("metricTemp").textContent = `${earth.mean_temp_k}K vs ${target.mean_temp_k}K`;
    document.getElementById("metricSlope").textContent = `${earth.slope_deg}° vs ${target.slope_deg}°`;
    document.getElementById("metricSar").textContent = `${earth.sar_roughness} vs ${target.radar_cpr}`;
    document.getElementById("metricPrecip").textContent = `${earth.annual_precip_mm} mm/yr`;

    const hwStats = computeHardwareTelemetry(target, earth, selectedHardwareId);
    document.getElementById("simSlipVal").textContent = `${hwStats.slipRiskPct}%`;
    document.getElementById("simDeltaTempVal").textContent = `Δ${hwStats.deltaTempK}K`;
    document.getElementById("simPowerVal").textContent = `${hwStats.powerLoadW}W`;
    document.getElementById("simWearVal").textContent = `${hwStats.abrasiveWearPct}%`;

    const verdictEl = document.getElementById("simVerdictBanner");
    verdictEl.className = `verdict-banner ${hwStats.verdictClass}`;
    verdictEl.textContent = hwStats.verdictText;

    document.getElementById("inspectorCitationStrip").textContent =
      `SOURCES: ${earth.agency_sources.join(" • ")}`;

    const ctx = document.getElementById("telemetryRadarChart").getContext("2d");
    const labels = ["Geology", "SAR Roughness", "Slope", "Thermal", "Aridity", "Ice ISRU"];

    if (radarChart) {
      radarChart.destroy();
    }

    radarChart = new Chart(ctx, {
      type: "radar",
      data: {
        labels: labels,
        datasets: [
          {
            label: target.name,
            data: buildNormalizedAxisArray(target, true),
            backgroundColor: "rgba(245, 158, 11, 0.16)",
            borderColor: "#f59e0b",
            pointBackgroundColor: "#f59e0b",
            borderWidth: 1.8
          },
          {
            label: earth.name,
            data: buildNormalizedAxisArray(earth, false),
            backgroundColor: "rgba(56, 189, 248, 0.18)",
            borderColor: "#38bdf8",
            pointBackgroundColor: "#38bdf8",
            borderWidth: 1.8
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            angleLines: { color: "rgba(255,255,255,0.07)" },
            grid: { color: "rgba(255,255,255,0.07)" },
            pointLabels: { color: "#94a3b8", font: { size: 9.5, family: "JetBrains Mono" } },
            ticks: { display: false, min: 0, max: 100 }
          }
        },
        plugins: {
          legend: {
            labels: { color: "#cbd5e1", boxWidth: 10, font: { size: 9.5 } }
          }
        }
      }
    });
  }

  // ============================================================================
  // 5. HEAD-TO-HEAD A/B EARTH ANALOG COMPARATOR
  // ============================================================================
  function renderHeadToHeadComparator(target, entryA, entryB) {
    const canvas = document.getElementById("abRadarChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const labels = ["Geology", "SAR", "Slope", "Thermal", "Aridity", "Ice"];
    if (abRadarChart) {
      abRadarChart.destroy();
    }

    abRadarChart = new Chart(ctx, {
      type: "radar",
      data: {
        labels: labels,
        datasets: [
          {
            label: `Target (${target.body})`,
            data: buildNormalizedAxisArray(target, true),
            backgroundColor: "rgba(245, 158, 11, 0.12)",
            borderColor: "#f59e0b",
            borderWidth: 1.6
          },
          {
            label: `A: ${entryA.earth.name}`,
            data: buildNormalizedAxisArray(entryA.earth, false),
            backgroundColor: "rgba(56, 189, 248, 0.18)",
            borderColor: "#38bdf8",
            pointStyle: "circle",
            pointRadius: 3,
            borderWidth: 1.8
          },
          {
            label: `B: ${entryB.earth.name}`,
            data: buildNormalizedAxisArray(entryB.earth, false),
            backgroundColor: "rgba(16, 185, 129, 0.16)",
            borderColor: "#10b981",
            borderDash: [6, 4],
            pointStyle: "rectRot",
            pointRadius: 4,
            borderWidth: 1.8
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            angleLines: { color: "rgba(255,255,255,0.07)" },
            grid: { color: "rgba(255,255,255,0.07)" },
            pointLabels: { color: "#94a3b8", font: { size: 9 } },
            ticks: { display: false, min: 0, max: 100 }
          }
        },
        plugins: {
          legend: {
            labels: { color: "#cbd5e1", boxWidth: 9, font: { size: 9 } }
          }
        }
      }
    });

    const metricsList = [
      { label: "Overall Score", key: "overall" },
      { label: "Basalt Geology", key: "geology" },
      { label: "SAR Roughness", key: "roughness" },
      { label: "Slope Profile", key: "slope" },
      { label: "Thermal Match", key: "thermal" },
      { label: "Aridity & Ice", key: "ice" }
    ];

    const tbody = document.getElementById("abComparisonTableBody");
    tbody.innerHTML = "";

    metricsList.forEach((m) => {
      const valA = entryA.scores[m.key];
      const valB = entryB.scores[m.key];
      const winner = valA > valB ? "Site A" : valB > valA ? "Site B" : "Tie";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${m.label}</td>
        <td style="font-family:var(--font-mono); color:#38bdf8; font-weight:600;">${valA}%</td>
        <td style="font-family:var(--font-mono); color:#34d399; font-weight:600;">${valB}%</td>
        <td><span class="winner-pill">${winner === "Site A" ? "A &#9679;" : winner === "Site B" ? "B &#9670;" : "Tie"}</span></td>
      `;
      tbody.appendChild(tr);
    });

    const overallWinner =
      entryA.scores.overall >= entryB.scores.overall ? entryA.earth.name : entryB.earth.name;
    const diffPct = Math.abs(entryA.scores.overall - entryB.scores.overall).toFixed(1);
    document.getElementById("abWinnerSummary").textContent =
      `PRIMARY TESTBED: ${overallWinner} (+${diffPct}%)`;
  }

  // ============================================================================
  // 6. 24-HOUR DIURNAL THERMAL CYCLE CHART
  // ============================================================================
  function generateDiurnalCurve(minK, maxK) {
    const hours = [0, 3, 6, 9, 12, 15, 18, 21];
    return hours.map((h) => {
      const phase = ((h - 3) / 24.0) * 2 * Math.PI;
      const norm = (1 - Math.cos(phase)) / 2.0;
      return Number((minK + (maxK - minK) * norm).toFixed(1));
    });
  }

  function renderDiurnalThermalChart(target, earth) {
    const canvas = document.getElementById("diurnalThermalChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const tMin = target.temp_extremes_k[0];
    const tMax = target.temp_extremes_k[1];
    const eMin = earth.temp_extremes_k ? earth.temp_extremes_k[0] : Number((earth.mean_temp_k - 12).toFixed(1));
    const eMax = earth.temp_extremes_k ? earth.temp_extremes_k[1] : Number((earth.mean_temp_k + 12).toFixed(1));

    const targetSwing = (tMax - tMin).toFixed(1);
    const earthSwing = (eMax - eMin).toFixed(1);

    document.getElementById("targetDiurnalSwingVal").textContent = `Δ${targetSwing}K (${tMin}–${tMax}K)`;
    document.getElementById("earthDiurnalSwingVal").textContent = `Δ${earthSwing}K (${eMin}–${eMax}K)`;
    document.getElementById("thermalShockVerdict").textContent =
      `DIURNAL SHOCK: ${target.body} Δ${targetSwing}K swing vs ${earth.name} Δ${earthSwing}K`;

    if (diurnalChart) {
      diurnalChart.destroy();
    }

    diurnalChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: ["00h", "03h", "06h", "09h", "12h", "15h", "18h", "21h"],
        datasets: [
          {
            label: `${target.name} (K)`,
            data: generateDiurnalCurve(tMin, tMax),
            borderColor: "#f59e0b",
            backgroundColor: "rgba(245, 158, 11, 0.14)",
            fill: true,
            tension: 0.38,
            borderWidth: 1.8
          },
          {
            label: `${earth.name} (K)`,
            data: generateDiurnalCurve(eMin, eMax),
            borderColor: "#38bdf8",
            backgroundColor: "rgba(56, 189, 248, 0.14)",
            fill: true,
            tension: 0.38,
            borderWidth: 1.8
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: "#64748b", font: { size: 9.5, family: "JetBrains Mono" } },
            grid: { color: "rgba(255, 255, 255, 0.05)" }
          },
          y: {
            ticks: { color: "#94a3b8", font: { size: 9.5, family: "JetBrains Mono" } },
            grid: { color: "rgba(255, 255, 255, 0.05)" }
          }
        },
        plugins: {
          legend: {
            labels: { color: "#cbd5e1", boxWidth: 10, font: { size: 9.5 } }
          }
        }
      }
    });
  }

  // ============================================================================
  // 7. 60-SECOND JUDGE GUIDED TOUR
  // ============================================================================
  function setupJudgeGuidedTour() {
    const popover = document.getElementById("judgeTourPopover");
    const badge = document.getElementById("tourStepBadge");
    const titleEl = document.getElementById("tourStepTitle");
    const descEl = document.getElementById("tourStepDesc");
    const dotsEl = document.getElementById("tourDots");
    const nextBtn = document.getElementById("tourNextBtn");
    const backBtn = document.getElementById("tourBackBtn");
    const closeBtn = document.getElementById("tourCloseBtn");
    const startBtn = document.getElementById("startJudgeTourBtn");

    // target = element that gets the spotlight; pos = where the card sits so it never covers the target
    const steps = [
      {
        target: "#panel-left",
        tabId: "tab-overview",
        pos: { left: "340px", bottom: "20px" },
        title: "Pick a Moon/Mars target & mission profile",
        desc: "Choose an Artemis or Mars base on the 3D globe, then tune the six weights or use a mission preset (ISRU, rover, lava habitat)."
      },
      {
        target: ".map-panel",
        tabId: "tab-overview",
        pos: { right: "20px", bottom: "20px" },
        title: "Map + live scan (2 real datasets)",
        desc: "Click anywhere on Earth: NASA POWER gives real temperature, day/night range and rainfall; a 90 m DEM gives real elevation and slope. Geology and SAR roughness stay labelled 'assumed'."
      },
      {
        target: ".candidates-panel",
        tabId: "tab-overview",
        pos: { left: "350px", top: "64px" },
        title: "Weight robustness & mission picks",
        desc: "Does the winner depend on your weights? The robustness line re-ranks 2,000 random weightings. The four chips show the best analog per mission type, and a click applies it."
      },
      {
        target: "#panel-right",
        tabId: "tab-why",
        pos: { left: "350px", top: "64px" },
        title: "Why this score? (explainability)",
        desc: "See which parameters cost points, whether a critical parameter failed, the data basis of every input and the site's field heritage."
      },
      {
        target: "#panel-right",
        tabId: "tab-overview",
        pos: { left: "350px", top: "64px" },
        title: "Hardware & rover stress simulator",
        desc: "Illustrative wheel-slip, thermal delta, power draw and regolith wear for rovers, suits and drills. Heuristic estimates, not validated vehicle models."
      },
      {
        target: "#panel-right",
        tabId: "tab-compare",
        pos: { left: "350px", top: "64px" },
        title: "Head-to-head A/B comparator",
        desc: "Overlay two analogs (A solid, B dashed) against the target with a parameter-by-parameter winner table."
      },
      {
        target: "#panel-right",
        tabId: "tab-sar",
        pos: { left: "350px", top: "64px" },
        title: "CSA RADARSAT SAR polarimetry lab",
        desc: "Calibrate C-band HH/HV backscatter and incidence angle into a roughness index and a Mini-RF CPR equivalent, then apply it to the selected site."
      }
    ];

    let currentStep = 0;
    let active = false;

    // Progress dots (clickable)
    dotsEl.innerHTML = "";
    steps.forEach((_, i) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "tour-dot";
      dot.setAttribute("aria-label", `Go to step ${i + 1}`);
      dot.addEventListener("click", () => renderTourStep(i));
      dotsEl.appendChild(dot);
    });

    function clearSpotlight() {
      document.querySelectorAll(".tour-highlight").forEach((el) => el.classList.remove("tour-highlight"));
      document.querySelectorAll(".tab-btn.tour-pulse").forEach((el) => el.classList.remove("tour-pulse"));
    }

    function renderTourStep(idx) {
      currentStep = idx;
      active = true;
      const step = steps[idx];
      clearSpotlight();

      const targetEl = document.querySelector(step.target);
      if (targetEl) targetEl.classList.add("tour-highlight");
      activateInspectorTab(step.tabId);
      const tabBtn = document.querySelector(`.tab-btn[data-tab="${step.tabId}"]`);
      if (tabBtn && step.target === "#panel-right") tabBtn.classList.add("tour-pulse");

      badge.textContent = `STEP ${idx + 1} / ${steps.length}`;
      titleEl.textContent = step.title;
      descEl.textContent = step.desc;
      nextBtn.textContent = idx === steps.length - 1 ? "Finish ✓" : "Next →";
      backBtn.disabled = idx === 0;
      Array.from(dotsEl.children).forEach((d, i) => {
        d.classList.toggle("current", i === idx);
        d.classList.toggle("done", i < idx);
        if (i === idx) d.setAttribute("aria-current", "step");
        else d.removeAttribute("aria-current");
      });

      // Place the card beside (never over) the spotlighted panel
      ["left", "right", "top", "bottom"].forEach((side) => {
        popover.style[side] = step.pos[side] || "auto";
      });
      popover.classList.add("open");
      document.body.classList.add("tour-active");
      startBtn.innerHTML = `Tour ${idx + 1}/${steps.length} &middot; End`;
      startBtn.setAttribute("aria-pressed", "true");
      nextBtn.focus({ preventScroll: true });
    }

    function endTour() {
      active = false;
      clearSpotlight();
      popover.classList.remove("open");
      document.body.classList.remove("tour-active");
      startBtn.innerHTML = "&#9654; Guided Tour";
      startBtn.setAttribute("aria-pressed", "false");
    }

    startBtn.addEventListener("click", () => {
      if (active) endTour();
      else renderTourStep(0);
    });

    nextBtn.addEventListener("click", () => {
      if (currentStep < steps.length - 1) renderTourStep(currentStep + 1);
      else endTour();
    });
    backBtn.addEventListener("click", () => {
      if (currentStep > 0) renderTourStep(currentStep - 1);
    });
    closeBtn.addEventListener("click", endTour);

    document.addEventListener("keydown", (e) => {
      if (!active || document.querySelector(".modal-backdrop.open")) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        nextBtn.click();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        backBtn.click();
      } else if (e.key === "Escape") {
        endTour();
      }
    });
  }

  // ============================================================================
  // 8. FULL 60-PAIR MATRIX MODAL & DATA EXPORTS (JSON & CSV)
  // ============================================================================
  // ============================================================================
  // 8b. METHODOLOGY, PROVENANCE & LIMITATIONS MODAL
  // ============================================================================
  function setupMethodologyModal() {
    const modal = document.getElementById("methodModal");
    const openBtn = document.getElementById("openMethodBtn");
    const closeBtn = document.getElementById("closeMethodBtn");
    const body = document.getElementById("methodBody");
    if (!modal || !openBtn) return;

    const rows = (dataset.parameter_methodology || [])
      .map(
        (m) => `<tr>
          <td><strong>${m.label}</strong><br/><small>${m.range}</small></td>
          <td>${m.target_source}</td>
          <td>${m.earth_source}</td>
          <td>${m.similarity}</td>
          <td><span class="basis ${m.status}">${m.status}</span></td>
        </tr>`
      )
      .join("");
    const resRows = (dataset.official_resources || [])
      .map(
        (r) => `<tr><td>${r.agency}</td><td><strong>${r.name}</strong></td><td>${r.use}</td>
          <td><span class="basis ${r.integration === "live" ? "measured" : "curated"}">${r.integration}</span></td></tr>`
      )
      .join("");
    const limits = (dataset.limitations || []).map((l) => `<li>${l}</li>`).join("");

    body.innerHTML = `
      <h3>1. How the score works</h3>
      <p>Every Earth analog is compared with the selected Moon/Mars base on six parameters. Each parameter gets a
      0&ndash;100% similarity, and the overall match is the <strong>weighted average</strong> using the sliders
      (weights are normalised). Defaults: geology 25, SAR roughness 20, slope 15, thermal 15, aridity 15, ice 10.</p>
      <p>The <strong>thermal</strong> score blends mean temperature (60%) with the day/night swing (40%), so a stable
      Arctic site is not mistaken for a thermal twin of a 160 K-swing lunar crater.</p>
      <h3>2. Weakest-link flag</h3>
      <p>A high overall score can hide a failed priority. Any parameter that carries &ge;10% of the weight and scores
      below 40% raises a <span class="basis assumed">&#9888; critical mismatch</span> flag.</p>
      <h3>3. Weight robustness</h3>
      <p>Weights are subjective, so the app draws ${ROBUSTNESS_DRAWS.toLocaleString()} random weight vectors
      (uniform over the 6-parameter simplex, fixed seed) and reports how often each site is #1 / top-3.</p>
      <h3>4. Where the inputs come from</h3>
      <table class="matrix-table method-table"><thead><tr>
        <th>Parameter</th><th>Target (Moon/Mars) source</th><th>Earth analog source</th><th>Similarity</th><th>Status</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <p><strong>curated</strong> = analyst-assigned index informed by the listed agency products (not recomputed from
      raw rasters in this app) &bull; <strong>measured</strong> = read directly from a live product &bull;
      <strong>derived</strong> = computed from measured data by a stated rule &bull; <strong>estimated</strong> = heuristic
      proxy &bull; <strong>assumed</strong> = neutral default &bull; <strong>calibrated</strong> = set by the SAR Lab.</p>
      <h3>5. Live scan</h3>
      <p>Clicking the map fetches <strong>NASA POWER</strong> climatology (skin temperature, 2 m max/min air
      temperature, precipitation) and a <strong>Copernicus GLO-90</strong> elevation cross (via Open-Meteo) to compute
      a ~1 km regional slope. Geology is assumed neutral (0.5) and SAR roughness is a slope-based proxy.</p>
      <h3>6. Challenge resource coverage</h3>
      <table class="matrix-table method-table"><thead><tr><th>Agency</th><th>Resource</th><th>Use in Dark Aero</th><th>Integration</th></tr></thead>
      <tbody>${resRows}</tbody></table>
      <p><strong>live</strong> = fetched or rendered at run time &bull; <strong>reference</strong> = informs the curated indices but is not queried live by the app.</p>
      <h3>7. Limitations</h3>
      <ul>${limits}</ul>
      <p style="color:var(--text-muted);">Scoring is implemented once in <code>assets/js/scoring.js</code> and mirrored in
      <code>scripts/analog_matching_engine.py</code>; <code>tests/parity_test.js</code> verifies they agree.</p>
    `;

    const open = () => {
      modal.classList.add("open");
      closeBtn.focus();
    };
    const close = () => {
      modal.classList.remove("open");
      openBtn.focus();
    };
    openBtn.addEventListener("click", open);
    closeBtn.addEventListener("click", close);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });
  }

  function setupModalAndExports() {
    const modal = document.getElementById("matrixModal");
    const openBtn = document.getElementById("openMatrixModalBtn");
    const closeBtn = document.getElementById("closeMatrixModalBtn");
    const tbody = document.getElementById("matrixTableBody");

    openBtn.addEventListener("click", () => {
      tbody.innerHTML = "";
      dataset.target_bases.forEach((target) => {
        dataset.earth_analogs.forEach((earth) => {
          const s = computeCustomScore(target, earth);
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td><strong>[${target.body}]</strong> ${target.name}</td>
            <td>${earth.name} (${earth.country})</td>
            <td><span class="score-badge">${s.overall}%</span></td>
            <td>${s.geology}%</td>
            <td>${s.roughness}%</td>
            <td>${s.slope}%</td>
            <td>${s.thermal}%</td>
            <td>${s.aridity}%</td>
            <td>${s.ice}%</td>
          `;
          tbody.appendChild(tr);
        });
      });
      modal.classList.add("open");
    });

    closeBtn.addEventListener("click", () => {
      modal.classList.remove("open");
    });

    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.remove("open");
    });

    setupMethodologyModal();
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const openModals = document.querySelectorAll(".modal-backdrop.open");
        if (openModals.length) openModals.forEach((m) => m.classList.remove("open"));
        else if (!document.body.classList.contains("tour-active") && customScanMarker) clearScanSelection();
      }
    });

    document.getElementById("exportJsonBtn").addEventListener("click", () => {
      const target = dataset.target_bases.find((t) => t.id === currentTargetId);
      const report = {
        generated_by: "Dark Aero Planetary Analog Decision Support System v4.2",
        scoring_version: dataset.scoring_version,
        weight_robustness: Scoring.weightRobustness(target, dataset.earth_analogs, ROBUSTNESS_DRAWS),
        target_base: target,
        custom_weights: weights,
        selected_hardware_simulation: selectedHardwareId,
        plotted_rover_traverse_waypoints: traverseWaypoints,
        ranked_analogs: dataset.earth_analogs
          .map((e) => ({
            earth_analog: e.name,
            country: e.country,
            coordinates: e.coordinates,
            similarity_metrics: (({ raw, ...rest }) => rest)(computeCustomScore(target, e)),
            critical_flags: Scoring.criticalFlags(computeCustomScore(target, e).raw, weights),
            data_basis: e.data_basis || "curated (all parameters)",
            hardware_stress_telemetry: computeHardwareTelemetry(target, e, selectedHardwareId),
            agency_datasets: e.agency_sources
          }))
          .sort((a, b) => b.similarity_metrics.overall - a.similarity_metrics.overall)
      };

      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dark_aero_${currentTargetId}_mission_report_v4.2.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById("exportCsvBtn").addEventListener("click", () => {
      const rows = [
        [
          "Target_Body",
          "Target_Base",
          "Earth_Analog_Site",
          "Country",
          "Latitude",
          "Longitude",
          "Overall_Match_Pct",
          "Geology_Pct",
          "SAR_Roughness_Pct",
          "Slope_Pct",
          "Thermal_Pct",
          "Aridity_Pct",
          "Subsurface_Ice_Pct"
        ]
      ];

      dataset.target_bases.forEach((target) => {
        dataset.earth_analogs.forEach((earth) => {
          const s = computeCustomScore(target, earth);
          rows.push([
            target.body,
            `"${target.name}"`,
            `"${earth.name}"`,
            `"${earth.country}"`,
            earth.coordinates[0],
            earth.coordinates[1],
            s.overall,
            s.geology,
            s.roughness,
            s.slope,
            s.thermal,
            s.aridity,
            s.ice
          ]);
        });
      });

      const csvContent = rows.map((r) => r.join(",")).join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "dark_aero_analog_comparison_matrix_v4.2.csv";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initPlanetaryGlobe();
    initMap();
    populateTargetDropdown();
    populateCompareDropdowns();
    bindInspectorTabs();
    bindSarPolarimetryLab();
    bindSlidersAndPresets();
    setupJudgeGuidedTour();
    setupModalAndExports();
    refreshDashboard(true);

    // First visit: show the guided tour automatically (remembered per browser).
    try {
      if (!localStorage.getItem(TOUR_SEEN_KEY)) {
        localStorage.setItem(TOUR_SEEN_KEY, "1");
        setTimeout(() => document.getElementById("startJudgeTourBtn").click(), 700);
      }
    } catch (e) {
      /* storage unavailable: skip auto-start */
    }
  });
})();
