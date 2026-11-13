/**
 * Dark Aero - Multi-Agency Planetary Analog Explorer
 * Frontend Controller (Leaflet.js + NASA Worldview GIBS + Chart.js)
 */

(function () {
  const dataset = window.DARK_AERO_DATA;
  let currentTargetId = dataset.target_bases[0].id;
  let selectedEarthId = dataset.earth_analogs[0].id;
  let map = null;
  let markersLayer = null;
  let radarChart = null;

  const weights = {
    geology: 0.25,
    roughness: 0.20,
    slope: 0.15,
    thermal: 0.15,
    aridity: 0.15,
    ice: 0.10
  };

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

  function initMap() {
    map = L.map("map", {
      center: [25.0, -20.0],
      zoom: 2,
      minZoom: 2,
      worldCopyJump: true
    });

    // Dark Carto Base Layer (Fallback / Reference)
    const darkBase = L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution: "&copy; OpenStreetMap & CartoDB",
        maxZoom: 18
      }
    ).addTo(map);

    // NASA Worldview GIBS - MODIS Terra True Color Layer
    const nasaTrueColor = L.tileLayer(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2025-07-15/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",
      {
        attribution: "NASA Earthdata / Worldview GIBS (MODIS Terra)",
        maxZoom: 9,
        opacity: 0.85
      }
    );

    // NASA Worldview GIBS - Land Surface Temperature Day Layer
    const nasaSurfaceTemp = L.tileLayer(
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Land_Surface_Temp_Day/default/2025-07-15/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png",
      {
        attribution: "NASA Earthdata MODIS LST (Diviner Thermal Comparison)",
        maxZoom: 7,
        opacity: 0.65
      }
    );

    L.control
      .layers(
        {
          "Dark Aerospace Vector Map": darkBase,
          "NASA Worldview True Color (MODIS)": nasaTrueColor
        },
        {
          "NASA Land Surface Temperature Overlay": nasaSurfaceTemp
        }
      )
      .addTo(map);

    markersLayer = L.layerGroup().addTo(map);
  }

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

  function bindSliders() {
    const sliderKeys = ["geology", "roughness", "slope", "thermal", "aridity", "ice"];
    sliderKeys.forEach((key) => {
      const slider = document.getElementById(`weight-${key}`);
      const label = document.getElementById(`val-${key}`);
      slider.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        weights[key] = val / 100.0;
        label.textContent = `${val}%`;
        refreshDashboard(false);
      });
    });

    document.getElementById("resetWeightsBtn").addEventListener("click", () => {
      const defaults = { geology: 25, roughness: 20, slope: 15, thermal: 15, aridity: 15, ice: 10 };
      Object.keys(defaults).forEach((k) => {
        weights[k] = defaults[k] / 100.0;
        document.getElementById(`weight-${k}`).value = defaults[k];
        document.getElementById(`val-${k}`).textContent = `${defaults[k]}%`;
      });
      refreshDashboard(false);
    });
  }

  function renderTargetSummary(target) {
    const container = document.getElementById("targetSummaryBox");
    container.innerHTML = `
      <div style="font-weight:700; color:#f8fafc; margin-bottom:0.25rem;">${target.name}</div>
      <div style="font-size:0.74rem; color:#38bdf8; margin-bottom:0.45rem;">${target.region}</div>
      <p style="font-size:0.76rem; color:#cbd5e1; margin-bottom:0.5rem;">${target.mission_rationale}</p>
      <div class="meta-row">
        <span>Mean Temp: <strong>${target.mean_temp_k} K</strong></span>
        <span>Slope: <strong>${target.slope_deg}&deg;</strong></span>
        <span>Radar CPR: <strong>${target.radar_cpr}</strong></span>
      </div>
    `;
  }

  function refreshDashboard(autoSelectTop) {
    const target = dataset.target_bases.find((t) => t.id === currentTargetId);
    renderTargetSummary(target);

    const ranked = dataset.earth_analogs
      .map((earth) => {
        const scores = computeCustomScore(target, earth);
        return { earth, scores };
      })
      .sort((a, b) => b.scores.overall - a.scores.overall);

    if (autoSelectTop && ranked.length > 0) {
      selectedEarthId = ranked[0].earth.id;
    }

    renderAnalogCards(ranked);
    renderMapMarkers(ranked);

    const activeEntry = ranked.find((r) => r.earth.id === selectedEarthId) || ranked[0];
    renderInspector(target, activeEntry.earth, activeEntry.scores);
  }

  function renderAnalogCards(ranked) {
    const listEl = document.getElementById("analogRankingList");
    listEl.innerHTML = "";

    ranked.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = `analog-card ${item.earth.id === selectedEarthId ? "active" : ""}`;
      card.innerHTML = `
        <div class="analog-card-header">
          <div class="analog-card-title">#${idx + 1} ${item.earth.name}</div>
          <span class="score-badge">${item.scores.overall}%</span>
        </div>
        <div style="font-size:0.74rem; color:#94a3b8; margin-top:0.25rem;">
          ${item.earth.country} &bull; Elev: ${item.earth.elevation_m}m
        </div>
        <div style="font-size:0.72rem; color:#38bdf8; margin-top:0.35rem;">
          Geology: ${item.scores.geology}% | SAR: ${item.scores.roughness}% | Ice: ${item.scores.ice}%
        </div>
      `;
      card.addEventListener("click", () => {
        selectedEarthId = item.earth.id;
        map.flyTo(item.earth.coordinates, 6, { duration: 1.1 });
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
        radius: isSelected ? 11 : 8,
        fillColor: isSelected ? "#22d3ee" : idx === 0 ? "#10b981" : "#38bdf8",
        color: "#0f172a",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.9
      });

      circle.bindPopup(`
        <div style="font-family:sans-serif; min-width:190px;">
          <strong style="font-size:0.88rem;">#${idx + 1} ${item.earth.name}</strong><br/>
          <span style="color:#0284c7; font-weight:700;">Match Score: ${item.scores.overall}%</span><br/>
          <small>Coords: ${item.earth.coordinates[0].toFixed(2)}, ${item.earth.coordinates[1].toFixed(2)}</small><br/>
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

  function renderInspector(target, earth, scores) {
    document.getElementById("inspectorTitle").textContent = earth.name;
    document.getElementById("inspectorSubtitle").textContent =
      `${earth.country} (${earth.coordinates[0].toFixed(3)}°, ${earth.coordinates[1].toFixed(3)}°)`;
    document.getElementById("inspectorOverallScore").textContent = `${scores.overall}% Match`;
    document.getElementById("inspectorSummary").textContent = earth.geological_summary;

    document.getElementById("metricTemp").textContent = `${earth.mean_temp_k} K vs ${target.mean_temp_k} K`;
    document.getElementById("metricSlope").textContent = `${earth.slope_deg}° vs ${target.slope_deg}°`;
    document.getElementById("metricSar").textContent = `${earth.sar_roughness} vs ${target.radar_cpr} CPR`;
    document.getElementById("metricPrecip").textContent = `${earth.annual_precip_mm} mm/yr`;

    const tagsEl = document.getElementById("inspectorTags");
    tagsEl.innerHTML = earth.best_for
      .map((tag) => `<span class="tag-item">${tag}</span>`)
      .join("");

    const sourcesEl = document.getElementById("inspectorSources");
    sourcesEl.innerHTML = [...earth.agency_sources, ...target.primary_datasets.slice(0, 2)]
      .map((s) => `<li>${s}</li>`)
      .join("");

    updateRadarChart(target, earth, scores);
  }

  function updateRadarChart(target, earth, scores) {
    const ctx = document.getElementById("telemetryRadarChart").getContext("2d");
    const labels = [
      "Basalt / Geology",
      "SAR Roughness",
      "Slope Profile",
      "Thermal Regime",
      "Hyper-Aridity",
      "Subsurface Ice"
    ];

    const targetProfile = [
      Math.round(target.basalt_index * 100),
      Math.round(target.radar_cpr * 100),
      Math.round(Math.min(100, (target.slope_deg / 20.0) * 100)),
      Math.round(Math.min(100, (target.mean_temp_k / 310.0) * 100)),
      Math.round(target.aridity_index * 100),
      Math.round(target.ice_potential * 100)
    ];

    const earthProfile = [
      Math.round(earth.basalt_index * 100),
      Math.round(earth.sar_roughness * 100),
      Math.round(Math.min(100, (earth.slope_deg / 20.0) * 100)),
      Math.round(Math.min(100, (earth.mean_temp_k / 310.0) * 100)),
      Math.round(earth.aridity_index * 100),
      Math.round(earth.ice_potential * 100)
    ];

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
            data: targetProfile,
            backgroundColor: "rgba(245, 158, 11, 0.2)",
            borderColor: "#f59e0b",
            pointBackgroundColor: "#f59e0b",
            borderWidth: 2
          },
          {
            label: earth.name,
            data: earthProfile,
            backgroundColor: "rgba(34, 211, 238, 0.22)",
            borderColor: "#22d3ee",
            pointBackgroundColor: "#22d3ee",
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            angleLines: { color: "#1e293b" },
            grid: { color: "#1e293b" },
            pointLabels: { color: "#cbd5e1", font: { size: 10 } },
            ticks: { display: false, min: 0, max: 100 }
          }
        },
        plugins: {
          legend: {
            labels: { color: "#f8fafc", boxWidth: 12, font: { size: 11 } }
          }
        }
      }
    });
  }

  function setupExportButton() {
    document.getElementById("exportJsonBtn").addEventListener("click", () => {
      const target = dataset.target_bases.find((t) => t.id === currentTargetId);
      const report = {
        generated_by: "Dark Aero Planetary Analog Engine",
        target_base: target,
        custom_weights: weights,
        ranked_analogs: dataset.earth_analogs
          .map((e) => ({
            earth_analog: e.name,
            country: e.country,
            coordinates: e.coordinates,
            similarity_metrics: computeCustomScore(target, e),
            agency_datasets: e.agency_sources
          }))
          .sort((a, b) => b.similarity_metrics.overall - a.similarity_metrics.overall)
      };

      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dark_aero_${currentTargetId}_analog_report.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initMap();
    populateTargetDropdown();
    bindSliders();
    setupExportButton();
    refreshDashboard(true);
  });
})();
