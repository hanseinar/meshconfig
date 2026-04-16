// MeshConfig — app.js
// Phase 1 MVP skeleton
// WebSerial + Meshtastic node configuration tool

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  port: null,
  connected: false,
  nodeInfo: null,
  config: null,
};

// ─── Profiles ─────────────────────────────────────────────────────────────────
// Hardcoded profiles for Phase 1.
// Each profile maps to Meshtastic config fields (to be applied on connect).

const PROFILES = {
  solar: {
    label: "Solar / Fixed Install",
    role: "CLIENT_MUTE",
    positionBroadcastSecs: 3600,
    deviceBatteryIna219Enabled: true,
    txPower: 17,
  },
  handheld: {
    label: "Handheld / Personal",
    role: "CLIENT",
    positionBroadcastSecs: 300,
    txPower: 20,
  },
  repeater: {
    label: "Repeater",
    role: "ROUTER",
    hopLimit: 7,
    txPower: 20,
  },
  sensor: {
    label: "Sensor",
    role: "CLIENT_MUTE",
    telemetryDeviceUpdateInterval: 60,
    positionBroadcastSecs: 3600,
    txPower: 17,
  },
};

// ─── DOM References ────────────────────────────────────────────────────────────

const btnConnect       = document.getElementById("btn-connect");
const statusEl         = document.getElementById("connection-status");
const sectionNodeInfo  = document.getElementById("section-nodeinfo");
const sectionProfiles  = document.getElementById("section-profiles");
const sectionBackup    = document.getElementById("section-backup");
const sectionConfig    = document.getElementById("section-config");
const configDisplay    = document.getElementById("config-display");
const btnBackup        = document.getElementById("btn-backup");
const inputRestore     = document.getElementById("input-restore");
const btnRestore       = document.getElementById("btn-restore");

// ─── Connection ───────────────────────────────────────────────────────────────

btnConnect.addEventListener("click", async () => {
  if (state.connected) {
    await disconnect();
  } else {
    await connect();
  }
});

async function connect() {
  if (!("serial" in navigator)) {
    alert("WebSerial is not supported in this browser.\nPlease use Chrome or Edge.");
    return;
  }

  setStatus("connecting");

  try {
    state.port = await navigator.serial.requestPort();
    await state.port.open({ baudRate: 115200 });

    state.connected = true;
    setStatus("connected");
    btnConnect.textContent = "Disconnect";

    showConnectedSections();

    // TODO: Initialize Meshtastic JS client here and read node info + config
    // Placeholder until @meshtastic/js is integrated:
    displayPlaceholderNodeInfo();

  } catch (err) {
    console.error("Connection failed:", err);
    setStatus("disconnected");
    alert("Could not connect: " + err.message);
  }
}

async function disconnect() {
  try {
    if (state.port) {
      await state.port.close();
      state.port = null;
    }
  } catch (err) {
    console.warn("Error during disconnect:", err);
  }

  state.connected = false;
  state.nodeInfo = null;
  state.config = null;

  setStatus("disconnected");
  btnConnect.textContent = "Connect via USB";
  hideConnectedSections();
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function setStatus(status) {
  statusEl.className = "status status--" + status;
  const labels = {
    disconnected: "Disconnected",
    connecting:   "Connecting…",
    connected:    "Connected",
  };
  statusEl.textContent = labels[status] || status;
}

function showConnectedSections() {
  sectionNodeInfo.classList.remove("hidden");
  sectionProfiles.classList.remove("hidden");
  sectionBackup.classList.remove("hidden");
  sectionConfig.classList.remove("hidden");
}

function hideConnectedSections() {
  sectionNodeInfo.classList.add("hidden");
  sectionProfiles.classList.add("hidden");
  sectionBackup.classList.add("hidden");
  sectionConfig.classList.add("hidden");
  configDisplay.textContent = "No config loaded.";
}

// ─── Node Info ─────────────────────────────────────────────────────────────────

function displayNodeInfo(info) {
  document.getElementById("info-name").textContent = info.longName || "—";
  document.getElementById("info-hw").textContent   = info.hwModel  || "—";
  document.getElementById("info-fw").textContent   = info.firmwareVersion || "—";
  document.getElementById("info-id").textContent   = info.id ? "!" + info.id.toString(16) : "—";
}

function displayPlaceholderNodeInfo() {
  // Temporary placeholder — replace with real data from @meshtastic/js
  displayNodeInfo({
    longName: "(not yet read — meshtastic/js pending)",
    hwModel:  "—",
    firmwareVersion: "—",
    id: null,
  });
  configDisplay.textContent = "// Config reading not yet implemented.\n// Waiting for @meshtastic/js integration.";
}

// ─── Profiles ─────────────────────────────────────────────────────────────────

document.querySelectorAll(".btn-profile").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.profile;
    applyProfile(key);
  });
});

function applyProfile(key) {
  const profile = PROFILES[key];
  if (!profile) {
    alert("Unknown profile: " + key);
    return;
  }

  if (!state.connected) {
    alert("Not connected to a node.");
    return;
  }

  const confirmed = confirm(
    `Apply profile "${profile.label}" to the connected node?\n\nThis will overwrite the relevant config fields.`
  );

  if (!confirmed) return;

  // TODO: Write profile config fields to node via @meshtastic/js
  console.log("Applying profile:", key, profile);
  alert("Profile application not yet implemented.\nProfile selected: " + profile.label);
}

// ─── Backup ───────────────────────────────────────────────────────────────────

btnBackup.addEventListener("click", () => {
  if (!state.config) {
    alert("No config loaded from node yet.");
    return;
  }
  exportConfigAsYaml(state.config);
});

function exportConfigAsYaml(config) {
  // TODO: Serialize config object to YAML using a library (e.g. js-yaml)
  // Placeholder: export raw JSON until YAML serializer is added
  const content = JSON.stringify(config, null, 2);
  const blob = new Blob([content], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href     = url;
  a.download = "meshconfig-backup.yaml";
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Restore ──────────────────────────────────────────────────────────────────

btnRestore.addEventListener("click", () => {
  const file = inputRestore.files[0];
  if (!file) {
    alert("Please select a YAML backup file first.");
    return;
  }
  if (!state.connected) {
    alert("Not connected to a node.");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target.result;
    importConfigFromYaml(content);
  };
  reader.readAsText(file);
});

function importConfigFromYaml(yamlText) {
  // TODO: Parse YAML and apply config to node via @meshtastic/js
  console.log("Restore file content:", yamlText);
  alert("Restore not yet implemented.\nFile read OK — " + yamlText.length + " characters.");
}
