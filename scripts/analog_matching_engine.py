"""
Dark Aero - Multi-Agency Planetary Analog Matching Engine (v4.1)
2026 NASA International Space Apps Challenge
Challenge: Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars

This module integrates planetary science metrics, diurnal thermal regimes, and hardware stress models from:
- NASA Lunar Reconnaissance Orbiter (LRO Diviner, LOLA, Mini-RF, LEND)
- NASA Planetary Data System (PDS) - Mars 2020 MEDA, MRO CRISM, MOLA, SHARAD
- NASA Earthdata Search, NASA Worldview (GIBS), and NASA Langley POWER API
- Canadian Space Agency (CSA) RADARSAT-1 & RADARSAT Constellation Mission (RCM) SAR
- European Space Agency (ESA) Copernicus Sentinel-1 & Sentinel-2
- Japan Aerospace Exploration Agency (JAXA) G-Portal Precipitation & Cryosphere
"""

import json
import csv
import math
import os
from dataclasses import dataclass, asdict, field
from typing import List, Dict


@dataclass
class ExtraterrestrialBase:
    id: str
    name: str
    body: str  # "Moon" or "Mars"
    region: str
    coordinates: List[float]  # [lat, lon]
    mean_temp_k: float        # Mean surface temperature in Kelvin (LRO Diviner / Mars MEDA)
    temp_extremes_k: List[float]  # [Diurnal Min K, Diurnal Max K]
    slope_deg: float          # Mean terrain slope in degrees (LOLA / MOLA)
    basalt_index: float       # Basaltic / volcanic silicate similarity (0.0 - 1.0)
    radar_cpr: float          # Circular Polarization Ratio / SAR surface roughness (0.0 - 1.0)
    aridity_index: float      # Hyper-aridity index (0.0 - 1.0)
    ice_potential: float      # Subsurface water-ice / permafrost index (0.0 - 1.0)
    gravity_m_s2: float       # Surface gravity (m/s^2)
    solar_irradiance_w_m2: float
    primary_datasets: List[str]
    mission_rationale: str


@dataclass
class EarthAnalogSite:
    id: str
    name: str
    country: str
    coordinates: List[float]  # [lat, lon]
    elevation_m: int
    mean_temp_k: float        # Derived from NASA MODIS Land Surface Temp
    temp_extremes_k: List[float]  # [Diurnal Min K, Diurnal Max K]
    slope_deg: float          # Derived from NASA ASTER GDEM / SRTM
    basalt_index: float       # Derived from ESA Sentinel-2 / USGS Spectral Library
    sar_roughness: float      # Derived from CSA RADARSAT-1 / RCM C-band SAR backscatter
    aridity_index: float      # Derived from JAXA G-Portal & NASA SMAP
    ice_potential: float      # Permafrost / glaciological subsurface ice index
    annual_precip_mm: float   # JAXA G-Portal precipitation record
    agency_sources: List[str]
    best_for: List[str]
    geological_summary: str
    gibs_layer_focus: str
    heritage: str = ""        # Documented analog / astronaut-training / field-test heritage (verify before citing)


class PlanetaryAnalogMatcher:
    """Computes multi-parameter similarity scores and hardware engineering telemetry."""

    def __init__(self, weights: Dict[str, float] = None):
        self.weights = weights or {
            "geology": 0.25,
            "roughness": 0.20,
            "slope": 0.15,
            "thermal": 0.15,
            "aridity": 0.15,
            "ice": 0.10
        }

    def compute_similarity(self, target: ExtraterrestrialBase, earth: EarthAnalogSite) -> Dict[str, float]:
        """Mirror of assets/js/scoring.js (checked by tests/parity_test.js)."""
        clamp = lambda x: max(0.0, min(1.0, x))

        geology_score = clamp(1.0 - abs(target.basalt_index - earth.basalt_index))
        roughness_score = clamp(1.0 - abs(target.radar_cpr - earth.sar_roughness))
        slope_score = clamp(1.0 - abs(target.slope_deg - earth.slope_deg) / 25.0)

        # Thermal = 60% mean-temperature match + 40% diurnal-swing match.
        mean_score = clamp(1.0 - abs(target.mean_temp_k - earth.mean_temp_k) / 220.0)
        swing_target = target.temp_extremes_k[1] - target.temp_extremes_k[0]
        swing_earth = earth.temp_extremes_k[1] - earth.temp_extremes_k[0]
        swing_score = clamp(1.0 - abs(swing_target - swing_earth) / 200.0)
        thermal_score = 0.6 * mean_score + 0.4 * swing_score

        aridity_score = clamp(1.0 - abs(target.aridity_index - earth.aridity_index))
        ice_score = clamp(1.0 - abs(target.ice_potential - earth.ice_potential))

        total_weight = sum(self.weights.values()) or 1.0
        weighted_total = (
            geology_score * self.weights["geology"]
            + roughness_score * self.weights["roughness"]
            + slope_score * self.weights["slope"]
            + thermal_score * self.weights["thermal"]
            + aridity_score * self.weights["aridity"]
            + ice_score * self.weights["ice"]
        ) / total_weight

        return {
            "overall_match_pct": round(weighted_total * 100, 1),
            "geology_pct": round(geology_score * 100, 1),
            "roughness_pct": round(roughness_score * 100, 1),
            "slope_pct": round(slope_score * 100, 1),
            "thermal_pct": round(thermal_score * 100, 1),
            "aridity_pct": round(aridity_score * 100, 1),
            "ice_pct": round(ice_score * 100, 1)
        }


def get_target_bases() -> List[ExtraterrestrialBase]:
    return [
        ExtraterrestrialBase(
            id="shackleton_crater",
            name="Shackleton Crater Rim (Artemis South Pole)",
            body="Moon",
            region="Lunar South Pole (89.9°S, 0.0°E)",
            coordinates=[-89.9, 0.0],
            mean_temp_k=95.0,
            temp_extremes_k=[42.0, 205.0],
            slope_deg=15.2,
            basalt_index=0.78,
            radar_cpr=0.72,
            aridity_index=1.00,
            ice_potential=0.95,
            gravity_m_s2=1.62,
            solar_irradiance_w_m2=1361.0,
            primary_datasets=[
                "NASA LRO Diviner Lunar Radiometer",
                "NASA LRO Mini-RF Polarimetric Radar",
                "NASA LRO LOLA Laser Altimeter",
                "NASA LRO LEND Neutron Detector"
            ],
            mission_rationale="Primary Artemis permanent base candidate featuring illuminated crater rims for solar power adjacent to permanently shadowed regions (PSRs) rich in water ice."
        ),
        ExtraterrestrialBase(
            id="malapert_massif",
            name="Malapert Massif (Artemis III Candidate Region)",
            body="Moon",
            region="Lunar South Polar Highlands (86.0°S, 2.7°E)",
            coordinates=[-86.0, 2.7],
            mean_temp_k=112.0,
            temp_extremes_k=[58.0, 222.0],
            slope_deg=12.4,
            basalt_index=0.74,
            radar_cpr=0.64,
            aridity_index=1.00,
            ice_potential=0.82,
            gravity_m_s2=1.62,
            solar_irradiance_w_m2=1361.0,
            primary_datasets=[
                "NASA LRO LROC Stereo Topography",
                "NASA LRO Diviner Polar Products",
                "NASA LRO LOLA Slope Gradients"
            ],
            mission_rationale="High-elevation mountain ridge providing direct line-of-sight communications with Earth and prolonged solar illumination for habitats."
        ),
        ExtraterrestrialBase(
            id="aristarchus_plateau",
            name="Aristarchus Volcanic Plateau",
            body="Moon",
            region="Nearside Procellarum Basin (23.7°N, 47.4°W)",
            coordinates=[23.7, -47.4],
            mean_temp_k=250.0,
            temp_extremes_k=[102.0, 384.0],
            slope_deg=9.8,
            basalt_index=0.96,
            radar_cpr=0.81,
            aridity_index=1.00,
            ice_potential=0.20,
            gravity_m_s2=1.62,
            solar_irradiance_w_m2=1361.0,
            primary_datasets=[
                "NASA LRO Mini-RF Pyroclastic Maps",
                "NASA LRO Diviner Silicate Index",
                "NASA PDS Moon Mineralogy Mapper"
            ],
            mission_rationale="Vast volcanic plateau containing intact lava tubes for radiation-shielded habitats and oxygen-rich ilmenite pyroclastic glass for ISRU."
        ),
        ExtraterrestrialBase(
            id="jezero_crater",
            name="Jezero Crater Paleolake Delta",
            body="Mars",
            region="Syrtis Major Quadrangle (18.38°N, 77.58°E)",
            coordinates=[18.38, 77.58],
            mean_temp_k=210.0,
            temp_extremes_k=[183.0, 268.0],
            slope_deg=8.2,
            basalt_index=0.88,
            radar_cpr=0.58,
            aridity_index=0.98,
            ice_potential=0.45,
            gravity_m_s2=3.72,
            solar_irradiance_w_m2=590.0,
            primary_datasets=[
                "NASA PDS Mars 2020 MEDA Weather",
                "NASA MRO CRISM Mineralogy",
                "NASA MGS MOLA & HiRISE DTM"
            ],
            mission_rationale="Ancient lacustrine basin rich in phyllosilicates, carbonates, and basaltic sands; benchmark site for Mars Sample Return and surface logistics."
        ),
        ExtraterrestrialBase(
            id="arcadia_planitia",
            name="Arcadia Planitia Glacial Plains",
            body="Mars",
            region="Northern Lowlands (46.7°N, 172.0°W)",
            coordinates=[46.7, -172.0],
            mean_temp_k=195.0,
            temp_extremes_k=[154.0, 242.0],
            slope_deg=3.5,
            basalt_index=0.82,
            radar_cpr=0.52,
            aridity_index=0.95,
            ice_potential=0.94,
            gravity_m_s2=3.72,
            solar_irradiance_w_m2=540.0,
            primary_datasets=[
                "NASA MRO SHARAD Subsurface Radar",
                "NASA Mars Odyssey THEMIS Thermal",
                "NASA PDS MOLA Landing Safety Maps"
            ],
            mission_rationale="Flat volcanic plain underlain by massive shallow subsurface water-ice sheets ideal for large-scale human landing pads and propellant production."
        ),
        ExtraterrestrialBase(
            id="valles_marineris",
            name="Melas Chasma (Valles Marineris)",
            body="Mars",
            region="Equatorial Rift Canyon (10.3°S, 72.5°W)",
            coordinates=[-10.3, -72.5],
            mean_temp_k=224.0,
            temp_extremes_k=[190.0, 282.0],
            slope_deg=17.5,
            basalt_index=0.91,
            radar_cpr=0.76,
            aridity_index=0.97,
            ice_potential=0.55,
            gravity_m_s2=3.72,
            solar_irradiance_w_m2=605.0,
            primary_datasets=[
                "NASA MRO HiRISE Canyon Imagery",
                "NASA PDS Mars Express OMEGA",
                "NASA MGS MOLA Canyon Relief"
            ],
            mission_rationale="Deep tectonic trough offering higher atmospheric pressure, warmer equatorial temperatures, and exposed layered volcanic stratigraphy."
        )
    ]


def get_earth_analogs() -> List[EarthAnalogSite]:
    return [
        EarthAnalogSite(
            id="devon_island",
            name="Haughton Impact Crater, Devon Island",
            country="Canada (Nunavut)",
            coordinates=[75.3833, -89.6667],
            elevation_m=320,
            mean_temp_k=257.15,
            temp_extremes_k=[244.0, 269.5],
            slope_deg=14.0,
            basalt_index=0.76,
            sar_roughness=0.70,
            aridity_index=0.86,
            ice_potential=0.92,
            annual_precip_mm=135.0,
            agency_sources=[
                "CSA RADARSAT-1 & RCM SAR",
                "NASA Earthdata MODIS LST",
                "NASA ASTER GDEM v3",
                "JAXA G-Portal Cryosphere"
            ],
            best_for=["Lunar South Pole ISRU", "EVA Suit Mobility", "Cryogenic Drilling", "Rover Trials"],
            geological_summary="High-Arctic polar desert impact structure featuring continuous permafrost, impact-brecciated gneiss, and zero vegetation.",
            gibs_layer_focus="MODIS_Terra_CorrectedReflectance_TrueColor"
        ),
        EarthAnalogSite(
            id="mcmurdo_dry_valleys",
            name="McMurdo Dry Valleys (University Valley)",
            country="Antarctica",
            coordinates=[-77.4667, 162.5167],
            elevation_m=1650,
            mean_temp_k=250.15,
            temp_extremes_k=[235.0, 264.0],
            slope_deg=13.5,
            basalt_index=0.79,
            sar_roughness=0.66,
            aridity_index=0.98,
            ice_potential=0.96,
            annual_precip_mm=15.0,
            agency_sources=[
                "NASA LRO Diviner Cryosphere",
                "CSA RADARSAT-1 Antarctic SAR",
                "NASA ICESat-2 & MODIS Thermal",
                "ESA Copernicus Sentinel-1"
            ],
            best_for=["Shackleton Ice Mining", "Arcadia Subsurface Ice", "Astrobiology"],
            geological_summary="Hyper-arid polar valley with shallow ice-cemented permafrost topped by dry regolith, closely mirroring lunar polar craters and Martian northern plains.",
            gibs_layer_focus="MODIS_Terra_Land_Surface_Temp_Day"
        ),
        EarthAnalogSite(
            id="atacama_desert",
            name="Atacama Hyper-Arid Core (Yungay Station)",
            country="Chile",
            coordinates=[-24.0886, -69.9144],
            elevation_m=1050,
            mean_temp_k=288.15,
            temp_extremes_k=[272.0, 308.5],
            slope_deg=7.8,
            basalt_index=0.87,
            sar_roughness=0.59,
            aridity_index=0.99,
            ice_potential=0.32,
            annual_precip_mm=2.1,
            agency_sources=[
                "NASA Terra/ASTER Mineralogy",
                "NASA SMAP Soil Moisture",
                "ESA Copernicus Sentinel-2",
                "JAXA G-Portal Precipitation"
            ],
            best_for=["Jezero Rover Navigation", "UV Radiation Tests", "Perchlorate Soil"],
            geological_summary="Earth's driest non-polar desert containing perchlorate-rich soils, sulfate crusts, and alluvial fan deltas analogous to Jezero Crater.",
            gibs_layer_focus="MODIS_Terra_CorrectedReflectance_TrueColor"
        ),
        EarthAnalogSite(
            id="mauna_loa",
            name="Mauna Loa HI-SEAS Basaltic Shield",
            country="United States (Hawaii)",
            coordinates=[19.6014, -155.4858],
            elevation_m=2500,
            mean_temp_k=280.15,
            temp_extremes_k=[270.5, 293.0],
            slope_deg=11.2,
            basalt_index=0.97,
            sar_roughness=0.80,
            aridity_index=0.74,
            ice_potential=0.25,
            annual_precip_mm=380.0,
            agency_sources=[
                "NASA Earthdata SRTM DEM",
                "CSA RADARSAT-1 Lava SAR",
                "NASA PDS Spectral Library"
            ],
            best_for=["Lava Tube Habitats", "Regolith Sintering", "Crew Isolation"],
            geological_summary="Unweathered tholeiitic basalt lava flows and intact volcanic skylight lava tubes matching lunar mare and Martian shield volcanoes.",
            gibs_layer_focus="MODIS_Terra_CorrectedReflectance_TrueColor"
        ),
        EarthAnalogSite(
            id="holuhraun_iceland",
            name="Holuhraun & Askja Highland Lava Field",
            country="Iceland",
            coordinates=[64.8700, -16.8300],
            elevation_m=780,
            mean_temp_k=271.15,
            temp_extremes_k=[261.0, 281.5],
            slope_deg=9.4,
            basalt_index=0.95,
            sar_roughness=0.77,
            aridity_index=0.78,
            ice_potential=0.84,
            annual_precip_mm=420.0,
            agency_sources=[
                "CSA RCM Polarimetric SAR",
                "ESA Copernicus Sentinel-1",
                "NASA Earthdata ASTER TIR"
            ],
            best_for=["Glacio-Volcanic Trials", "Lunar Mare Traction", "Basalt O2 ISRU"],
            geological_summary="Subarctic basaltic sand sheet and fresh lava plain interacting with glacial permafrost and windblown volcanic tephra.",
            gibs_layer_focus="MODIS_Terra_CorrectedReflectance_TrueColor"
        ),
        EarthAnalogSite(
            id="axel_heiberg",
            name="Expedition Fiord, Axel Heiberg Island",
            country="Canada (Nunavut)",
            coordinates=[79.4167, -90.7500],
            elevation_m=480,
            mean_temp_k=254.15,
            temp_extremes_k=[240.5, 266.0],
            slope_deg=15.0,
            basalt_index=0.73,
            sar_roughness=0.68,
            aridity_index=0.89,
            ice_potential=0.94,
            annual_precip_mm=95.0,
            agency_sources=[
                "CSA RADARSAT-1 Permafrost",
                "NASA MODIS Polar Thermal",
                "JAXA G-Portal Snow Cover"
            ],
            best_for=["Malapert Comms", "Cold Spring Astrobiology", "Polar Power Grids"],
            geological_summary="High-latitude mountainous terrain with gypsum-anhydrite diapirs, sub-zero saline springs, and rugged polar slopes.",
            gibs_layer_focus="MODIS_Terra_Land_Surface_Temp_Day"
        ),
        EarthAnalogSite(
            id="rio_tinto",
            name="Río Tinto Acidic Iron-Sulfate Basin",
            country="Spain",
            coordinates=[37.7025, -6.5597],
            elevation_m=410,
            mean_temp_k=291.15,
            temp_extremes_k=[280.0, 304.5],
            slope_deg=8.5,
            basalt_index=0.83,
            sar_roughness=0.55,
            aridity_index=0.82,
            ice_potential=0.18,
            annual_precip_mm=510.0,
            agency_sources=[
                "ESA Open Science Catalog",
                "NASA PDS MRO CRISM",
                "NASA Landsat-9 OLI"
            ],
            best_for=["Mars Sulfate Mineralogy", "Subsurface Drilling", "Biomarkers"],
            geological_summary="Iron- and sulfate-rich geochemical environment producing jarosite and hematite precipitates identical to Martian sedimentary basins.",
            gibs_layer_focus="MODIS_Terra_CorrectedReflectance_TrueColor"
        ),
        EarthAnalogSite(
            id="kilbourne_hole",
            name="Kilbourne Hole Maar Volcanic Crater",
            country="United States (New Mexico)",
            coordinates=[31.9722, -106.9653],
            elevation_m=1290,
            mean_temp_k=290.15,
            temp_extremes_k=[275.0, 307.0],
            slope_deg=14.8,
            basalt_index=0.91,
            sar_roughness=0.73,
            aridity_index=0.91,
            ice_potential=0.22,
            annual_precip_mm=210.0,
            agency_sources=[
                "NASA JSC Planetary Analog",
                "NASA Earthdata SRTM DEM",
                "CSA RADARSAT-1 Maar SAR"
            ],
            best_for=["Artemis Field Geology", "Crater Rim Slopes", "Seismic Arrays"],
            geological_summary="Basaltic phreatomagmatic maar crater with steep pyroclastic rims and mantle xenoliths used directly for NASA Artemis astronaut training.",
            gibs_layer_focus="MODIS_Terra_CorrectedReflectance_TrueColor"
        ),
        EarthAnalogSite(
            id="qaidam_basin",
            name="Qaidam Basin Yardang & Playa Desert",
            country="China (Tibetan Plateau)",
            coordinates=[38.0667, 93.1333],
            elevation_m=2850,
            mean_temp_k=274.15,
            temp_extremes_k=[258.0, 291.5],
            slope_deg=5.2,
            basalt_index=0.81,
            sar_roughness=0.54,
            aridity_index=0.97,
            ice_potential=0.68,
            annual_precip_mm=22.0,
            agency_sources=[
                "JAXA G-Portal Aridity",
                "ESA Copernicus Sentinel-1",
                "NASA MODIS High-Altitude"
            ],
            best_for=["Arcadia Landing Zones", "Dust Mitigation", "Playa Rovers"],
            geological_summary="High-elevation hyper-arid basin on the Tibetan Plateau featuring wind-sculpted yardangs, polygons, and cold desert evaporites.",
            gibs_layer_focus="MODIS_Terra_CorrectedReflectance_TrueColor"
        ),
        EarthAnalogSite(
            id="afdera_danakil",
            name="Danakil Depression & Erta Ale Rift",
            country="Ethiopia",
            coordinates=[13.6000, 40.6667],
            elevation_m=-115,
            mean_temp_k=307.15,
            temp_extremes_k=[295.0, 322.0],
            slope_deg=16.2,
            basalt_index=0.93,
            sar_roughness=0.75,
            aridity_index=0.96,
            ice_potential=0.10,
            annual_precip_mm=105.0,
            agency_sources=[
                "ESA Copernicus Sentinel-2",
                "NASA ASTER Thermal Index",
                "CSA RADARSAT-1 Rift SAR"
            ],
            best_for=["Valles Marineris Rift", "Hydrothermal Minerals", "Extreme Robotics"],
            geological_summary="Active continental rift basin with basaltic shield volcanism, steep tectonic grabens, and polyextreme hydrothermal evaporites.",
            gibs_layer_focus="MODIS_Terra_Land_Surface_Temp_Day"
        )
    ]


SCORING_VERSION = "4.1"

# Field heritage of each Earth analog. Wording is intentionally conservative:
# please double-check each line against its primary source before quoting it in the pitch.
HERITAGE = {
    "devon_island": "Home of the NASA-supported Haughton-Mars Project (since 1997): long-running Moon/Mars field simulations, EVA and rover trials.",
    "mcmurdo_dry_valleys": "Widely studied Mars cold-desert analog: ice-cemented permafrost, extreme aridity and sparse microbial life.",
    "atacama_desert": "Hyper-arid Mars analog hosting NASA-funded rover and subsurface-drilling astrobiology field trials.",
    "mauna_loa": "Hawaiian basaltic shield terrain; the HI-SEAS simulated-habitat site is on its slopes.",
    "holuhraun_iceland": "Iceland's Askja region was used for Apollo-era astronaut geology training; Holuhraun (2014) is studied as a fresh basalt-flow analog.",
    "axel_heiberg": "High-Arctic Mars analog with long-running research campaigns (e.g. McGill Arctic Research Station); permafrost, ice and spring systems.",
    "rio_tinto": "Acidic iron/sulfate system studied for Mars mineralogy; site of the MARTE drilling and life-detection analog project.",
    "kilbourne_hole": "Volcanic maar crater in New Mexico, studied for planetary-geology analog work (maar craters, mantle xenoliths).",
    "qaidam_basin": "Hyper-arid, saline, wind-eroded basin widely studied as a Mars analog (yardangs, evaporites).",
    "afdera_danakil": "Basaltic rift / hydrothermal-evaporite system studied as a Mars and early-Earth analog."
}

# How every score input is obtained. 'curated' = analyst-assigned 0-1 index informed by the listed
# agency products; it is NOT recomputed from raw rasters inside this app.
PARAMETER_METHODOLOGY = [
    {"key": "geology", "label": "Basalt & Silicate Geology", "range": "0-1 index",
     "target_source": "LRO Diviner silicate index / M3 / CRISM mineralogy",
     "earth_source": "Sentinel-2 / ASTER band ratios + USGS spectral library",
     "similarity": "1 - |target - earth|", "status": "curated"},
    {"key": "roughness", "label": "SAR Roughness vs CPR", "range": "0-1 index",
     "target_source": "LRO Mini-RF circular polarization ratio (CPR)",
     "earth_source": "RADARSAT-1 / RCM C-band HH/HV backscatter (SAR Lab converts dB to 0-1 roughness)",
     "similarity": "1 - |CPR - roughness|", "status": "curated"},
    {"key": "slope", "label": "Terrain Slope", "range": "degrees",
     "target_source": "LOLA / MOLA topography",
     "earth_source": "ASTER GDEM / SRTM DEM",
     "similarity": "1 - |delta| / 25 deg", "status": "curated"},
    {"key": "thermal", "label": "Thermal Regime", "range": "kelvin",
     "target_source": "LRO Diviner / Mars MEDA mean + diurnal extremes",
     "earth_source": "MODIS land-surface temperature (mean + day/night extremes)",
     "similarity": "0.6 x mean-temp match (220 K range) + 0.4 x diurnal-swing match (200 K range)", "status": "curated"},
    {"key": "aridity", "label": "Hyper-Aridity", "range": "0-1 index",
     "target_source": "Atmosphere / water-activity assumption (airless Moon = 1.0)",
     "earth_source": "Annual precipitation (JAXA GPM / NASA POWER) mapped to an index",
     "similarity": "1 - |target - earth|", "status": "curated"},
    {"key": "ice", "label": "Subsurface Ice", "range": "0-1 index",
     "target_source": "LEND neutron data (Moon), SHARAD radar (Mars)",
     "earth_source": "Permafrost / glacier presence literature",
     "similarity": "1 - |target - earth|", "status": "curated"}
]

# Resources named by the 2026 Space Apps challenge, and how Dark Aero actually uses each one.
# integration: "live" = queried or rendered at run time; "reference" = informs the curated indices only.
OFFICIAL_RESOURCES = [
    {"agency": "NASA", "name": "Earthdata Search", "integration": "reference", "use": "Discovery of MODIS LST / ASTER products behind the curated thermal and slope values."},
    {"agency": "NASA", "name": "Worldview (GIBS)", "integration": "live", "use": "Map overlays: MODIS true colour, Blue Marble, land-surface temperature."},
    {"agency": "NASA", "name": "Planetary Data System (PDS)", "integration": "reference", "use": "Mars target values (MEDA, CRISM, MOLA, SHARAD)."},
    {"agency": "NASA", "name": "Lunar Reconnaissance Orbiter (LRO)", "integration": "reference", "use": "Lunar target values: LOLA slope, Mini-RF CPR, LEND ice."},
    {"agency": "NASA", "name": "LRO Diviner", "integration": "reference", "use": "Lunar polar temperatures and day/night extremes used in the thermal score."},
    {"agency": "CSA", "name": "RADARSAT Constellation Mission (RCM)", "integration": "reference", "use": "C-band SAR basis for the roughness index and SAR Lab."},
    {"agency": "CSA", "name": "RADARSAT-1 data", "integration": "reference", "use": "Open-licence SAR archive behind the Arctic crater / lava-field roughness values."},
    {"agency": "CSA", "name": "SAR Python Tutorial", "integration": "reference", "use": "Method reference for the HH/HV backscatter to roughness workflow (scripts/sar_roughness_analyzer.py)."},
    {"agency": "ESA", "name": "Copernicus Data Space Ecosystem", "integration": "live", "use": "Copernicus GLO-90 DEM (via Open-Meteo) for live elevation and slope; Sentinel-1/2 inform curated indices."},
    {"agency": "ESA", "name": "Open Science Catalog", "integration": "reference", "use": "Dataset discovery for geology / surface-roughness products."},
    {"agency": "JAXA", "name": "G-Portal", "integration": "reference", "use": "Precipitation and cryosphere records behind the aridity and ice indices."},
    {"agency": "NASA", "name": "POWER (Langley) - not on the challenge list", "integration": "live", "use": "Live scan: skin temperature, day/night range, precipitation."}
]

LIMITATIONS = [
    "Similarity is not equivalence: Earth analogs cannot reproduce vacuum, radiation, lunar/Martian gravity (every Earth site is 9.81 m/s2 vs 1.62 / 3.72) or perchlorate chemistry.",
    "The six indices for the 10 curated sites are analyst-assigned from published agency products. They are not recomputed from raw rasters in this app. Treat them as a transparent starting point, not a survey.",
    "Live NASA POWER scans measure temperature, precipitation and diurnal range for real; slope and elevation come from a ~90 m DEM sampled ~1 km around the click; geology and SAR roughness are assumptions and are labelled as such.",
    "The Hardware & Rover Stress Simulator and rover-traverse energy numbers are illustrative engineering heuristics, not validated vehicle models.",
    "Weights are subjective. The Weight Robustness panel shows how often each site stays #1 when weights are varied randomly.",
    "Scores compare six parameters only; logistics, permits, season windows and safety are not modelled.",
    "Esri imagery, OpenTopoMap and the Open-Meteo elevation service are non-U.S.-Government services governed by their own terms; NASA does not endorse them."
]


def export_datasets(output_dir: str, js_path: str = None):
    matcher = PlanetaryAnalogMatcher()
    targets = get_target_bases()
    analogs = get_earth_analogs()

    payload = {
        "project": "Dark Aero - Planetary Analog Decision Support System (v4.1 Mission Control)",
        "challenge": "Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars",
        "event": "2026 NASA International Space Apps Challenge",
        "scoring_version": SCORING_VERSION,
        "default_weights": matcher.weights,
        "parameter_methodology": PARAMETER_METHODOLOGY,
        "limitations": LIMITATIONS,
        "official_resources": OFFICIAL_RESOURCES,
        "target_bases": [asdict(t) for t in targets],
        "earth_analogs": [],
        "comparison_matrix": {}
    }

    csv_rows = []

    for target in targets:
        payload["comparison_matrix"][target.id] = []

    for site in analogs:
        site.heritage = HERITAGE.get(site.id, "")
        site_dict = asdict(site)
        site_dict["matches"] = {}
        for target in targets:
            scores = matcher.compute_similarity(target, site)
            site_dict["matches"][target.id] = scores
            payload["comparison_matrix"][target.id].append({
                "earth_id": site.id,
                "earth_name": site.name,
                **scores
            })
            csv_rows.append({
                "Target_ID": target.id,
                "Target_Name": target.name,
                "Target_Body": target.body,
                "Earth_Analog_ID": site.id,
                "Earth_Analog_Name": site.name,
                "Country": site.country,
                "Latitude": site.coordinates[0],
                "Longitude": site.coordinates[1],
                "Overall_Match_Pct": scores["overall_match_pct"],
                "Geology_Pct": scores["geology_pct"],
                "SAR_Roughness_Pct": scores["roughness_pct"],
                "Slope_Pct": scores["slope_pct"],
                "Thermal_Pct": scores["thermal_pct"],
                "Aridity_Pct": scores["aridity_pct"],
                "Subsurface_Ice_Pct": scores["ice_pct"]
            })
        payload["earth_analogs"].append(site_dict)

    for target_id in payload["comparison_matrix"]:
        payload["comparison_matrix"][target_id].sort(
            key=lambda x: x["overall_match_pct"], reverse=True
        )

    json_path = os.path.join(output_dir, "nasa_analog_matches.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    csv_path = os.path.join(output_dir, "analog_comparison_matrix.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(csv_rows[0].keys()))
        writer.writeheader()
        writer.writerows(csv_rows)

    # Single source of truth: the web app's data.js is generated from the same payload.
    if js_path:
        with open(js_path, "w", encoding="utf-8") as f:
            f.write("// AUTO-GENERATED by scripts/analog_matching_engine.py - do not edit by hand.\n")
            f.write("// Re-generate with: python scripts/analog_matching_engine.py\n")
            f.write("window.DARK_AERO_DATA = ")
            json.dump(payload, f, indent=2)
            f.write(";\n")

    print(f"Exported {len(targets)} extraterrestrial bases and {len(analogs)} Earth analogs.")
    return payload


if __name__ == "__main__":
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(root_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    export_datasets(data_dir, js_path=os.path.join(root_dir, "assets", "js", "data.js"))
