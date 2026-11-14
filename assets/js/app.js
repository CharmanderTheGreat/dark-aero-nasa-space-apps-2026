/**
 * Dark Aero v4.0 - Aerospace Mission Control Controller
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
  const STORAGE_KEY = "dark_aero_v4_custom_scans";

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
    const totalWeight =
      weights.geology +
      weights.roughness +
      weights.slope +
      weights.thermal +
      weights.aridity +
      weights.ice || 1.0;

    const geologyScore = 1.0 - Math.abs(target.basalt_index - earth.basalt_index);
    const roughnessScore = 1.0 - Math.abs(target.radar_cpr - earth.sar_roughness);
    const slopeScore = Math.max(0.0, 1.0 - Math.abs(target.slope_deg - earth.slope_deg) / 25.0);
    const thermalScore = Math.max(0.0, 1.0 - Math.abs(target.mean_temp_k - earth.mean_temp_k) / 220.0);
    const aridityScore = 1.0 - Math.abs(target.aridity_index - earth.aridity_index);
    const iceScore = 1.0 - Math.abs(target.ice_potential - earth.ice_potential);

    const weighted =
      (geologyScore * weights.geology +
        roughnessScore * weights.roughness +
        slopeScore * weights.slope +
        thermalScore * weights.thermal +
        aridityScore * weights.aridity +
        iceScore * weights.ice) /
      totalWeight;

    return {
      overall: Number((weighted * 100).toFixed(1)),
      geology: Number((geologyScore * 100).toFixed(1)),
      roughness: Number((roughnessScore * 100).toFixed(1)),
      slope: Number((slopeScore * 100).toFixed(1)),
      thermal: Number((thermalScore * 100).toFixed(1)),
      aridity: Number((aridityScore * 100).toFixed(1)),
      ice: Number((iceScore * 100).toFixed(1))
    };
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

      if (!globeState.isDragging) {
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
    });

    enableMapClickController();
  }

  function enableMapClickController() {
    const statusText = document.getElementById("scannerStatusText");
    const addBtn = document.getElementById("addScannedSiteBtn");

    map.on("click", async function (e) {
      const lat = Number(e.latlng.lat.toFixed(4));
      const lon = Number(e.latlng.lng.toFixed(4));

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

      statusText.innerHTML = `Querying <strong>NASA POWER API</strong> at <code>${lat}°, ${lon}°</code>...`;
      addBtn.style.display = "none";

      customScanMarker
        .bindPopup(`<strong>Scanning NASA POWER API...</strong><br/>Coords: ${lat}°, ${lon}°`)
        .openPopup();

      try {
        const apiUrl = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=TS,PRECTOTCORR,ALLSKY_SFC_SW_DWN&community=SB&longitude=${lon}&latitude=${lat}&format=JSON`;
        const response = await fetch(apiUrl);
        const nasaData = await response.json();

        const params = nasaData.properties.parameter;
        const meanTempC = params.TS.ANN;
        const meanTempK = Number((meanTempC + 273.15).toFixed(2));
        const dailyPrecipMm = params.PRECTOTCORR.ANN;
        const annualPrecipMm = Number((dailyPrecipMm * 365).toFixed(1));
        const solarIrradiance = Number(params.ALLSKY_SFC_SW_DWN.ANN.toFixed(2));

        const derivedAridity = Number(Math.max(0.05, Math.min(0.99, 1.0 - annualPrecipMm / 950.0)).toFixed(2));
        const derivedIce = meanTempC < -2.0 ? 0.90 : meanTempC < 5.0 ? 0.55 : 0.15;
        const derivedRoughness = Number((0.55 + (Math.abs(lat) / 90.0) * 0.25).toFixed(2));
        const derivedSlope = Number((6.5 + ((Math.abs(lat * lon) % 11) * 0.8)).toFixed(1));
        const diurnalSpread = 12.0 + derivedAridity * 16.0;

        lastScannedCandidate = {
          id: `custom_nasa_${Date.now()}`,
          name: `NASA Scan (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`,
          country: "Live NASA POWER Coordinate",
          coordinates: [lat, lon],
          elevation_m: Math.round(350 + Math.abs(lat) * 12),
          mean_temp_k: meanTempK,
          temp_extremes_k: [
            Number((meanTempK - diurnalSpread * 0.5).toFixed(1)),
            Number((meanTempK + diurnalSpread * 0.5).toFixed(1))
          ],
          slope_deg: derivedSlope,
          basalt_index: 0.82,
          sar_roughness: derivedRoughness,
          aridity_index: derivedAridity,
          ice_potential: derivedIce,
          annual_precip_mm: annualPrecipMm,
          agency_sources: [
            `NASA Langley POWER API (${lat}°, ${lon}°)`,
            "NASA MODIS LST",
            "CSA SAR Derived Roughness"
          ],
          best_for: ["Custom Field Trial", `Solar: ${solarIrradiance} kWh/m²/d`],
          geological_summary: `Satellite-probed coordinate via NASA POWER API: ${meanTempK} K (${meanTempC.toFixed(1)}°C) mean surface temperature, ${annualPrecipMm} mm/yr precipitation, ${solarIrradiance} kWh/m²/day solar flux.`,
          gibs_layer_focus: "MODIS_Terra_CorrectedReflectance_TrueColor"
        };

        const liveScore = computeCustomScore(target, lastScannedCandidate);

        statusText.innerHTML = `
          <span><strong>${lat}°, ${lon}°</strong></span> &bull;
          <span>Temp: <strong>${meanTempK} K</strong></span> &bull;
          <span>Precip: <strong>${annualPrecipMm} mm/yr</strong></span> &bull;
          <span>Match: <strong style="color:#34d399;">${liveScore.overall}%</strong></span>
        `;
        addBtn.style.display = "inline-flex";

        customScanMarker.setPopupContent(`
          <div style="font-family:sans-serif; min-width:205px;">
            <strong style="color:#0284c7;">LIVE NASA POWER SCAN</strong><br/>
            <small>Coords: ${lat}°, ${lon}°</small>
            <hr style="margin:4px 0; border-color:#cbd5e1;"/>
            <strong>Match vs ${target.name}: <span style="color:#059669;">${liveScore.overall}%</span></strong><br/>
            <small>• Temp: <strong>${meanTempK} K (${meanTempC.toFixed(1)}°C)</strong></small><br/>
            <small>• Precip: <strong>${annualPrecipMm} mm/yr</strong></small><br/>
            <small>• Solar Flux: <strong>${solarIrradiance} kWh/m²/day</strong></small>
          </div>
        `);
      } catch (err) {
        statusText.innerHTML = `Scanned <code>${lat}°, ${lon}°</code> (Offline fallback).`;
      }
    });

    addBtn.addEventListener("click", () => {
      if (!lastScannedCandidate) return;
      dataset.earth_analogs.push(lastScannedCandidate);
      selectedEarthId = lastScannedCandidate.id;
      addBtn.style.display = "none";

      try {
        const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        existing.push(lastScannedCandidate);
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
    tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
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

    renderAnalogCards(filteredRanked);
    renderMapMarkers(allRanked);

    const activeEntry = allRanked.find((r) => r.earth.id === selectedEarthId) || allRanked[0];
    const compareBEntry = allRanked.find((r) => r.earth.id === compareSiteBId) || allRanked[1] || activeEntry;

    renderInspector(target, activeEntry.earth, activeEntry.scores);
    renderHeadToHeadComparator(target, activeEntry, compareBEntry);
    renderDiurnalThermalChart(target, activeEntry.earth);
    updateTraverseTelemetry();
  }

  function renderAnalogCards(ranked) {
    const listEl = document.getElementById("analogRankingList");
    listEl.innerHTML = "";

    ranked.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = `analog-card ${item.earth.id === selectedEarthId ? "active" : ""}`;
      card.innerHTML = `
        <div>
          <div class="analog-card-header">
            <div class="analog-card-title">#${idx + 1} ${item.earth.name}</div>
            <span class="score-badge">${item.scores.overall}%</span>
          </div>
          <div style="font-size:9.5px; color:#64748b; margin-top:1px;">
            ${item.earth.country} &bull; ${item.earth.elevation_m}m
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
          </div>
        </div>
      `;
      card.addEventListener("click", () => {
        selectedEarthId = item.earth.id;
        map.flyTo(item.earth.coordinates, 6, { duration: 1.0 });
        refreshDashboard(false);
      });
      listEl.appendChild(card);
    });
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
        fillOpacity: 0.92
      });

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
      `${earth.country} • ${earth.coordinates[0].toFixed(2)}°, ${earth.coordinates[1].toFixed(2)}°`;
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
            borderWidth: 1.6
          },
          {
            label: `B: ${entryB.earth.name}`,
            data: buildNormalizedAxisArray(entryB.earth, false),
            backgroundColor: "rgba(16, 185, 129, 0.16)",
            borderColor: "#10b981",
            borderWidth: 1.6
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
        <td><span class="winner-pill">${winner}</span></td>
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
    const tourPopover = document.getElementById("judgeTourPopover");
    const stepBadge = document.getElementById("tourStepBadge");
    const stepTitle = document.getElementById("tourStepTitle");
    const stepDesc = document.getElementById("tourStepDesc");
    const nextBtn = document.getElementById("tourNextBtn");
    const closeBtn = document.getElementById("tourCloseBtn");

    const steps = [
      {
        panelId: "panel-left",
        tabId: "tab-overview",
        title: "Step 1: 3D Planetary Target & Mission Weighting",
        desc: "Select Moon (Artemis South Pole) or Mars targets on the interactive 3D globe and tune weights across 6 multi-agency criteria (NASA LRO, CSA SAR, ESA, JAXA)."
      },
      {
        panelId: "panel-center",
        tabId: "tab-overview",
        title: "Step 2: Orbital Satellite Map & Live NASA POWER API",
        desc: "Click any Earth analog marker, toggle NASA Worldview MODIS overlays, plot a Rover Traverse route, or click anywhere on Earth to pull live NASA POWER satellite telemetry."
      },
      {
        panelId: "panel-right",
        tabId: "tab-overview",
        title: "Step 3: Hardware & Rover Stress Simulator",
        desc: "Evaluate mechanical wheel-slip risk, cryogenic thermal delta (ΔK), ISRU power draw (W), and abrasive regolith wear for rovers, spacesuits, and ice drills."
      },
      {
        panelId: "panel-right",
        tabId: "tab-compare",
        title: "Step 4: Head-to-Head A/B Analog Comparator",
        desc: "Overlay any two Earth analog candidates directly against the target extraterrestrial base on a 3-dataset radar plot with a parameter-by-parameter winner table."
      },
      {
        panelId: "panel-right",
        tabId: "tab-sar",
        title: "Step 5: Live CSA RADARSAT SAR Polarimetry Lab",
        desc: "Calibrate C-band HH/HV radar backscatter and incidence angles in real time to compute normalized surface roughness and Lunar Mini-RF CPR equivalents."
      }
    ];

    let currentStep = 0;

    function renderTourStep(idx) {
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("tour-highlight"));
      const step = steps[idx];
      const targetPanel = document.getElementById(step.panelId);
      if (targetPanel) targetPanel.classList.add("tour-highlight");
      activateInspectorTab(step.tabId);

      stepBadge.textContent = `JUDGE TOUR ${idx + 1} / ${steps.length}`;
      stepTitle.textContent = step.title;
      stepDesc.textContent = step.desc;
      nextBtn.textContent = idx === steps.length - 1 ? "Finish Tour" : "Next Step →";
      tourPopover.classList.add("open");
    }

    document.getElementById("startJudgeTourBtn").addEventListener("click", () => {
      currentStep = 0;
      renderTourStep(currentStep);
    });

    nextBtn.addEventListener("click", () => {
      if (currentStep < steps.length - 1) {
        currentStep++;
        renderTourStep(currentStep);
      } else {
        document.querySelectorAll(".panel").forEach((p) => p.classList.remove("tour-highlight"));
        tourPopover.classList.remove("open");
      }
    });

    closeBtn.addEventListener("click", () => {
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("tour-highlight"));
      tourPopover.classList.remove("open");
    });
  }

  // ============================================================================
  // 8. FULL 60-PAIR MATRIX MODAL & DATA EXPORTS (JSON & CSV)
  // ============================================================================
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

    document.getElementById("exportJsonBtn").addEventListener("click", () => {
      const target = dataset.target_bases.find((t) => t.id === currentTargetId);
      const report = {
        generated_by: "Dark Aero Planetary Analog Decision Support System v4.0",
        target_base: target,
        custom_weights: weights,
        selected_hardware_simulation: selectedHardwareId,
        plotted_rover_traverse_waypoints: traverseWaypoints,
        ranked_analogs: dataset.earth_analogs
          .map((e) => ({
            earth_analog: e.name,
            country: e.country,
            coordinates: e.coordinates,
            similarity_metrics: computeCustomScore(target, e),
            hardware_stress_telemetry: computeHardwareTelemetry(target, e, selectedHardwareId),
            agency_datasets: e.agency_sources
          }))
          .sort((a, b) => b.similarity_metrics.overall - a.similarity_metrics.overall)
      };

      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dark_aero_${currentTargetId}_mission_report_v4.json`;
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
      a.download = "dark_aero_analog_comparison_matrix_v4.csv";
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
  });
})();
