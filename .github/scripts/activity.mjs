// Generates the streak card and contribution graph SVGs from the GitHub GraphQL API.
// Usage: GITHUB_TOKEN=... node activity.mjs <user> <outDir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [user, outDir = "dist"] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!user || !token) throw new Error("usage: GITHUB_TOKEN=... node activity.mjs <user> [outDir]");

const themes = {
  dark: { bg: "#0E1017", stroke: "#1E2230", title: "#E9EDF5", text: "#A1A7B6", muted: "#7C859A", accent: "#B29AFB", accent2: "#26D8EB", area: "#9273EE" },
  light: { bg: "#FFFFFF", stroke: "#E4E7EE", title: "#12141C", text: "#4B5263", muted: "#7C859A", accent: "#8059D9", accent2: "#16B4DA", area: "#B29AFB" },
};

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json));
  return json.data;
}

async function fetchDays() {
  const { user: u } = await gql(`query($login:String!){user(login:$login){createdAt}}`, { login: user });
  const start = new Date(u.createdAt);
  const now = new Date();
  const days = [];
  for (let from = new Date(Date.UTC(start.getUTCFullYear(), 0, 1)); from < now; from.setUTCFullYear(from.getUTCFullYear() + 1)) {
    const to = new Date(Math.min(Date.UTC(from.getUTCFullYear(), 11, 31, 23, 59, 59), now));
    const data = await gql(
      `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){
        contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`,
      { login: user, from: from.toISOString(), to: to.toISOString() },
    );
    for (const w of data.user.contributionsCollection.contributionCalendar.weeks)
      for (const d of w.contributionDays) days.push({ date: d.date, count: d.contributionCount });
  }
  const seen = new Set();
  return days.filter((d) => !seen.has(d.date) && seen.add(d.date)).sort((a, b) => a.date.localeCompare(b.date));
}

function stats(days) {
  const total = days.reduce((s, d) => s + d.count, 0);
  let longest = { len: 0 }, run = { len: 0 };
  for (const d of days) {
    if (d.count > 0) {
      run = run.len ? { ...run, len: run.len + 1, end: d.date } : { len: 1, start: d.date, end: d.date };
      if (run.len > longest.len) longest = run;
    } else run = { len: 0 };
  }
  // Today without contributions yet doesn't break the current streak.
  let i = days.length - 1;
  if (i >= 0 && days[i].count === 0) i--;
  let current = { len: 0 };
  for (; i >= 0 && days[i].count > 0; i--)
    current = { len: current.len + 1, start: days[i].date, end: current.end ?? days[i].date };
  return { total, first: days.find((d) => d.count > 0)?.date ?? days[0]?.date, current, longest };
}

const fmt = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const range = (s) => (s.len ? (s.start === s.end ? fmt(s.start) : `${fmt(s.start)} – ${fmt(s.end)}`) : "No streak");
const font = `font-family="'Segoe UI', Ubuntu, 'Helvetica Neue', Sans-Serif"`;

function streakSvg(s, t) {
  const W = 495, H = 195;
  const col = (x, num, label, sub, color) => `
    <text x="${x}" y="92" text-anchor="middle" ${font} font-size="28" font-weight="700" fill="${t.title}">${num.toLocaleString("en-US")}</text>
    <text x="${x}" y="140" text-anchor="middle" ${font} font-size="14" fill="${color}">${label}</text>
    <text x="${x}" y="164" text-anchor="middle" ${font} font-size="12" fill="${t.muted}">${sub}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="14" fill="${t.bg}"/>
  <line x1="165" y1="28" x2="165" y2="170" stroke="${t.stroke}"/>
  <line x1="330" y1="28" x2="330" y2="170" stroke="${t.stroke}"/>
  ${col(82.5, s.total, "Total Contributions", `${s.first ? fmt(s.first) : ""} – Present`, t.text)}
  <circle cx="247.5" cy="83" r="40" fill="none" stroke="${t.accent}" stroke-width="5"/>
  <path d="M247.5 30 c6 6 9 11 4 16 c-3 -3 -6 -4 -8 -1 c-3 -5 0 -10 4 -15z" fill="${t.accent2}"/>
  <text x="247.5" y="93" text-anchor="middle" ${font} font-size="28" font-weight="700" fill="${t.title}">${s.current.len}</text>
  <text x="247.5" y="148" text-anchor="middle" ${font} font-size="14" font-weight="700" fill="${t.accent}">Current Streak</text>
  <text x="247.5" y="168" text-anchor="middle" ${font} font-size="12" fill="${t.muted}">${range(s.current)}</text>
  ${col(412.5, s.longest.len, "Longest Streak", range(s.longest), t.text)}
</svg>`;
}

function graphSvg(days, t) {
  const last = days.slice(-31);
  const W = 1200, H = 360, L = 60, R = 30, T = 70, B = 50;
  const max = Math.max(4, ...last.map((d) => d.count));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const x = (i) => L + (i * (W - L - R)) / (last.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const pts = last.map((d, i) => `${x(i).toFixed(1)},${y(d.count).toFixed(1)}`);
  const grid = [0, 1, 2, 3, 4].map((k) => `
    <line x1="${L}" y1="${y(k * step)}" x2="${W - R}" y2="${y(k * step)}" stroke="${t.stroke}"/>
    <text x="${L - 12}" y="${y(k * step) + 4}" text-anchor="end" ${font} font-size="12" fill="${t.muted}">${k * step}</text>`).join("");
  const labels = last.map((d, i) => `<text x="${x(i)}" y="${H - B + 22}" text-anchor="middle" ${font} font-size="11" fill="${t.muted}">${Number(d.date.slice(8))}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="14" fill="${t.bg}"/>
  <text x="${W / 2}" y="40" text-anchor="middle" ${font} font-size="20" font-weight="700" fill="${t.title}">Contribution graph</text>
  ${grid}
  <polygon points="${x(0)},${y(0)} ${pts.join(" ")} ${x(last.length - 1)},${y(0)}" fill="${t.area}" fill-opacity="0.25"/>
  <polyline points="${pts.join(" ")}" fill="none" stroke="${t.accent}" stroke-width="2.5" stroke-linejoin="round"/>
  ${last.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.count)}" r="3.5" fill="${t.accent2}"><title>${d.date}: ${d.count}</title></circle>`).join("")}
  ${labels}
</svg>`;
}

const days = await fetchDays();
const s = stats(days);
mkdirSync(outDir, { recursive: true });
for (const [name, t] of Object.entries(themes)) {
  writeFileSync(join(outDir, `streak-${name}.svg`), streakSvg(s, t));
  writeFileSync(join(outDir, `graph-${name}.svg`), graphSvg(days, t));
}
console.log(`total=${s.total} current=${s.current.len} longest=${s.longest.len}`);
