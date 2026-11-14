# Dark Aero v4.2 — Planetary Analog Decision Support System

**2026 NASA International Space Apps Challenge**  
**Challenge:** Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars  
**Team:** Dark Aero (Universal Event)

---

## 1. Executive Summary

**Dark Aero v4.2** is a single-viewport aerospace decision-support and planetary engineering platform designed to identify, benchmark, and field-plan terrestrial analog locations for permanent Moon base locations (Artemis Lunar South Pole craters and volcanic plateaus) and Mars human exploration zones (Jezero Crater, Arcadia Planitia, and Valles Marineris).

### Key Capabilities:
1. **Fixed Single-Viewport Aerospace Mission Console (`100vh`):** High-density obsidian telemetry interface featuring `Space Grotesk`, `Plus Jakarta Sans`, and `JetBrains Mono` typography with zero outer page scrolling.
2. **Interactive 3D Planetary Target Globe:** Real-time HTML5 Canvas 3D orbital globe for the Moon and Mars with drag-to-rotate controls, surface gravity/irradiance telemetry, and active landing-site beacons.
3. **Keyless High-Resolution Satellite Map & Live NASA POWER API Scanner:** Combines **Esri World Imagery**, **NASA Worldview GIBS** (`MODIS Terra True Color`, `Blue Marble Next Generation`, and `Land Surface Temperature`), and **OpenTopoMap** contours. Clicking anywhere on Earth queries the live **NASA Langley POWER Climatology REST API** and persists scanned locations via `localStorage`.
4. **Rover & EVA Traverse Path Planner:** Toggle **Plot Rover Traverse** mode on the satellite map to place waypoints, calculate Haversine route distance ($\text{km}$), estimate rover battery draw ($\text{Wh}$), and evaluate slope hazards.
5. **Head-to-Head A/B Comparator, 24-Hour Diurnal Thermal Chart & CSA SAR Polarimetry Lab:** Compare two Earth analog sites side-by-side, inspect 24-hour day/night Kelvin temperature swings, and calibrate C-band $HH/HV$ radar backscatter in real time.
6. **60-Second Judge Guided Tour:** Built-in interactive walkthrough highlighting every subsystem across the console.

---

## 1b. What's new in v4.2 (since v4.0)

| Area | Change |
| :--- | :--- |
| **Scientific honesty** | Every input now carries a *data basis* tag (`curated`, `measured`, `derived`, `estimated`, `assumed`, `calibrated`). New **Why & Data** tab and **Method & Limits** dialog explain exactly where each number comes from. |
| **Live scan fixed** | The map click now uses real data: NASA POWER (skin temp, **day/night range**, precipitation) + a 90 m DEM (real elevation and ~1 km regional slope). The old pseudo-random slope and fixed 0.82 basalt value were removed. Geology (0.5) and SAR roughness (slope proxy) are explicitly labelled *assumed/estimated*. Timeouts, HTTP errors and NASA `-999` fill values are handled. |
| **Better scoring** | Thermal score now blends mean temperature (60%) with the **diurnal swing** (40%). Weights are normalised in Python too. |
| **Weakest-link flags** | A site can no longer hide a failed priority: any parameter with weight >= 10% and score < 40% raises a critical-mismatch warning. |
| **Weight robustness** | 2,000 random weightings (fixed seed) show how often each site is #1 / top-3, so the recommendation does not depend on one slider setting. |
| **Mission picks** | One-click chips show the best analog for ISRU, rover, lava-habitat and balanced profiles. |
| **Explainability** | "Where the points were lost" bars + limiting factor per site. |
| **Field heritage** | Documented analog/training heritage per site (verify wording against sources before quoting). |
| **Single source of truth** | `scripts/analog_matching_engine.py` generates `data.js`, JSON and CSV. `assets/js/scoring.js` is the only JS scoring implementation; `tests/parity_test.js` proves JS == Python for all 60 pairs. |
| **Guided tour** | Spotlight on the panel being explained, step badge and progress bar, Back/Next/End, keyboard support, and a header button that shows the current step. |
| **Map controls** | "Clear map" removes the yellow scan marker and rover traverse (Esc also clears the scan); saved live scans can be removed with the ✕ on their card. Map legend and hover tooltips added. |
| **Responsive** | Phone and tablet layouts fixed (no clipped panels, header wraps). |
| **Offline-ready** | Leaflet, Chart.js and fonts are bundled in `assets/vendor` and `assets/fonts` (map tiles/APIs still need internet; the app degrades gracefully with a notice). |
| **UX / a11y** | Keyboard-operable cards/tabs/modals (Esc closes), ARIA roles and slider labels, colour-blind-safe A/B chart (solid vs dashed + marker shapes), touch globe, reduced-motion support, larger minimum font, projector scaling, tablet/phone layout fixes, tour auto-starts on first visit. Longitude from map clicks is wrapped to -180..180. |

---

## 1c. How scoring works

`overall = sum(weight_i x similarity_i) / sum(weights)` over six parameters:

| Parameter | Similarity |
| :--- | :--- |
| Geology | `1 - abs(basalt_target - basalt_earth)` |
| SAR roughness | `1 - abs(CPR_target - roughness_earth)` |
| Slope | `1 - abs(delta_deg) / 25` |
| Thermal | `0.6 x (1 - abs(delta_mean_K)/220) + 0.4 x (1 - abs(delta_swing_K)/200)` |
| Aridity | `1 - abs(delta)` |
| Subsurface ice | `1 - abs(delta)` |

## 1d. Limitations (also shown in-app)

* Similarity is not equivalence: no Earth site reproduces vacuum, radiation, lunar/Martian gravity (9.81 vs 1.62 / 3.72 m/s2) or perchlorates.
* The six indices of the 10 curated sites are analyst-assigned from published agency products; they are not recomputed from raw rasters inside the app.
* Hardware stress and rover-traverse energy numbers are illustrative heuristics, not validated vehicle models.
* Logistics, permits, season windows and safety are not modelled.

## 1e. Challenge resource coverage

Live in the app: **NASA Worldview/GIBS** (map layers), **Copernicus GLO-90 DEM** (elevation/slope via Open-Meteo) and **NASA POWER** (not on the challenge list, but NASA). Reference only (inform the curated indices, not queried live): Earthdata Search, PDS, LRO + Diviner, CSA RCM / RADARSAT-1 / SAR tutorial, ESA Open Science Catalog, JAXA G-Portal. The full table is in the in-app **Method & Limits** dialog. Esri, OpenTopoMap and Open-Meteo are non-U.S.-Government services; NASA does not endorse them.

## 1f. Run, test and regenerate

```bash
# Open the console (no build step)
open index.html            # or: python -m http.server 8000

# Regenerate data.js + JSON + CSV from the Python engine
python scripts/analog_matching_engine.py

# Verify JS scoring == Python scoring (60 pairs x 7 scores + sanity checks)
node tests/parity_test.js
```

Credits / licences of bundled components: Leaflet (BSD-2-Clause), Chart.js (MIT), Space Grotesk, Plus Jakarta Sans and JetBrains Mono via Fontsource (SIL OFL). Map imagery: Esri World Imagery, NASA Worldview GIBS, OpenTopoMap. Data: NASA POWER, Copernicus GLO-90 DEM (via Open-Meteo), plus the agency products listed below.

---

## 2. Space Agency Datasets & APIs Used

| Space Agency | Dataset / API Portal | Role in Dark Aero v4.2 Architecture |
| :--- | :--- | :--- |
| **NASA** | **LRO Diviner Lunar Radiometer** | Polar cryogenic surface temperatures (95 K–112 K), diurnal thermal extremes, and silicate mineralogy indices. |
| **NASA** | **LRO Mini-RF & LOLA** | S/X-band radar Circular Polarization Ratio (CPR) for regolith blockiness and laser altimetry slope gradients. |
| **NASA** | **Langley POWER REST API** | Live point-coordinate satellite climatology (`TS`, `PRECTOTCORR`, `ALLSKY_SFC_SW_DWN`) for any clicked location on Earth. |
| **NASA** | **Planetary Data System (PDS)** | Mars 2020 Perseverance MEDA meteorology, MRO CRISM mineralogy, and SHARAD subsurface ice radar profiles. |
| **NASA** | **NASA Worldview (GIBS) & Earthdata** | Live WMTS satellite map tiles (`MODIS_Terra_CorrectedReflectance_TrueColor`, `BlueMarble_NextGeneration`, `MODIS_Terra_Land_Surface_Temp_Day`). |
| **CSA** | **RADARSAT-1 & RCM + SAR Python Tutorial** | C-band Synthetic Aperture Radar (SAR) $HH/HV$ backscatter calibration across Arctic impact craters and volcanic lava fields. |
| **ESA** | **Copernicus Data Space & Open Science Catalog** | Sentinel-1 InSAR surface roughness and Sentinel-2 iron-oxide/sulfate spectral reflectance indices. |
| **JAXA** | **JAXA G-Portal** | Global precipitation, hyper-aridity verification, and cryosphere snow/ice cover records. |

---

## 3. Team Dark Aero Roster

* **Albert Lawrence B. Robiñol** (`@charmanderthegreat`) — Team Owner / Lead Full-Stack & Systems Architect
* **Luke Edward Schofield** (`@luke_schofield`) — Software Engineering & Backend Data Lead
* **Carlson Ian S. Ombrog** (`@carlpogi`) — Frontend & Geospatial UI Developer
* **Alvin Jan Calambro** (`@alb80degrees`) — Planetary Data & Multi-Agency Research Lead
* **Franz Marco Basbas** (`@sunny262527`) — Systems Integration & Telemetry Visualization
* **Nikko Agcaoili** (`@nikkoo`) — Documentation, Pitch Deck & Mission Analysis
