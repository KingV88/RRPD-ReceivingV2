/* ===================================================
   RRPD Receiving - Final Script
   Handles navigation, data storage, charts, logs,
   admin, quiz, export, and dark mode
=================================================== */

// ================================
// State & Helpers
// ================================
let state = {
  racks: [],
  classifications: [],
  logs: [],
  quiz: [],
  miss: [],
  goals: {
    racks: 10,
    axles: 10,
    gearboxes: 5
  },
  admin: { logged: false, user: "", pass: "" }
};

// Load saved data from localStorage
function loadState() {
  const saved = localStorage.getItem("rrpd_state");
  if (saved) state = JSON.parse(saved);
}
function saveState() {
  localStorage.setItem("rrpd_state", JSON.stringify(state));
}
loadState();

// ================================
// Navigation
// ================================
function openPanel(panelId) {
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.getElementById(panelId).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.panel === panelId);
  });
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  const panel = btn.dataset.panel;
  if (panel) {
    btn.addEventListener("click", () => openPanel(panel));
  }
});

// ================================
// Toast Notifications
// ================================
function showToast(msg, type = "info") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.style.background = type === "error" ? "var(--danger)" : "var(--primary)";
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

// ================================
// Admin
// ================================
const adminBadge = document.getElementById("admin_badge");
function updateAdminUI() {
  const hint = document.getElementById("admin_hint");
  if (state.admin.logged) {
    hint.textContent = state.admin.user;
    adminBadge.classList.add("active");
  } else {
    hint.textContent = "—";
    adminBadge.classList.remove("active");
  }
}
document.getElementById("admin_login").addEventListener("click", () => {
  const user = document.getElementById("admin_user").value;
  const pass = document.getElementById("admin_pass").value;
  if (!user || !pass) return showToast("Enter user & pass", "error");
  state.admin = { logged: true, user, pass };
  saveState();
  updateAdminUI();
  showToast("Admin logged in");
});
document.getElementById("admin_logout").addEventListener("click", () => {
  state.admin.logged = false;
  saveState();
  updateAdminUI();
  showToast("Logged out");
});
updateAdminUI();

// ================================
// Dark Mode
// ================================
const darkToggle = document.getElementById("pref_dark");
if (darkToggle) {
  // Apply saved pref
  if (localStorage.getItem("pref_dark") === "true") {
    document.body.classList.add("dark");
    darkToggle.checked = true;
  }
  darkToggle.addEventListener("change", () => {
    if (darkToggle.checked) {
      document.body.classList.add("dark");
      localStorage.setItem("pref_dark", "true");
    } else {
      document.body.classList.remove("dark");
      localStorage.setItem("pref_dark", "false");
    }
  });
}

// ================================
// Goals Save
// ================================
document.getElementById("save_goals").addEventListener("click", () => {
  state.goals.racks = +document.getElementById("goal_racks").value || state.goals.racks;
  state.goals.axles = +document.getElementById("goal_axles").value || state.goals.axles;
  state.goals.gearboxes = +document.getElementById("goal_gearboxes").value || state.goals.gearboxes;
  saveState();
  renderGoals();
  showToast("Goals saved");
});

function renderGoals() {
  const el = document.getElementById("goals_area");
  if (!el) return;
  el.innerHTML = `
    Racks: ${state.goals.racks} /day •
    Axles: ${state.goals.axles} /day •
    Gearboxes: ${state.goals.gearboxes} /day
  `;
}
renderGoals();

// ================================
// Quick Data Input
// ================================
document.getElementById("di_submit").addEventListener("click", () => {
  const cat = document.getElementById("di_category").value;
  const date = document.getElementById("di_date").value;
  const good = +document.getElementById("di_good").value || 0;
  const used = +document.getElementById("di_coreused").value || 0;
  if (!date) return showToast("Pick a date", "error");
  state.racks.push({ cat, date, good, used });
  state.logs.push({ type: cat, date, good, used });
  saveState();
  showToast("Data saved");
});
document.getElementById("di_reset").addEventListener("click", () => {
  document.querySelectorAll("#input input").forEach(i => i.value = "");
});

// ================================
// Logs Rendering
// ================================
function renderLogs() {
  const el = document.getElementById("all_logs_table");
  if (!el) return;
  if (!state.logs.length) {
    el.textContent = "No logs yet.";
    return;
  }
  let html = `<table><tr><th>Date</th><th>Type</th><th>Good</th><th>Used</th></tr>`;
  state.logs.forEach(l => {
    html += `<tr><td>${l.date}</td><td>${l.type}</td><td>${l.good}</td><td>${l.used}</td></tr>`;
  });
  html += `</table>`;
  el.innerHTML = html;
}
renderLogs();

// ================================
// Miss Inspections
// ================================
document.getElementById("miss_submit").addEventListener("click", () => {
  const date = document.getElementById("miss_date").value;
  const issue = document.getElementById("miss_issue").value;
  if (!date || !issue) return showToast("Enter date + issue", "error");
  state.miss.push({ date, issue });
  state.logs.push({ type: "miss", date, issue });
  saveState();
  renderMiss();
  showToast("Miss logged");
});
function renderMiss() {
  const el = document.getElementById("miss_table");
  if (!el) return;
  if (!state.miss.length) {
    el.textContent = "No miss inspections.";
    return;
  }
  let html = `<table><tr><th>Date</th><th>Issue</th></tr>`;
  state.miss.forEach(m => html += `<tr><td>${m.date}</td><td>${m.issue}</td></tr>`);
  html += `</table>`;
  el.innerHTML = html;
}
renderMiss();

// ================================
// Charts (basic example)
// ================================
function renderCharts() {
  const ctx = document.getElementById("stacked_all");
  if (!ctx) return;
  const labels = state.racks.map(r => r.date);
  const dataGood = state.racks.map(r => r.good);
  const dataUsed = state.racks.map(r => r.used);
  new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Good", data: dataGood, backgroundColor: "#10b981" },
        { label: "Used/Core", data: dataUsed, backgroundColor: "#ef4444" }
      ]
    },
    options: { responsive: true, plugins: { legend: { position: "bottom" } } }
  });
}
renderCharts();
