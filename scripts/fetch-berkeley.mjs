// Fetches 7 days of tennis court availability from the City of Berkeley's
// CivicRec booking site and writes JSON in the same shape as oakland.json.
//
// Usage: node scripts/fetch-berkeley.mjs site/data/berkeley.json
//
// The slot endpoint needs no session and accepts any 32-hex key.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const HOST = "https://ca-berkeley.civicrec.com/CA/berkeley-ca";
const API_KEY = "00000000000000000000000000000000";
const DAYS = 7;
const FIRST_HOUR = 7;   // first slot 7am
const LAST_HOUR = 21;   // last slot 9pm (ends 10pm)
const UA = "east-bay-courts availability snapshot (+https://github.com/sjyoung12/east-bay-courts)";

// Court IDs come from CivicRec's getLocationFacilities. San Pablo #4-6 are listed
// there but kept for walk-on play, so they're left out.
const PARKS = [
  { id: "19743", park: "San Pablo", coords: [37.8576, -122.2836], courts: [[68573, "#1"], [77108, "#2"], [77109, "#3"]] },
  { id: "17523", park: "Grove", coords: [37.8556, -122.2715], courts: [[68523, "#1"], [77093, "#2"]] },
  { id: "17521", park: "Cedar Rose", coords: [37.8781, -122.2893], courts: [[68499, "#1"], [77102, "#2"]] },
  { id: "17420", park: "James Kenney", coords: [37.8712, -122.2951], courts: [[68555, "#1"], [77106, "#2"]] },
  { id: "17517", park: "Live Oak", coords: [37.8838, -122.2691], courts: [[68491, "#1"], [77107, "#2"]] },
  { id: "17568", park: "Rose Garden", coords: [37.8857, -122.2614], courts: [[77101, "#1"], [77103, "#2"]] },
  { id: "19744", park: "Willard", coords: [37.8618, -122.2561], courts: [[68579, "#1"], [77113, "#2"]] },
  { id: "17524", park: "Strawberry Creek", coords: [37.8673, -122.2905], courts: [[68581, "Court"]] },
];

const outPath = process.argv[2] || "site/data/berkeley.json";
const ALL_IDS = PARKS.flatMap((p) => p.courts.map((c) => c[0]));

function pacificToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}
function addDays(ymd, n) {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function apiTime(h) {
  const ap = h < 12 ? "AM" : "PM", hh = h % 12 === 0 ? 12 : h % 12;
  return String(hh).padStart(2, "0") + ":00 " + ap;
}

async function slots(ymd, startHour, count) {
  const body = new URLSearchParams();
  for (const id of ALL_IDS) body.append("facilityIds[]", String(id));
  body.set("date", ymd);
  body.set("time", apiTime(startHour));
  body.set("slotSize", "3600");
  body.set("slotCount", String(count));
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${HOST}/permits/getMultiFacilityAvailabilityBySlot/${API_KEY}`, {
        method: "POST", body, headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (!j.availability) throw new Error((j.errors || ["bad response"]).join("; "));
      return j.availability;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const start = pacificToday();
console.log(`Berkeley availability for ${start} + ${DAYS - 1} days`);

// free[courtId][ymd] = 48-char string, one char per half hour, "1" = free.
const free = Object.fromEntries(ALL_IDS.map((id) => [id, {}]));
let daysOk = 0;
for (let d = 0; d < DAYS; d++) {
  const ymd = addDays(start, d);
  try {
    // The endpoint returns at most 10 slots per call: 7am-4pm, then 5pm-9pm.
    const parts = [
      await slots(ymd, FIRST_HOUR, 10),
      await slots(ymd, FIRST_HOUR + 10, LAST_HOUR - FIRST_HOUR + 1 - 10),
    ];
    for (const id of ALL_IDS) free[id][ymd] = "0".repeat(48);
    for (const av of parts) {
      for (const [fid, entries] of Object.entries(av)) {
        if (!free[fid]) continue;
        const bits = free[fid][ymd].split("");
        for (const o of Object.values(entries)) {
          if (!o || typeof o !== "object" || !o.date || o.status !== 2) continue;
          const m = o.date.match(/(\d{2}):(\d{2}) (AM|PM)$/);
          if (!m) continue;
          const h = (+m[1] % 12) + (m[3] === "PM" ? 12 : 0);
          bits[h * 2] = "1";
          bits[h * 2 + 1] = "1";
        }
        free[fid][ymd] = bits.join("");
      }
    }
    daysOk++;
  } catch (e) {
    console.warn(`  ! ${ymd}: ${e.message}`);
  }
}
console.log(`  ${daysOk}/${DAYS} days fetched`);
if (daysOk === 0) {
  console.error("Nothing fetched; not writing data.");
  process.exit(1);
}

const courts = PARKS.flatMap((p) => p.courts.map(([id, label]) => ({
  id: String(id), parkId: p.id, park: p.park, label, coords: p.coords, free: free[id],
})));
const data = { generatedAt: new Date().toISOString(), startDate: start, days: DAYS, courts };
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(data));
console.log(`  wrote ${outPath} (${courts.length} courts)`);
