const POLL_MS = 1000;
const TICK_MS = 250;

const STATUS_TEXT = {
  missing: "No reading",
  stale: "Stale",
  bad: "Bad reading",
  unknown: "Unknown quality",
};

const tiles = new Map();
let snapshot = null;
let syncedAt = 0;

function staleLabel(seconds) {
  if (seconds % 60 === 0) return String(seconds / 60) + " min";
  return String(seconds) + " s";
}

function formatReading(value, unit) {
  const shown = (Math.round(value * 10) / 10).toFixed(1);
  if (unit === "F" || unit === "C") return shown + " \u00b0" + unit;
  return shown + " " + unit;
}

function hubAge(point) {
  if (typeof point.age_seconds !== "number") return null;
  return point.age_seconds + (performance.now() - syncedAt) / 1000;
}

function effectiveStatus(point) {
  if (point.status === "missing") return "missing";
  const age = hubAge(point);
  if (snapshot && age != null && age >= snapshot.stale_after_seconds) return "stale";
  return point.status;
}

function render() {
  const root = document.getElementById("points");
  if (!snapshot || !Array.isArray(snapshot.points)) return;
  const seen = new Set();
  snapshot.points.forEach(function (point) {
    seen.add(point.point_id);
    let tile = tiles.get(point.point_id);
    if (!tile) {
      tile = document.createElement("article");
      tile.className = "tile";
      const nameEl = document.createElement("div");
      nameEl.className = "name";
      const valueEl = document.createElement("div");
      valueEl.className = "value";
      const metaEl = document.createElement("div");
      metaEl.className = "meta";
      tile.append(nameEl, valueEl, metaEl);
      root.append(tile);
      tiles.set(point.point_id, tile);
    }
    const status = effectiveStatus(point);
    tile.dataset.point = point.point_id;
    tile.dataset.status = status;
    tile.querySelector(".name").textContent = point.name;
    const valueEl = tile.querySelector(".value");
    const metaEl = tile.querySelector(".meta");
    const age = hubAge(point);
    if (status === "live" && typeof point.value === "number") {
      valueEl.textContent = formatReading(point.value, point.unit);
      metaEl.textContent = point.node_id + " · " + Math.floor(age) + "s ago";
    } else {
      valueEl.textContent = STATUS_TEXT[status] || "No reading";
      metaEl.textContent = age == null
        ? point.node_id
        : point.node_id + " · last heard " + Math.floor(age) + "s ago";
    }
  });
  Array.from(tiles.keys()).forEach(function (id) {
    if (!seen.has(id)) {
      tiles.get(id).remove();
      tiles.delete(id);
    }
  });
}

async function poll() {
  try {
    const response = await fetch("/api/readings", { cache: "no-store" });
    if (!response.ok) throw new Error("hub status " + response.status);
    snapshot = await response.json();
    syncedAt = performance.now();
    document.getElementById("banner").textContent = snapshot.mqtt_connected
      ? ""
      : "MQTT broker not connected.";
    document.getElementById("subtitle").textContent =
      snapshot.system_name +
      " · hub " +
      snapshot.server_time +
      " · stale after " +
      staleLabel(snapshot.stale_after_seconds);
  } catch (error) {
    document.getElementById("banner").textContent = "Can't reach the hub.";
  }
  render();
}

poll();
setInterval(poll, POLL_MS);
setInterval(render, TICK_MS);
