// Fetches 7 days of tennis court availability from the City of Oakland's
// PerfectMind booking site and writes a compact JSON file for the web page.
//
// Usage: node scripts/fetch-oakland.mjs site/data/oakland.json
//
// PerfectMind requires an anti-forgery token plus its cookie on every POST,
// so each request first loads the matching HTML page to get both.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const BASE = "https://cityofoakland.perfectmind.com";
const CALENDAR_ID = "e4facb93-38df-44e3-8e2e-db4778408327";
const WIDGET_ID = "ef709cfd-55bf-4afc-b375-1be4775ff667";
const DAYS = 7;
const CONCURRENCY = 4;
const UA = "east-bay-courts availability snapshot (+https://github.com/sjyoung12/east-bay-courts)";

// Approximate court locations, used for "nearest first" sorting on the page.
const PARK_COORDS = {
  "Athol Plaza": [37.7993, -122.2545],
  "Bushrod": [37.8434, -122.2687],
  "Chabot": [37.8521, -122.2446],
  "Davie Stadium": [37.8165, -122.2302],
  "de Fremery": [37.8122, -122.2850],
  "Dimond": [37.8020, -122.2140],
  "Montclair": [37.8261, -122.2108],
  "Mosswood": [37.8252, -122.2620],
};

const outPath = process.argv[2] || "site/data/oakland.json";

// ---------- tiny cookie-aware HTTP session ----------
function session() {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  async function req(path, opts = {}) {
    const headers = { "User-Agent": UA, ...(opts.headers || {}) };
    if (jar.size) headers.Cookie = cookieHeader();
    const res = await fetch(BASE + path, { ...opts, headers, redirect: "follow" });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    if (!res.ok) throw new Error(`${opts.method || "GET"} ${path} → HTTP ${res.status}`);
    return res;
  }
  return { req };
}

function tokenFrom(html) {
  const m = html.match(/name="__RequestVerificationToken" type="hidden" value="([^"]+)"/)
        || html.match(/__RequestVerificationToken[^>]*value="([^"]+)"/);
  if (!m) throw new Error("No anti-forgery token on page");
  return m[1];
}

// Pulls the `services: [...]` JSON literal the landing page embeds in its script.
function servicesFrom(html) {
  const i = html.indexOf("services: [");
  if (i < 0) throw new Error("No services block on court page");
  let depth = 0, start = html.indexOf("[", i), j = start, inStr = false, esc = false;
  for (; j < html.length; j++) {
    const ch = html[j];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) break;
  }
  return JSON.parse(html.slice(start, j + 1));
}

function pacificToday() {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}
function addDays(ymd, n) {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function splitName(name) {
  const clean = name.replace(/\s+/g, " ").trim();
  if (/^Montclair Senior/i.test(clean)) return { park: "Montclair", label: "Senior" };
  let m = clean.match(/^(.*?) Tennis Stadium Court\s*#?\s*(\d+)$/i);
  if (m) return { park: `${m[1]} Stadium`, label: `#${m[2]}` };
  m = clean.match(/^(.*?) PB Court\s*#?\s*(\d+)$/i);
  if (m) return { park: m[1], label: `PB #${m[2]}` };
  m = clean.match(/^(.*?) Tennis Court\s*#?\s*(\d+)?$/i);
  if (m) return { park: m[1], label: m[2] ? `#${m[2]}` : "Court" };
  return { park: clean, label: "Court" };
}

async function listCourts() {
  const s = session();
  const listPath = `/Clients/BookMe4FacilityList/List?calendarId=${CALENDAR_ID}&widgetId=${WIDGET_ID}&embed=False`;
  const token = tokenFrom(await (await s.req(listPath)).text());
  const body = new URLSearchParams({
    take: "100", skip: "0", page: "1", pageSize: "100",
    calendarId: CALENDAR_ID, widgetId: WIDGET_ID, __RequestVerificationToken: token,
  });
  const res = await s.req("/Clients/BookMe4FacilityList/GetFacilities", {
    method: "POST", body,
    headers: { "X-Requested-With": "XMLHttpRequest", Referer: BASE + listPath },
  });
  const j = await res.json();
  return j.facilities.filter((f) => /tennis/i.test(f.FacilityType));
}

async function courtAvailability(fac, startYmd) {
  const s = session();
  const pagePath = `/Clients/BookMe4LandingPages/Facility?facilityId=${fac.ID}&widgetId=${WIDGET_ID}&calendarId=${CALENDAR_ID}`;
  const html = await (await s.req(pagePath)).text();
  const token = tokenFrom(html);
  const service = servicesFrom(html)[0];
  // Use the shortest bookable length: it gives the finest view of what's free.
  const dur = [...service.Durations].sort((a, b) => a.Duration - b.Duration)[0];

  const body = new URLSearchParams({
    facilityId: fac.ID,
    date: `${startYmd}T00:00:00.000Z`,
    daysCount: String(DAYS),
    duration: String(dur.Duration),
    serviceId: service.ID,
    __RequestVerificationToken: token,
  });
  for (const id of dur.DurationIDs) body.append("durationIds[]", id);
  if (dur.FeeType != null) body.set("feeType", String(dur.FeeType));

  const res = await s.req("/Clients/BookMe4LandingPages/FacilityAvailability", {
    method: "POST", body,
    headers: { "X-Requested-With": "XMLHttpRequest", Referer: BASE + pagePath },
  });
  const j = await res.json();

  // free[ymd] = 48-char string, one char per half hour, "1" = free.
  const free = {};
  for (let i = 0; i < DAYS; i++) free[addDays(startYmd, i)] = "0".repeat(48);
  for (const day of j.availabilities || []) {
    const ms = Number(String(day.Date).match(/-?\d+/)[0]);
    const ymd = new Date(ms).toISOString().slice(0, 10);
    if (!(ymd in free)) continue;
    const bits = free[ymd].split("");
    for (const g of day.BookingGroups || []) {
      for (const spot of g.AvailableSpots || []) {
        if (spot.IsDisabled) continue;
        const startHalf = spot.Time.Hours * 2 + Math.floor(spot.Time.Minutes / 30);
        const halves = Math.max(1, Math.round((spot.Duration?.TotalMinutes || dur.Duration) / 30));
        for (let k = 0; k < halves && startHalf + k < 48; k++) bits[startHalf + k] = "1";
      }
    }
    free[ymd] = bits.join("");
  }

  const { park, label } = splitName(fac.Name);
  return {
    id: fac.ID,
    name: fac.Name.replace(/\s+/g, " ").trim(),
    park, label,
    address: fac.Address?.Street?.trim() || "",
    coords: PARK_COORDS[park] || (fac.Latitude ? [fac.Latitude, fac.Longitude] : null),
    minMinutes: dur.Duration,
    bookDaysAhead: fac.BookFutureEventsInDays,
    free,
  };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i]); }
      catch (e) { console.warn(`  ! ${items[i].Name}: ${e.message}`); out[i] = null; }
    }
  }));
  return out;
}

const start = pacificToday();
console.log(`Oakland availability for ${start} + ${DAYS - 1} days`);
const facilities = await listCourts();
console.log(`  ${facilities.length} tennis courts listed`);
const courts = (await pool(facilities, CONCURRENCY, (f) => courtAvailability(f, start))).filter(Boolean);
console.log(`  ${courts.length} courts fetched`);
if (courts.length < Math.ceil(facilities.length / 2)) {
  console.error("Too many courts failed; not writing data.");
  process.exit(1);
}
courts.sort((a, b) => a.park.localeCompare(b.park) || a.label.localeCompare(b.label, undefined, { numeric: true }));

const data = {
  generatedAt: new Date().toISOString(),
  startDate: start,
  days: DAYS,
  calendarId: CALENDAR_ID,
  widgetId: WIDGET_ID,
  courts,
};
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(data));
console.log(`  wrote ${outPath}`);
