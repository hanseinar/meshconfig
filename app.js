// MeshConfig — app.js
// Phase 1 MVP — WebSerial + Meshtastic protocol implementation
// Serial framing: 0x94 0xc3 MSB LSB <protobuf bytes>

// ─── Constants ────────────────────────────────────────────────────────────────

const BAUD_RATE      = 115200;
const START1         = 0x94;
const START2         = 0xc3;
const MAX_PACKET     = 512;
const WANT_CONFIG_ID = 0xdeadbeef;

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  port:         null,
  reader:       null,
  writer:       null,
  connected:    false,
  myInfo:       null,
  nodeInfo:     null,
  config:       {},
  moduleConfig: {},
  channels:     [],
  metadata:     null,
  configDone:   false,
};

let Root  = null;
let Types = {};

// ─── Profiles ─────────────────────────────────────────────────────────────────

const PROFILES = {
  solar: {
    label:    "Solar / Fixed Install",
    device:   { role: 1 },
    position: { positionBroadcastSecs: 3600, positionBroadcastSmartEnabled: false },
    power:    { isPowerSaving: true },
    lora:     { txPower: 17, hopLimit: 3 },
  },
  handheld: {
    label:     "Handheld / Personal",
    device:    { role: 0 },
    position:  { positionBroadcastSecs: 300 },
    lora:      { txPower: 20, hopLimit: 3 },
    bluetooth: { enabled: true },
  },
  repeater: {
    label:  "Repeater",
    device: { role: 2 },
    lora:   { txPower: 20, hopLimit: 7 },
  },
  sensor: {
    label:    "Sensor",
    device:   { role: 6 },
    position: { positionBroadcastSecs: 3600 },
    lora:     { txPower: 17, hopLimit: 3 },
    moduleConfig_telemetry: { deviceUpdateInterval: 60 },
  },
};

let ROLE_NAMES   = {};
let REGION_NAMES = {};
let HW_NAMES     = {};

// ─── DOM ──────────────────────────────────────────────────────────────────────

const btnConnect      = document.getElementById("btn-connect");
const statusEl        = document.getElementById("connection-status");
const protoStatusEl   = document.getElementById("proto-status");
const sectionNodeInfo = document.getElementById("section-nodeinfo");
const sectionProfiles = document.getElementById("section-profiles");
const sectionBackup   = document.getElementById("section-backup");
const sectionConfig   = document.getElementById("section-config");
const configDisplay   = document.getElementById("config-display");
const btnBackup       = document.getElementById("btn-backup");
const inputRestore    = document.getElementById("input-restore");
const btnRestore      = document.getElementById("btn-restore");

// ─── Proto loading ────────────────────────────────────────────────────────────

async function loadProto() {
  try {
    const resp = await fetch("meshtastic.proto.json");
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const json = await resp.json();
    Root = protobuf.Root.fromJSON(json);

    Types.ToRadio      = Root.lookupType("meshtastic.ToRadio");
    Types.FromRadio    = Root.lookupType("meshtastic.FromRadio");
    Types.AdminMessage = Root.lookupType("meshtastic.AdminMessage");
    Types.Config       = Root.lookupType("meshtastic.Config");
    Types.ModuleConfig = Root.lookupType("meshtastic.ModuleConfig");
    Types.Channel      = Root.lookupType("meshtastic.Channel");

    const roleEnum   = Root.lookupEnum("meshtastic.Config.DeviceConfig.Role");
    const regionEnum = Root.lookupEnum("meshtastic.Config.LoRaConfig.RegionCode");
    const hwEnum     = Root.lookupEnum("meshtastic.HardwareModel");
    for (const [k, v] of Object.entries(roleEnum.values))   ROLE_NAMES[v]   = k;
    for (const [k, v] of Object.entries(regionEnum.values)) REGION_NAMES[v] = k;
    for (const [k, v] of Object.entries(hwEnum.values))     HW_NAMES[v]     = k;

    protoStatusEl.textContent = "Proto: loaded";
    protoStatusEl.className   = "status status--connected";
    console.log("Protobuf definitions loaded OK");
  } catch (err) {
    protoStatusEl.textContent = "Proto: FAILED";
    protoStatusEl.className   = "status status--disconnected";
    console.error("Failed to load meshtastic.proto.json:", err);
  }
}

// ─── Connection ───────────────────────────────────────────────────────────────

btnConnect.addEventListener("click", async () => {
  state.connected ? await disconnect() : await connect();
});

async function connect() {
  if (!("serial" in navigator)) {
    alert("WebSerial is not supported.\nPlease use Chrome or Edge.");
    return;
  }
  if (!Root) {
    alert("Protobuf definitions not loaded yet. Please reload the page.");
    return;
  }
  setStatus("connecting");
  try {
    state.port = await navigator.serial.requestPort();
    await state.port.open({ baudRate: BAUD_RATE });
    state.writer    = state.port.writable.getWriter();
    state.connected = true;
    setStatus("connected");
    btnConnect.textContent = "Disconnect";
    showConnectedSections();
    // Send wantConfigId first, THEN start read loop.
    // This ensures the device has switched to protobuf mode before we start parsing.
    await sendWantConfig();
    readLoop().catch(err => {
      console.warn("Read loop ended:", err.message);
      if (state.connected) disconnect();
    });
  } catch (err) {
    console.error("Connection failed:", err);
    setStatus("disconnected");
    try { if (state.port) await state.port.close(); } catch(_) {}
    state.port = null;
    alert("Could not connect: " + err.message);
  }
}

async function disconnect() {
  state.connected = false;
  try { if (state.reader) await state.reader.cancel(); } catch(_) {}
  try { if (state.writer) await state.writer.close(); } catch(_) {}
  try { if (state.port)   await state.port.close();   } catch(_) {}
  state.reader = state.writer = state.port = null;
  state.myInfo = state.nodeInfo = state.metadata = null;
  state.config = {}; state.moduleConfig = {}; state.channels = []; state.configDone = false;
  setStatus("disconnected");
  btnConnect.textContent = "Connect via USB";
  hideConnectedSections();
}

// ─── Serial write ─────────────────────────────────────────────────────────────

async function writePacket(toRadioMsg) {
  if (!state.writer) return;
  const payload = Types.ToRadio.encode(toRadioMsg).finish();
  if (payload.length > MAX_PACKET) { console.error("Packet too large:", payload.length); return; }
  const frame = new Uint8Array(4 + payload.length);
  frame[0] = START1;
  frame[1] = START2;
  frame[2] = (payload.length >> 8) & 0xff;
  frame[3] = payload.length & 0xff;
  frame.set(payload, 4);
  await state.writer.write(frame);
}

async function sendWantConfig() {
  await writePacket(Types.ToRadio.create({ wantConfigId: WANT_CONFIG_ID }));
  console.log("Sent wantConfigId");
}

// ─── Read loop — sliding window framing ─────────────────────────────────────
// Accumulates bytes in rxBuf. For each candidate sync (0x94 0xC3):
//   - If decode succeeds  → consume header + payload, emit packet
//   - If decode fails     → skip 1 byte, try next sync position
// This prevents false syncs inside real packet payloads from eating real data.

async function readLoop() {
  state.reader = state.port.readable.getReader();

  let rxBuf = new Uint8Array(8192);
  let rxLen = 0;

  const append = (bytes) => {
    if (rxLen + bytes.length > rxBuf.length) {
      const nb = new Uint8Array(Math.max(rxBuf.length * 2, rxLen + bytes.length + 1024));
      nb.set(rxBuf.subarray(0, rxLen));
      rxBuf = nb;
    }
    rxBuf.set(bytes, rxLen);
    rxLen += bytes.length;
  };

  const consume = (n) => {
    rxBuf.copyWithin(0, n);
    rxLen -= n;
  };

  try {
    while (state.connected) {
      const { value, done } = await state.reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      append(value);

      // Process all decodable packets in buffer
      let progress = true;
      while (progress) {
        progress = false;

        // Find next sync candidate
        let syncPos = -1;
        for (let i = 0; i < rxLen - 1; i++) {
          if (rxBuf[i] === START1 && rxBuf[i + 1] === START2) { syncPos = i; break; }
        }

        if (syncPos < 0) {
          // No sync — discard all but last byte (could be partial START1)
          if (rxLen > 1) consume(rxLen - 1);
          break;
        }

        // Discard pre-sync garbage bytes
        if (syncPos > 0) { consume(syncPos); progress = true; continue; }

        // Need 4-byte header
        if (rxLen < 4) break;

        const payloadLen = (rxBuf[2] << 8) | rxBuf[3];

        if (payloadLen === 0 || payloadLen > MAX_PACKET) {
          // Invalid length — skip this START1
          consume(1); progress = true; continue;
        }

        // Wait until full payload buffered
        if (rxLen < 4 + payloadLen) break;

        // Attempt decode
        const payload = rxBuf.slice(4, 4 + payloadLen);
        let ok = false;
        try {
          const msg = Types.FromRadio.decode(payload);
          dispatchFromRadio(msg);
          ok = true;
        } catch (e) {
          console.debug("False sync skipped:", e.message.substring(0, 80));
        }

        consume(ok ? 4 + payloadLen : 1);
        progress = true;
      }
    }
  } finally {
    try { state.reader.releaseLock(); } catch (_) {}
    state.reader = null;
  }
}

// ─── FromRadio dispatch ───────────────────────────────────────────────────────

function dispatchFromRadio(msg) {
  const v = msg.payloadVariant;
  if (!v) {
    console.debug("FromRadio: no variant (num=" + msg.num + ")");
    return;
  }
  console.log("FromRadio:", v);

  switch (v) {
    case "myInfo":          handleMyInfo(msg.myInfo);                 break;
    case "nodeInfo":        handleNodeInfo(msg.nodeInfo);             break;
    case "config":          handleConfig(msg.config);                 break;
    case "moduleConfig":    handleModuleConfig(msg.moduleConfig);     break;
    case "channel":         handleChannel(msg.channel);               break;
    case "deviceMetadata":  handleDeviceMetadata(msg.deviceMetadata); break;
    case "configCompleteId":handleConfigComplete(msg.configCompleteId);break;
    case "queueStatus":     break; // known, ignored
    case "deviceUiConfig":  break; // known, ignored
    case "logRecord":       console.debug("[Node]", msg.logRecord?.message); break;
    default:                console.debug("FromRadio: unhandled variant:", v); break;
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

function handleMyInfo(myInfo) {
  state.myInfo = myInfo;
  const hexId = myInfo.myNodeNum
    ? "!" + myInfo.myNodeNum.toString(16).padStart(8, "0")
    : "—";
  document.getElementById("info-id").textContent = hexId;
  // In case nodeInfo arrived before myInfo
  updateOwnNodeDisplay();
}

function handleNodeInfo(nodeInfo) {
  // Store all nodeInfos; display update happens in updateOwnNodeDisplay()
  state.nodeInfos = state.nodeInfos || {};
  state.nodeInfos[nodeInfo.num] = nodeInfo;
  updateOwnNodeDisplay();
}

function updateOwnNodeDisplay() {
  if (!state.myInfo || !state.nodeInfos) return;
  const own = state.nodeInfos[state.myInfo.myNodeNum];
  if (!own) return;
  state.nodeInfo = own;
  const u = own.user || {};
  document.getElementById("info-name").textContent      = u.longName  || "—";
  document.getElementById("info-shortname").textContent = u.shortName || "—";
  document.getElementById("info-hw").textContent        = HW_NAMES[u.hwModel] || String(u.hwModel || "—");
  document.getElementById("info-role").textContent      = ROLE_NAMES[u.role]  || String(u.role   || "—");
}

function handleConfig(config) {
  const t = config.payloadVariant;
  state.config[t] = config[t];
  if (t === "lora" && config.lora)
    document.getElementById("info-region").textContent =
      REGION_NAMES[config.lora.region] || String(config.lora.region || "—");
  refreshConfigDisplay();
}

function handleModuleConfig(moduleConfig) {
  const t = moduleConfig.payloadVariant;
  state.moduleConfig[t] = moduleConfig[t];
  refreshConfigDisplay();
}

function handleChannel(channel) {
  state.channels[channel.index] = channel;
}

function handleDeviceMetadata(metadata) {
  state.metadata = metadata;
  document.getElementById("info-fw").textContent = metadata.firmwareVersion || "—";
}

function handleConfigComplete(id) {
  state.configDone = true;
  console.log("Config download complete");
  refreshConfigDisplay();
}

function refreshConfigDisplay() {
  const out = { config: state.config, moduleConfig: state.moduleConfig };
  const prefix = state.configDone ? "" : "// Receiving config...\n\n";
  configDisplay.textContent = prefix + JSON.stringify(out, null, 2);
}

// ─── Profiles ─────────────────────────────────────────────────────────────────

document.querySelectorAll(".btn-profile").forEach(btn =>
  btn.addEventListener("click", () => applyProfile(btn.dataset.profile))
);

async function applyProfile(key) {
  const profile = PROFILES[key];
  if (!profile)           { alert("Unknown profile: " + key); return; }
  if (!state.connected)   { alert("Not connected to a node."); return; }
  if (!state.configDone)  { alert("Config not fully loaded yet. Please wait."); return; }
  if (!confirm(`Apply profile "${profile.label}" to the connected node?\n\nThis will write config to the device.`)) return;

  let sent = 0;
  for (const cfgType of ["device","position","power","network","display","lora","bluetooth","security"]) {
    if (!profile[cfgType]) continue;
    const merged   = Object.assign({}, state.config[cfgType] || {}, profile[cfgType]);
    const cfgMsg   = Types.Config.create({ [cfgType]: merged });
    const adminMsg = Types.AdminMessage.create({ setConfig: cfgMsg });
    await writePacket(Types.ToRadio.create({ admin: adminMsg }));
    console.log("Sent setConfig:", cfgType, merged);
    sent++;
    await sleep(200);
  }
  if (profile.moduleConfig_telemetry) {
    const merged   = Object.assign({}, state.moduleConfig.telemetry || {}, profile.moduleConfig_telemetry);
    const modMsg   = Types.ModuleConfig.create({ telemetry: merged });
    const adminMsg = Types.AdminMessage.create({ setModuleConfig: modMsg });
    await writePacket(Types.ToRadio.create({ admin: adminMsg }));
    sent++;
    await sleep(200);
  }
  alert(`Profile "${profile.label}" applied (${sent} block(s) sent).\n\nThe node will apply settings. You may need to reconnect.`);
}

// ─── Backup ───────────────────────────────────────────────────────────────────

btnBackup.addEventListener("click", () => {
  if (!state.configDone) { alert("Config not fully loaded yet."); return; }
  const yaml = jsonToYaml({
    _comment: "MeshConfig backup — " + new Date().toISOString(),
    owner:        state.nodeInfo?.user || {},
    owner_short:  state.nodeInfo?.user?.shortName || "",
    config:       state.config,
    module_config: state.moduleConfig,
  });
  const a  = document.createElement("a");
  a.href   = URL.createObjectURL(new Blob([yaml], { type: "text/yaml" }));
  a.download = "meshconfig-backup.yaml";
  a.click();
});

// ─── Restore ──────────────────────────────────────────────────────────────────

btnRestore.addEventListener("click", () => {
  const file = inputRestore.files[0];
  if (!file)             { alert("Please select a YAML backup file first."); return; }
  if (!state.connected)  { alert("Not connected to a node."); return; }
  if (!state.configDone) { alert("Config not fully loaded yet."); return; }
  const reader = new FileReader();
  reader.onload = e => importConfig(e.target.result);
  reader.readAsText(file);
});

async function importConfig(yamlText) {
  let doc;
  try   { doc = parseSimpleYaml(yamlText); }
  catch (err) { alert("Failed to parse file: " + err.message); return; }
  if (!doc.config) { alert("No 'config' section found in backup file."); return; }
  if (!confirm("Apply config from backup to the connected node?\n\nThis will overwrite the node's current configuration.")) return;

  let sent = 0;
  for (const cfgType of ["device","position","power","network","display","lora","bluetooth","security"]) {
    if (!doc.config[cfgType]) continue;
    try {
      const cfgMsg   = Types.Config.create({ [cfgType]: doc.config[cfgType] });
      const adminMsg = Types.AdminMessage.create({ setConfig: cfgMsg });
      await writePacket(Types.ToRadio.create({ admin: adminMsg }));
      sent++;
      await sleep(200);
    } catch(err) { console.error("setConfig failed:", cfgType, err); }
  }
  alert("Restore complete — " + sent + " block(s) sent.");
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setStatus(s) {
  const labels = { disconnected:"Disconnected", connecting:"Connecting…", connected:"Connected" };
  statusEl.textContent = labels[s] || s;
  statusEl.className   = "status status--" + s;
}

function showConnectedSections() {
  [sectionNodeInfo, sectionProfiles, sectionBackup, sectionConfig]
    .forEach(s => s.classList.remove("hidden"));
}

function hideConnectedSections() {
  [sectionNodeInfo, sectionProfiles, sectionBackup, sectionConfig]
    .forEach(s => s.classList.add("hidden"));
  configDisplay.textContent = "No config loaded.";
  ["info-name","info-shortname","info-hw","info-fw","info-id","info-role","info-region"]
    .forEach(id => document.getElementById(id).textContent = "—");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Minimal YAML serialiser ──────────────────────────────────────────────────

function jsonToYaml(obj, indent = 0) {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return "null";
  if (typeof obj === "boolean") return obj ? "true" : "false";
  if (typeof obj === "number")  return String(obj);
  if (typeof obj === "string") {
    if (/[:#\[\]{},&*?|<>=!%@`]/.test(obj) || obj === "" ||
        ["true","false","null","yes","no"].includes(obj.toLowerCase()))
      return `"${obj.replace(/"/g, '\\"')}"`;
    return obj;
  }
  if (Array.isArray(obj)) {
    if (!obj.length) return "[]";
    return obj.map(item => `${pad}- ${jsonToYaml(item, indent+1)}`).join("\n");
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj).filter(([,v]) => v !== undefined && v !== null);
    if (!entries.length) return "{}";
    return entries.map(([k, v]) => {
      const s = jsonToYaml(v, indent+1);
      return (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0)
        ? `${pad}${k}:\n${s}` : `${pad}${k}: ${s}`;
    }).join("\n");
  }
  return String(obj);
}

// ─── Minimal YAML parser ──────────────────────────────────────────────────────

function parseSimpleYaml(text) {
  try { return JSON.parse(text); } catch(_) {}
  const lines = text.split("\n");
  const result = {};
  const stack  = [{ obj: result, indent: -1 }];
  for (const raw of lines) {
    if (raw.trimStart().startsWith("#") || raw.trim() === "") continue;
    const indent = raw.search(/\S/);
    const line   = raw.trim();
    const kv     = line.match(/^([^:]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    const val = kv[2].trim();
    while (stack.length > 1 && stack[stack.length-1].indent >= indent) stack.pop();
    const parent = stack[stack.length-1].obj;
    if (val === "" || val === "{}") {
      const child = {}; parent[key] = child;
      stack.push({ obj: child, indent });
    } else {
      parent[key] = parseYamlValue(val);
    }
  }
  return result;
}

function parseYamlValue(val) {
  if (val === "true")  return true;
  if (val === "false") return false;
  if (val === "null" || val === "~") return null;
  if (/^".*"$/.test(val)) return val.slice(1,-1).replace(/\\"/g, '"');
  if (/^-?\d+$/.test(val)) return parseInt(val, 10);
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  return val;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadProto();
