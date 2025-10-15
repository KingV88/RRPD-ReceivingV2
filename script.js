console.log("RRPD Dashboard Script Loaded");

document.addEventListener("DOMContentLoaded", () => {
  const loading = document.getElementById("loading");
  const refreshBtn = document.getElementById("refresh_btn");
  const panels = document.querySelectorAll(".panel");
  const tabs = document.querySelectorAll(".tab");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      panels.forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.tab).classList.add("active");
    });
  });

  async function fetchData() {
    loading.textContent = "Fetching data...";
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      console.log("Data fetched:", data);
      loading.textContent = "Data loaded successfully.";
      renderScanners(data.scanners);
      renderClassifications(data.classifications);
      renderTrend(data.trends);
    } catch (err) {
      console.error("Error loading data:", err);
      loading.textContent = "Error fetching data — using local fallback.";
    }
  }

  refreshBtn.addEventListener("click", fetchData);
  fetchData();

  function renderScanners(scanners) {
    const table = document.getElementById("scanner_totals");
    table.innerHTML = `
      <tr><th>Scanner</th><th>Total</th></tr>
      ${Object.entries(scanners)
        .map(([name, val]) => `<tr><td>${name}</td><td>${val}</td></tr>`)
        .join("")}
    `;
  }

  function renderClassifications(classes) {
    const table = document.getElementById("class_table");
    table.innerHTML = `
      <tr><th>Type</th><th>Count</th></tr>
      ${Object.entries(classes)
        .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
        .join("")}
    `;
  }

  function renderTrend(trends) {
    const ctx = document.getElementById("trend_chart").getContext("2d");
    new Chart(ctx, {
      type: "bar",
      data: {
        labels: Object.keys(trends),
        datasets: [{
          label: "Weekly Totals",
          data: Object.values(trends),
          backgroundColor: "#0284ff"
        }]
      }
    });
  }
});
