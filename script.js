document.addEventListener("DOMContentLoaded", () => {
  console.log("✅ RRPD Dashboard Loaded");

  const apiBase = "https://rrpd.netlify.app/.netlify/functions";
  const refreshBtn = document.getElementById("refreshData");
  const manualForm = document.getElementById("manualEntryForm");
  const manualInput = document.getElementById("manualTracking");
  const statusBox = document.getElementById("statusBox");

  // --- Utility: Update status display ---
  function updateStatus(msg, color = "lightblue") {
    if (statusBox) {
      statusBox.innerText = msg;
      statusBox.style.color = color;
    } else {
      console.log(msg);
    }
  }

  // --- Fetch data from returns function ---
  async function loadReturns() {
    updateStatus("Fetching return data...");
    try {
      const res = await fetch(`${apiBase}/returns`);
      const data = await res.json();

      if (!data || data.length === 0) {
        updateStatus("No data found.", "orange");
        return;
      }

      console.log("✅ Return data loaded:", data);
      updateStatus("Data successfully loaded!");
      renderDashboard(data);
    } catch (err) {
      console.error("❌ Error fetching returns:", err);
      updateStatus("Error fetching data. Try manual entry or refresh.", "red");
    }
  }

  // --- Manual entry for tracking number ---
  async function handleManualSubmit(e) {
    e.preventDefault();
    const track = manualInput.value.trim();
    if (!track) {
      updateStatus("Please enter a tracking number.", "orange");
      return;
    }

    updateStatus(`Fetching photos for ${track}...`);
    try {
      const res = await fetch(`${apiBase}/photos?id=${track}`);
      const data = await res.json();

      if (data && data.photos && data.photos.length > 0) {
        updateStatus(`Found ${data.photos.length} photos for ${track}!`, "lightgreen");
        console.log("Photos:", data.photos);
        renderPhotos(data.photos);
      } else {
        updateStatus("No photos found for this tracking number.", "orange");
      }
    } catch (err) {
      console.error("❌ Manual fetch failed:", err);
      updateStatus("Could not load photos. Try again.", "red");
    }
  }

  // --- Dummy renderers (replace with real chart functions) ---
  function renderDashboard(data) {
    console.log("Render dashboard with", data.length, "items");
  }

  function renderPhotos(photos) {
    console.log("Render photos:", photos);
  }

  // --- Event Listeners ---
  if (refreshBtn) refreshBtn.addEventListener("click", loadReturns);
  if (manualForm) manualForm.addEventListener("submit", handleManualSubmit);

  // --- Auto Load on Start ---
  loadReturns();
});
