"""
Dark Aero - Synthetic Aperture Radar (SAR) Surface Roughness & CPR Analyzer
Based on CSA RADARSAT-1 / RCM SAR Python Tutorial & NASA LRO Mini-RF Polarimetry
"""

import math
import json
from typing import Dict


def calculate_circular_polarization_ratio(sigma_sc_db: float, sigma_oc_db: float) -> float:
    linear_sc = 10.0 ** (sigma_sc_db / 10.0)
    linear_oc = 10.0 ** (sigma_oc_db / 10.0)
    if linear_oc == 0:
        return 0.0
    return round(linear_sc / linear_oc, 3)


def normalize_cband_sar_roughness(sigma_hh_db: float, sigma_hv_db: float, incidence_deg: float) -> Dict[str, float]:
    inc_rad = math.radians(incidence_deg)
    depolarization_ratio_db = sigma_hv_db - sigma_hh_db
    cos_correction = math.cos(inc_rad) ** 1.5
    corrected_hh = sigma_hh_db - (10.0 * math.log10(max(cos_correction, 0.1)))
    roughness_index = min(1.0, max(0.0, (corrected_hh + 18.0) / 16.0))
    return {
        "depolarization_ratio_db": round(depolarization_ratio_db, 2),
        "incidence_corrected_hh_db": round(corrected_hh, 2),
        "normalized_roughness_index": round(roughness_index, 3)
    }


def estimate_rover_wheel_slip_pct(slope_deg: float, sar_roughness: float, gravity_m_s2: float = 1.62) -> float:
    gravity_factor = 9.81 / max(gravity_m_s2, 1.0)
    base_slip = (slope_deg / 25.0) * 38.0 + (sar_roughness * 22.0) + (math.log10(gravity_factor) * 14.0)
    return round(min(98.0, max(2.0, base_slip)), 1)


if __name__ == "__main__":
    sample_radarsat_scenes = {
        "Devon_Island_Haughton_Crater_RCM": {"hh_db": -6.8, "hv_db": -12.4, "inc_deg": 34.0, "slope": 14.0},
        "Mauna_Loa_Basalt_Flow_RADARSAT1": {"hh_db": -5.1, "hv_db": -10.2, "inc_deg": 36.5, "slope": 11.2},
        "Atacama_Yungay_Alluvial_RADARSAT1": {"hh_db": -9.4, "hv_db": -16.8, "inc_deg": 31.0, "slope": 7.8},
        "McMurdo_University_Valley_RADARSAT1": {"hh_db": -7.6, "hv_db": -13.9, "inc_deg": 35.0, "slope": 13.5}
    }

    print("CSA RADARSAT-1 / RCM & NASA LRO Mini-RF Surface Roughness Calibration:")
    for scene, params in sample_radarsat_scenes.items():
        metrics = normalize_cband_sar_roughness(params["hh_db"], params["hv_db"], params["inc_deg"])
        metrics["lunar_rover_slip_pct"] = estimate_rover_wheel_slip_pct(
            params["slope"], metrics["normalized_roughness_index"], 1.62
        )
        print(f"  - {scene}: {json.dumps(metrics)}")
