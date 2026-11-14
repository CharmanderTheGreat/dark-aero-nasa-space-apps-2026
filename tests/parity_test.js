// Verifies that the browser scoring engine (assets/js/scoring.js) matches the Python engine
// for every target x analog pair, using the generated data (assets/js/data.js).
// Run:  node tests/parity_test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "assets/js/data.js"), "utf8"), sandbox);
const data = sandbox.window.DARK_AERO_DATA;
const S = require(path.join(root, "assets/js/scoring.js"));

let checked = 0;
let failures = 0;
const TOL = 0.11; // rounding differences between Python round() and JS toFixed()

for (const target of data.target_bases) {
  for (const earth of data.earth_analogs) {
    const js = S.computeScores(target, earth, data.default_weights);
    const py = earth.matches[target.id];
    const pairs = [
      ["overall", py.overall_match_pct],
      ["geology", py.geology_pct],
      ["roughness", py.roughness_pct],
      ["slope", py.slope_pct],
      ["thermal", py.thermal_pct],
      ["aridity", py.aridity_pct],
      ["ice", py.ice_pct]
    ];
    for (const [key, pyVal] of pairs) {
      checked++;
      if (Math.abs(js[key] - pyVal) > TOL) {
        failures++;
        console.error(`MISMATCH ${target.id} x ${earth.id} [${key}] js=${js[key]} py=${pyVal}`);
      }
    }
  }
}

// Robustness is deterministic and each column of probabilities must sum to 100%.
const rob = S.weightRobustness(data.target_bases[0], data.earth_analogs, 2000, 1);
const sumTop1 = Object.values(rob).reduce((a, r) => a + r.top1Pct, 0);
checked++;
if (Math.abs(sumTop1 - 100) > 0.5) {
  failures++;
  console.error(`Robustness top-1 shares sum to ${sumTop1}, expected 100`);
}

// "Points lost" must add up to 100 - overall.
const sc = S.computeScores(data.target_bases[3], data.earth_analogs[2], data.default_weights);
const lost = S.pointsLost(sc.raw, data.default_weights).reduce((a, p) => a + p.lost, 0);
checked++;
if (Math.abs(lost - (100 - sc.overall)) > 0.3) {
  failures++;
  console.error(`pointsLost sum ${lost} != ${100 - sc.overall}`);
}

console.log(`${checked} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
