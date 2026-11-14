# Dark Aero v4.0 — Planetary Analog Decision Support System

**2026 NASA International Space Apps Challenge**  
**Challenge:** Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars  
**Team:** Dark Aero (Universal Event)

---

## 1. Executive Summary

**Dark Aero v4.0** is a single-viewport aerospace decision-support and planetary engineering platform designed to identify, benchmark, and field-plan terrestrial analog locations for permanent Moon base locations (Artemis Lunar South Pole craters and volcanic plateaus) and Mars human exploration zones (Jezero Crater, Arcadia Planitia, and Valles Marineris).

### Key Capabilities:
1. **Fixed Single-Viewport Aerospace Mission Console (`100vh`):** High-density obsidian telemetry interface featuring `Space Grotesk`, `Plus Jakarta Sans`, and `JetBrains Mono` typography with zero outer page scrolling.
2. **Interactive 3D Planetary Target Globe:** Real-time HTML5 Canvas 3D orbital globe for the Moon and Mars with drag-to-rotate controls, surface gravity/irradiance telemetry, and active landing-site beacons.
3. **Keyless High-Resolution Satellite Map & Live NASA POWER API Scanner:** Combines **Esri World Imagery**, **NASA Worldview GIBS** (`MODIS Terra True Color`, `Blue Marble Next Generation`, and `Land Surface Temperature`), and **OpenTopoMap** contours. Clicking anywhere on Earth queries the live **NASA Langley POWER Climatology REST API** and persists scanned locations via `localStorage`.
4. **Rover & EVA Traverse Path Planner:** Toggle **Plot Rover Traverse** mode on the satellite map to place waypoints, calculate Haversine route distance ($\text{km}$), estimate rover battery draw ($\text{Wh}$), and evaluate slope hazards.
5. **Head-to-Head A/B Comparator, 24-Hour Diurnal Thermal Chart & CSA SAR Polarimetry Lab:** Compare two Earth analog sites side-by-side, inspect 24-hour day/night Kelvin temperature swings, and calibrate C-band $HH/HV$ radar backscatter in real time.
6. **60-Second Judge Guided Tour:** Built-in interactive walkthrough highlighting every subsystem across the console.

---

## 2. Space Agency Datasets & APIs Used

| Space Agency | Dataset / API Portal | Role in Dark Aero v4.0 Architecture |
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
