// Fictional sample data shared by every mockup. Times are relative to page load.
const NOW0 = Date.now();
const ago = (m) => new Date(NOW0 - m * 60000).toISOString();
const DATA = {
  event: { name: "Northern Informatics Open 2026", archived: false },
  sessions: ["Finals · Contest day", "Finals · Practice round"],
  session: { name: "Finals · Contest day", intake_open: true, categories: ["Workstation", "Network", "Judge system", "Problem statement", "Printing", "Other"], max_image_mb: 8, max_images: 6, max_total_mb: 30 },
  me: { name: "Priya Raman", initials: "PR", roles: ["volunteer", "specialist"], admin: true },
  teams: [
    { id: "t1", name: "Team Aurora", location: "Hall A · Table 4", x: 1, y: 1 },
    { id: "t2", name: "Byte Bandits", location: "Hall A · Table 7", x: 4, y: 1 },
    { id: "t3", name: "Null Pointers", location: "Hall A · Table 12", x: 3, y: 3 },
    { id: "t4", name: "Segfault Society", location: "Hall B · Table 2", x: 7, y: 1 },
    { id: "t5", name: "Off By One", location: "Hall B · Table 9", x: 8, y: 3 },
    { id: "t6", name: "Café Lambda", location: "Hall B · Table 15", x: 6, y: 4 },
    { id: "t7", name: "Greedy Goblins", location: "Hall A · Table 18", x: 1, y: 4 },
    { id: "t8", name: "Heap Heroes", location: "Hall B · Table 21", x: 9, y: 5 },
    { id: "t9", name: "Recursive Rabbits", location: "Hall A · Table 22", x: 4, y: 5 },
  ],
  people: { "Priya Raman": "PR", "Marcus Lee": "ML", "Sofia Ortega": "SO", "Dev Patel": "DP", "Hana Kim": "HK" },
  issues: [
    { id: "i31", number: 31, team: "t3", category: "Workstation", description: "Keyboard stopped responding after the IDE froze. Mouse still works.", status: "open", created: 2.2, first: null, owner: null, reporter: "Null Pointers" },
    { id: "i30", number: 30, team: "t5", category: "Judge system", description: "Submission stuck on “Judging” for problem C for over ten minutes.", status: "escalated", created: 14.5, first: 12.9, owner: "Marcus Lee", reporter: "Off By One" },
    { id: "i29", number: 29, team: "t1", category: "Network", description: "Cannot reach the contest site. Browser shows a connection reset.", status: "claimed", created: 9.1, first: 7.4, owner: "Priya Raman", reporter: "Team Aurora" },
    { id: "i28", number: 28, team: "t6", category: "Printing", description: "Print request from 10:42 never arrived at our table.", status: "claimed", created: 23.8, first: 21.0, owner: "Sofia Ortega", reporter: "Café Lambda" },
    { id: "i27", number: 27, team: "t2", category: "Problem statement", description: "Sample output for problem E contradicts the constraints in section 2.", status: "open", created: 5.6, first: null, owner: null, reporter: "Dev Patel" },
    { id: "i26", number: 26, team: "t4", category: "Workstation", description: "Monitor flickers and goes black every few minutes.", status: "resolved", created: 48, first: 46.5, owner: "Priya Raman", reporter: "Segfault Society", resolved: 31, award: { minutes: 10, explanation: "Workstation replaced; 17 minutes lost.", by: "Hana Kim", at: 25, applied: null } },
    { id: "i25", number: 25, team: "t7", category: "Network", description: "Intermittent packet loss when submitting large files.", status: "resolved", created: 72, first: 70, owner: "Marcus Lee", reporter: "Greedy Goblins", resolved: 52, award: { minutes: 5, explanation: "Brief outage confirmed by network team.", by: "Hana Kim", at: 44, applied: { by: "Dev Patel", at: 40 } } },
    { id: "i24", number: 24, team: "t8", category: "Other", description: "Chair is broken and the table is wobbling.", status: "resolved", created: 95, first: 93, owner: "Sofia Ortega", reporter: "Heap Heroes", resolved: 88 },
    { id: "i23", number: 23, team: "t9", category: "Judge system", description: "Scoreboard shows our accepted solution as wrong answer.", status: "claimed", created: 31, first: 29.5, owner: "Marcus Lee", reporter: "Recursive Rabbits", reopened: true },
  ],
  history: {
    i31: [{ t: "event", text: "Submitted by Null Pointers", at: 2.2 }],
    i30: [
      { t: "event", text: "Submitted by Off By One", at: 14.5 },
      { t: "event", text: "Claimed by Marcus Lee", at: 12.9 },
      { t: "public", who: "Marcus Lee", text: "We can see the submission in the queue. Checking the judge host now.", at: 11.2 },
      { t: "internal", who: "Marcus Lee", text: "Judge host 3 has a stuck worker. Needs a specialist to restart it safely.", at: 9.0 },
      { t: "event", text: "Marcus Lee requested a specialist handoff", at: 8.8 },
    ],
    i29: [
      { t: "event", text: "Submitted by Team Aurora", at: 9.1 },
      { t: "event", text: "Claimed by Priya Raman", at: 7.4 },
      { t: "public", who: "Priya Raman", text: "On my way to Table 4.", at: 7.2 },
      { t: "internal", who: "Priya Raman", text: "Cable looks loose at the switch. Swapping the port first.", at: 3.1 },
      { t: "public", who: "Team Aurora", text: "Thanks! It came back for a second, then dropped again.", at: 2.4 },
    ],
    i28: [{ t: "event", text: "Submitted by Café Lambda", at: 23.8 }, { t: "event", text: "Claimed by Sofia Ortega", at: 21.0 }, { t: "public", who: "Sofia Ortega", text: "Checking the print queue now.", at: 20.1 }],
    i27: [{ t: "event", text: "Submitted by Dev Patel for Byte Bandits", at: 5.6 }],
    i26: [
      { t: "event", text: "Submitted by Segfault Society", at: 48 },
      { t: "event", text: "Claimed by Priya Raman", at: 46.5 },
      { t: "internal", who: "Priya Raman", text: "Spare workstation W-17 is ready. Moving the team's session over.", at: 40 },
      { t: "resolve", who: "Priya Raman", text: "Device issue resolved", at: 31 },
      { t: "award", who: "Hana Kim", text: "10 minutes awarded", at: 25 },
    ],
    i25: [{ t: "event", text: "Submitted by Greedy Goblins", at: 72 }, { t: "resolve", who: "Marcus Lee", text: "Service restored", at: 52 }, { t: "award", who: "Hana Kim", text: "5 minutes awarded", at: 44 }, { t: "event", text: "Dev Patel confirmed the award was applied externally", at: 40 }],
    i24: [{ t: "event", text: "Submitted by Heap Heroes", at: 95 }, { t: "resolve", who: "Sofia Ortega", text: "Resolved without comment", at: 88 }],
    i23: [
      { t: "event", text: "Submitted by Recursive Rabbits", at: 31 },
      { t: "resolve", who: "Marcus Lee", text: "Problem statement clarified", at: 22 },
      { t: "reopen", who: "Recursive Rabbits", text: "Reopened: the verdict is still wrong after the rejudge.", at: 12 },
      { t: "internal", who: "Marcus Lee", text: "Rejudge job failed silently. Asking the judge team.", at: 6 },
    ],
  },
  images: {
    i29: [{ name: "switch-port.jpg", who: "Priya Raman", vis: "internal", hue: 200 }, { name: "error-page.png", who: "Priya Raman", vis: "public", hue: 340 }],
    i26: [{ name: "monitor.webp", who: "Priya Raman", vis: "public", hue: 30 }],
  },
  members: [
    { name: "Priya Raman", username: "priya", roles: ["volunteer", "specialist"], admin: true },
    { name: "Marcus Lee", username: "marcus", roles: ["volunteer"], admin: false },
    { name: "Sofia Ortega", username: "sofia", roles: ["volunteer"], admin: false },
    { name: "Dev Patel", username: "dev", roles: ["specialist"], admin: false },
    { name: "Hana Kim", username: "hana", roles: ["jury"], admin: false },
    { name: "Team Aurora", username: "team-aurora", team: "Team Aurora" },
    { name: "Byte Bandits", username: "byte-bandits", team: "Byte Bandits" },
    { name: "Null Pointers", username: "null-pointers", team: "Null Pointers" },
  ],
};
const STATUS = {
  open: { label: "Open", icon: "circle-dashed" },
  claimed: { label: "In progress", icon: "circle-dot" },
  escalated: { label: "Awaiting specialist", icon: "arrow-up-right" },
  resolved: { label: "Resolved", icon: "circle-check" },
};
const teamOf = (issue) => DATA.teams.find((t) => t.id === issue.team);
// Unresolved time: from creation to now, or to resolution.
const elapsedMs = (issue) => ((issue.status === "resolved" ? issue.created - issue.resolved : issue.created) * 60000) + (issue.status === "resolved" ? 0 : Date.now() - NOW0);
const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(r).padStart(2, "0"); };
const relTime = (m) => m < 1 ? "just now" : m < 60 ? Math.round(m) + "m ago" : Math.floor(m / 60) + "h " + Math.round(m % 60) + "m ago";
const wallTime = (m) => new Date(NOW0 - m * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const initials = (n) => n.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Aging tier for live timers: fresh < 10 min, warning < 20 min, critical after.
const age = (issue) => issue.status === "resolved" ? "done" : elapsedMs(issue) < 600000 ? "fresh" : elapsedMs(issue) < 1200000 ? "warn" : "crit";
// Small fuzzy match: every query token must prefix-match a word in name or location.
const fuzzy = (q, s) => { const words = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/); return q.toLowerCase().split(/\s+/).filter(Boolean).every((tok) => words.some((w) => w.startsWith(tok))); };
