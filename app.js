// MeshConfig — app.js
// Phase 1 MVP — WebSerial + Meshtastic protocol + Config Editor

// ─── Constants ────────────────────────────────────────────────────────────────

const BAUD_RATE      = 115200;
const START1         = 0x94;
const START2         = 0xc3;
const MAX_PACKET     = 512;
const WANT_CONFIG_ID = 0xdeadbeef;

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  port: null, reader: null, writer: null, connected: false,
  myInfo: null, nodeInfo: null, nodeInfos: {},
  config: {}, moduleConfig: {}, channels: [], metadata: null, configDone: false,
};

let Root = null, Types = {};

// ─── Enum option lists (populated after proto load) ───────────────────────────

let ROLE_OPTIONS = [], REGION_OPTIONS = [], MODEM_OPTIONS = [],
    GPS_OPTIONS = [], BT_MODE_OPTIONS = [], REBROADCAST_OPTIONS = [];

// ─── Templates ────────────────────────────────────────────────────────────────
// Phase 2: merge with localStorage.getItem('meshconfig_templates')
// Each template only specifies fields it wants to override.

const TEMPLATES = {
  solar: {
    id: 'solar', label: 'Solar / Fixed Install', icon: '☀️',
    description: 'Fixed outdoor node on solar power. Power saving enabled, infrequent position broadcasts, low TX.',
    config: {
      device:   { role: 1, nodeInfoBroadcastSecs: 10800 },
      position: { positionBroadcastSecs: 3600, positionBroadcastSmartEnabled: false },
      power:    { isPowerSaving: true, waitBluetoothSecs: 10 },
      lora:     { txPower: 17, hopLimit: 3, usePreset: true, modemPreset: 0 },
    },
  },
  handheld: {
    id: 'handheld', label: 'Handheld / Personal', icon: '🎒',
    description: 'Personal handheld device. Bluetooth active, normal TX power, regular position updates.',
    config: {
      device:    { role: 0, nodeInfoBroadcastSecs: 3600 },
      position:  { positionBroadcastSecs: 300, positionBroadcastSmartEnabled: true },
      power:     { isPowerSaving: false, waitBluetoothSecs: 60 },
      lora:      { txPower: 20, hopLimit: 3, usePreset: true, modemPreset: 0 },
      bluetooth: { enabled: true },
    },
  },
  repeater: {
    id: 'repeater', label: 'Repeater', icon: '📡',
    description: 'Dedicated router or repeater. No client features, maximizes mesh coverage.',
    config: {
      device: { role: 2, nodeInfoBroadcastSecs: 10800 },
      lora:   { txPower: 20, hopLimit: 7, usePreset: true, modemPreset: 0 },
      power:  { isPowerSaving: false },
    },
  },
  sensor: {
    id: 'sensor', label: 'Sensor Node', icon: '🌡️',
    description: 'Sensor or tracker. Muted (no rebroadcast), frequent telemetry, low TX power.',
    config: {
      device:   { role: 6, nodeInfoBroadcastSecs: 10800 },
      position: { positionBroadcastSecs: 3600 },
      lora:     { txPower: 17, hopLimit: 3, usePreset: true, modemPreset: 0 },
      power:    { isPowerSaving: true },
    },
  },
};

// ─── Field definitions ────────────────────────────────────────────────────────
// common:true = shown by default; false = in Advanced collapsible
// type: select | number | bool | text | password | readonly | private

const SECTIONS = {
  device: {
    label: 'Device',
    fields: [
      { key:'role',                  label:'Role',                   type:'select',  optKey:'ROLE_OPTIONS',        common:true,  desc:'Node role determines how the device participates in the mesh.' },
      { key:'nodeInfoBroadcastSecs', label:'Node Info Interval',     type:'number',  unit:'s',   min:60,          common:true,  desc:'How often to broadcast node info to the mesh.' },
      { key:'rebroadcastMode',       label:'Rebroadcast Mode',       type:'select',  optKey:'REBROADCAST_OPTIONS', common:false, desc:'Controls which packets this node repeats.' },
      { key:'serialEnabled',         label:'Serial API Enabled',     type:'bool',                                 common:false, desc:'Enable serial port API access.' },
      { key:'isManaged',             label:'Managed Mode',           type:'bool',                                 common:false, desc:'⚠️ Locks device to remote admin only. Hard to undo without physical access.', warn:true },
      { key:'tzdef',                 label:'Timezone (POSIX)',        type:'text',                                 common:false, desc:'POSIX timezone string, e.g. CET-1CEST,M3.5.0,M10.5.0/3' },
      { key:'ledHeartbeatDisabled',  label:'Disable LED Heartbeat',  type:'bool',                                 common:false },
    ],
  },
  lora: {
    label: 'LoRa',
    fields: [
      { key:'region',              label:'Region',           type:'select', optKey:'REGION_OPTIONS', common:true,  desc:'Frequency region. Must match all nodes in your mesh.' },
      { key:'usePreset',           label:'Use Modem Preset', type:'bool',                            common:true,  desc:'Use a preset instead of manual bandwidth/SF/CR settings.' },
      { key:'modemPreset',         label:'Modem Preset',     type:'select', optKey:'MODEM_OPTIONS',  common:true,  desc:'Preset radio configuration.' },
      { key:'txPower',             label:'TX Power',         type:'number', unit:'dBm', min:1, max:30, common:true, desc:'Transmit power. Check regional limits.' },
      { key:'hopLimit',            label:'Hop Limit',        type:'number', min:1, max:7,             common:true,  desc:'Maximum number of hops a packet can make. 3 is usually sufficient.' },
      { key:'txEnabled',           label:'TX Enabled',       type:'bool',                            common:true,  desc:'Enable transmitter. Disable for receive-only.' },
      { key:'bandwidth',           label:'Bandwidth',        type:'number', unit:'kHz',              common:false, desc:'Manual bandwidth override (if not using preset).' },
      { key:'spreadFactor',        label:'Spread Factor',    type:'number', min:7, max:12,            common:false, desc:'Manual SF override. Higher = longer range, slower.' },
      { key:'codingRate',          label:'Coding Rate',      type:'number', min:5, max:8,             common:false, desc:'Manual coding rate (5=4/5 ... 8=4/8).' },
      { key:'overrideFrequency',   label:'Override Freq',    type:'number', unit:'MHz',              common:false, desc:'Override center frequency in MHz.' },
      { key:'channelNum',          label:'Channel Number',   type:'number', min:0,                   common:false, desc:'Frequency channel offset within region.' },
      { key:'sx126xRxBoostedGain', label:'SX126x Boost',     type:'bool',                            common:false, desc:'Enable boosted RX gain on SX126x chips (slightly higher power use).' },
      { key:'overrideDutyCycle',   label:'Override Duty Cycle', type:'bool',                         common:false, desc:'⚠️ Override regulatory duty cycle limit.', warn:true },
    ],
  },
  position: {
    label: 'Position',
    fields: [
      { key:'gpsMode',                       label:'GPS Mode',               type:'select', optKey:'GPS_OPTIONS', common:true,  desc:'GPS hardware mode.' },
      { key:'positionBroadcastSecs',         label:'Broadcast Interval',     type:'number', unit:'s', min:0,      common:true,  desc:'How often to broadcast position. 0 = smart only.' },
      { key:'fixedPosition',                 label:'Fixed Position',         type:'bool',                         common:true,  desc:'Use a fixed/manual GPS position instead of live GPS.' },
      { key:'positionBroadcastSmartEnabled', label:'Smart Broadcast',        type:'bool',                         common:false, desc:'Only broadcast position when significantly moved.' },
      { key:'gpsUpdateInterval',             label:'GPS Update Interval',    type:'number', unit:'s',             common:false, desc:'How often to poll the GPS module.' },
      { key:'gpsAttemptTime',                label:'GPS Attempt Time',       type:'number', unit:'s',             common:false, desc:'How long to attempt to get a GPS fix.' },
    ],
  },
  power: {
    label: 'Power',
    fields: [
      { key:'isPowerSaving',               label:'Power Saving',           type:'bool',              common:true,  desc:'Enable power saving mode (affects sleep behaviour).' },
      { key:'onBatteryShutdownAfterSecs',  label:'Shutdown After (batt)',  type:'number', unit:'s',  common:true,  desc:'Shut down after this many seconds on battery. 0 = never.' },
      { key:'waitBluetoothSecs',           label:'BT Timeout',             type:'number', unit:'s',  common:false, desc:'Turn off Bluetooth after this many seconds of no connection.' },
      { key:'sdsSecs',                     label:'Super Deep Sleep',       type:'number', unit:'s',  common:false, desc:'Enter super deep sleep after this many seconds. 0 = never.' },
      { key:'lsSecs',                      label:'Light Sleep',            type:'number', unit:'s',  common:false, desc:'Light sleep timeout.' },
      { key:'minWakeSecs',                 label:'Min Wake Time',          type:'number', unit:'s',  common:false, desc:'Minimum time awake before sleeping again.' },
    ],
  },
  display: {
    label: 'Display',
    fields: [
      { key:'screenOnSecs',      label:'Screen Timeout',    type:'number', unit:'s',  common:true },
      { key:'flipScreen',        label:'Flip Screen',       type:'bool',              common:true },
      { key:'wakeOnTapOrMotion', label:'Wake on Tap/Motion',type:'bool',              common:false },
      { key:'compassNorthTop',   label:'Compass North Up',  type:'bool',              common:false },
      { key:'headingBold',       label:'Bold Heading',      type:'bool',              common:false },
    ],
  },
  bluetooth: {
    label: 'Bluetooth',
    fields: [
      { key:'enabled',  label:'Enabled',       type:'bool',                          common:true },
      { key:'mode',     label:'Pairing Mode',  type:'select', optKey:'BT_MODE_OPTIONS', common:true, desc:'Random PIN, Fixed PIN, or no PIN.' },
      { key:'fixedPin', label:'Fixed PIN',     type:'number', min:0, max:999999,     common:true,  desc:'6-digit PIN used when pairing mode is Fixed PIN.' },
    ],
  },
  network: {
    label: 'Network',
    fields: [
      { key:'wifiEnabled',  label:'WiFi Enabled',   type:'bool',                  common:true },
      { key:'wifiSsid',     label:'WiFi SSID',       type:'text',                  common:true },
      { key:'wifiPsk',      label:'WiFi Password',   type:'password',              common:true },
      { key:'ntpServer',    label:'NTP Server',      type:'text',                  common:false },
      { key:'ethEnabled',   label:'Ethernet',        type:'bool',                  common:false },
      { key:'rsyslogServer',label:'Syslog Server',   type:'text',                  common:false },
    ],
  },
  security: {
    label: 'Security',
    fields: [
      { key:'publicKey',           label:'Public Key',              type:'readonly',  common:true,  desc:'Node identity key. Read-only.' },
      { key:'privateKey',          label:'Private Key',             type:'private',   common:true,  desc:'🔒 Secret key. Only reveal if you need to back it up.' },
      { key:'serialEnabled',       label:'Serial API Enabled',      type:'bool',      common:true },
      { key:'adminChannelEnabled', label:'Admin via Mesh Channel',  type:'bool',      common:false, desc:'⚠️ Allow admin commands over the mesh channel.', warn:true },
      { key:'isManaged',           label:'Managed Mode',            type:'bool',      common:false, desc:'⚠️ Locks device to remote admin only.', warn:true },
    ],
  },
};

// ─── Editor state ─────────────────────────────────────────────────────────────

let editorState    = {};   // { device: {role:0,...}, lora: {...}, ... }
let activeSection  = 'device';
let activeTemplate = null;

// ─── DOM ──────────────────────────────────────────────────────────────────────

const btnConnect      = document.getElementById('btn-connect');
const statusEl        = document.getElementById('connection-status');
const protoStatusEl   = document.getElementById('proto-status');
const sectionNodeInfo = document.getElementById('section-nodeinfo');
const sectionEditor   = document.getElementById('section-editor');
const sectionBackup   = document.getElementById('section-backup');
const sectionConfig   = document.getElementById('section-config');
const configDisplay   = document.getElementById('config-display');
const btnBackup       = document.getElementById('btn-backup');
const inputRestore    = document.getElementById('input-restore');
const btnRestore      = document.getElementById('btn-restore');

// ─── Proto loading ────────────────────────────────────────────────────────────

async function loadProto() {
  try {
    const resp = await fetch('meshtastic.proto.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const json = await resp.json();
    Root = protobuf.Root.fromJSON(json);
    Types.ToRadio      = Root.lookupType('meshtastic.ToRadio');
    Types.FromRadio    = Root.lookupType('meshtastic.FromRadio');
    Types.AdminMessage = Root.lookupType('meshtastic.AdminMessage');
    Types.Config       = Root.lookupType('meshtastic.Config');
    Types.ModuleConfig = Root.lookupType('meshtastic.ModuleConfig');
    Types.Channel      = Root.lookupType('meshtastic.Channel');

    // Build option lists for form selects
    const roleEnum      = Root.lookupEnum('meshtastic.Config.DeviceConfig.Role');
    const regionEnum    = Root.lookupEnum('meshtastic.Config.LoRaConfig.RegionCode');
    const modemEnum     = Root.lookupEnum('meshtastic.Config.LoRaConfig.ModemPreset');
    const gpsEnum       = Root.lookupEnum('meshtastic.Config.PositionConfig.GpsMode');
    const btEnum        = Root.lookupEnum('meshtastic.Config.BluetoothConfig.PairingMode');
    const rebroadEnum   = Root.lookupEnum('meshtastic.Config.DeviceConfig.RebroadcastMode');

    const ROLE_DESC = {
      CLIENT:'Personal device, participates in mesh routing',
      CLIENT_MUTE:'Like CLIENT but does not repeat packets',
      ROUTER:'Dedicated router — no UI, no client features',
      ROUTER_CLIENT:'Router that also accepts client connections',
      REPEATER:'Simple repeater, minimal overhead',
      TRACKER:'GPS tracker, sends position only',
      SENSOR:'Sensor node, sends telemetry data',
      TAK:'TAK/ATAK compatible mode',
      CLIENT_HIDDEN:'Hidden from node list',
      LOST_AND_FOUND:'Lost and found beacon',
      TAK_TRACKER:'TAK tracker mode',
    };
    const MODEM_DESC = {
      LONG_FAST:'Long range, faster — recommended default',
      LONG_SLOW:'Long range, slower',
      VERY_LONG_SLOW:'Maximum range, very slow — use sparingly',
      MEDIUM_SLOW:'Medium range, slower',
      MEDIUM_FAST:'Medium range, faster',
      SHORT_SLOW:'Short range, slower',
      SHORT_FAST:'Short range, fastest',
      LONG_MODERATE:'Long range, moderate speed',
    };
    const GPS_DESC = { DISABLED:'GPS disabled', ENABLED:'GPS enabled', NOT_PRESENT:'No GPS hardware' };
    const BT_DESC  = { RANDOM_PIN:'Random PIN each pairing', FIXED_PIN:'Use fixed PIN below', NO_PIN:'No PIN required' };
    const RB_DESC  = { ALL:'Repeat all packets', ALL_SKIP_DECODING:'Repeat without decoding', LOCAL_ONLY:'Only repeat local mesh', KNOWN_ONLY:'Only repeat known nodes', NONE:'Do not repeat any packets' };

    const toOptions = (enumObj, descMap) =>
      Object.entries(enumObj.values).map(([k,v]) => ({ value:v, label:k, desc: descMap?.[k] || '' }));

    ROLE_OPTIONS      = toOptions(roleEnum,    ROLE_DESC);
    REGION_OPTIONS    = toOptions(regionEnum,  null);
    MODEM_OPTIONS     = toOptions(modemEnum,   MODEM_DESC);
    GPS_OPTIONS       = toOptions(gpsEnum,     GPS_DESC);
    BT_MODE_OPTIONS   = toOptions(btEnum,      BT_DESC);
    REBROADCAST_OPTIONS = toOptions(rebroadEnum, RB_DESC);

    protoStatusEl.textContent = 'Proto: loaded';
    protoStatusEl.className   = 'status status--connected';
  } catch (err) {
    protoStatusEl.textContent = 'Proto: FAILED';
    protoStatusEl.className   = 'status status--disconnected';
    console.error('Failed to load meshtastic.proto.json:', err);
  }
}

// ─── Connection ───────────────────────────────────────────────────────────────

btnConnect.addEventListener('click', async () => {
  state.connected ? await disconnect() : await connect();
});

async function connect() {
  if (!('serial' in navigator)) { alert('WebSerial requires Chrome or Edge.'); return; }
  if (!Root) { alert('Proto not loaded yet. Reload the page.'); return; }
  setStatus('connecting');
  try {
    state.port = await navigator.serial.requestPort();
    await state.port.open({ baudRate: BAUD_RATE });
    state.writer = state.port.writable.getWriter();
    state.connected = true;
    setStatus('connected');
    btnConnect.textContent = 'Disconnect';
    showConnectedSections();
    await sendWantConfig();
    readLoop().catch(err => { console.warn('Read loop ended:', err.message); if (state.connected) disconnect(); });
  } catch (err) {
    console.error('Connection failed:', err);
    setStatus('disconnected');
    try { if (state.port) await state.port.close(); } catch(_) {}
    state.port = null;
    alert('Could not connect: ' + err.message);
  }
}

async function disconnect() {
  state.connected = false;
  try { if (state.reader) await state.reader.cancel(); } catch(_) {}
  try { if (state.writer) await state.writer.close(); } catch(_) {}
  try { if (state.port)   await state.port.close();   } catch(_) {}
  state.reader = state.writer = state.port = null;
  state.myInfo = state.nodeInfo = state.metadata = null;
  state.config = {}; state.moduleConfig = {}; state.channels = [];
  state.nodeInfos = {}; state.configDone = false;
  editorState = {}; activeTemplate = null;
  setStatus('disconnected');
  btnConnect.textContent = 'Connect via USB';
  hideConnectedSections();
}

// ─── Serial write ─────────────────────────────────────────────────────────────

async function writePacket(toRadioMsg) {
  if (!state.writer) return;
  const payload = Types.ToRadio.encode(toRadioMsg).finish();
  if (payload.length > MAX_PACKET) { console.error('Packet too large'); return; }
  const frame = new Uint8Array(4 + payload.length);
  frame[0] = START1; frame[1] = START2;
  frame[2] = (payload.length >> 8) & 0xff;
  frame[3] = payload.length & 0xff;
  frame.set(payload, 4);
  await state.writer.write(frame);
}

async function sendWantConfig() {
  await writePacket(Types.ToRadio.create({ wantConfigId: WANT_CONFIG_ID }));
}

// ─── Read loop — sliding window ───────────────────────────────────────────────

async function readLoop() {
  state.reader = state.port.readable.getReader();
  let rxBuf = new Uint8Array(8192), rxLen = 0;
  const append  = (b) => { if (rxLen+b.length > rxBuf.length) { const n=new Uint8Array(Math.max(rxBuf.length*2,rxLen+b.length+1024)); n.set(rxBuf.subarray(0,rxLen)); rxBuf=n; } rxBuf.set(b,rxLen); rxLen+=b.length; };
  const consume = (n) => { rxBuf.copyWithin(0,n); rxLen-=n; };
  try {
    while (state.connected) {
      const { value, done } = await state.reader.read();
      if (done) break;
      if (!value || !value.length) continue;
      append(value);
      let progress = true;
      while (progress) {
        progress = false;
        let syncPos = -1;
        for (let i = 0; i < rxLen-1; i++) { if (rxBuf[i]===START1 && rxBuf[i+1]===START2) { syncPos=i; break; } }
        if (syncPos < 0)  { if (rxLen>1) consume(rxLen-1); break; }
        if (syncPos > 0)  { consume(syncPos); progress=true; continue; }
        if (rxLen < 4)    break;
        const pLen = (rxBuf[2]<<8)|rxBuf[3];
        if (pLen===0 || pLen>MAX_PACKET) { consume(1); progress=true; continue; }
        if (rxLen < 4+pLen) break;
        const payload = rxBuf.slice(4, 4+pLen);
        let ok = false;
        try { const msg = Types.FromRadio.decode(payload); dispatchFromRadio(msg); ok=true; }
        catch(e) { console.debug('Skip false sync:', e.message.substring(0,60)); }
        consume(ok ? 4+pLen : 1);
        progress = true;
      }
    }
  } finally { try { state.reader.releaseLock(); } catch(_) {} state.reader=null; }
}

// ─── FromRadio dispatch ───────────────────────────────────────────────────────

function dispatchFromRadio(msg) {
  const v = msg.payloadVariant;
  if (!v) { console.debug('FromRadio: no variant, num='+msg.num); return; }
  console.log('FromRadio:', v);
  switch (v) {
    case 'myInfo':           handleMyInfo(msg.myInfo);                  break;
    case 'nodeInfo':         handleNodeInfo(msg.nodeInfo);              break;
    case 'config':           handleConfig(msg.config);                  break;
    case 'moduleConfig':     handleModuleConfig(msg.moduleConfig);      break;
    case 'channel':          handleChannel(msg.channel);                break;
    case 'deviceMetadata':   handleDeviceMetadata(msg.deviceMetadata);  break;
    case 'configCompleteId': handleConfigComplete(msg.configCompleteId);break;
    case 'deviceUiConfig':   break;
    case 'logRecord':        console.debug('[Node]', msg.logRecord?.message); break;
    default:                 console.debug('FromRadio: unhandled:', v); break;
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

function handleMyInfo(myInfo) {
  state.myInfo = myInfo;
  document.getElementById('info-id').textContent =
    myInfo.myNodeNum ? '!' + myInfo.myNodeNum.toString(16).padStart(8,'0') : '—';
  updateOwnNodeDisplay();
}

function handleNodeInfo(nodeInfo) {
  state.nodeInfos[nodeInfo.num] = nodeInfo;
  updateOwnNodeDisplay();
}

function updateOwnNodeDisplay() {
  if (!state.myInfo || !state.nodeInfos) return;
  const own = state.nodeInfos[state.myInfo.myNodeNum];
  if (!own) return;
  state.nodeInfo = own;
  const u = own.user || {};
  document.getElementById('info-name').textContent      = u.longName  || '—';
  document.getElementById('info-shortname').textContent = u.shortName || '—';
  document.getElementById('info-hw').textContent        = u.hwModel   !== undefined ? (u.hwModel + '') : '—';
  document.getElementById('info-role').textContent      = getRoleName(u.role);
}

function handleConfig(config) {
  const t = config.payloadVariant;
  state.config[t] = config[t];
  if (t === 'lora' && config.lora)
    document.getElementById('info-region').textContent =
      getRegionName(config.lora.region);
  refreshConfigDisplay();
}

function handleModuleConfig(moduleConfig) {
  const t = moduleConfig.payloadVariant;
  state.moduleConfig[t] = moduleConfig[t];
  refreshConfigDisplay();
}

function handleChannel(channel) { state.channels[channel.index] = channel; }

function handleDeviceMetadata(metadata) {
  state.metadata = metadata;
  document.getElementById('info-fw').textContent = metadata.firmwareVersion || '—';
}

function handleConfigComplete(id) {
  state.configDone = true;
  console.log('Config download complete');
  refreshConfigDisplay();
  // If editor is open with a template already, update editorState with fresh node data
  if (activeTemplate) loadTemplate(activeTemplate);
}

function refreshConfigDisplay() {
  const prefix = state.configDone ? '' : '// Receiving config...\n\n';
  configDisplay.textContent = prefix + JSON.stringify({ config: state.config, moduleConfig: state.moduleConfig }, null, 2);
}

function getRoleName(val) {
  const opt = ROLE_OPTIONS.find(o => o.value === val);
  return opt ? opt.label : (val !== undefined ? String(val) : '—');
}

function getRegionName(val) {
  const opt = REGION_OPTIONS.find(o => o.value === val);
  return opt ? opt.label : (val !== undefined ? String(val) : '—');
}

// ─── Config Editor ────────────────────────────────────────────────────────────

function loadTemplate(templateId) {
  activeTemplate = templateId;
  const template = TEMPLATES[templateId];
  // Start from current node config, overlay template values
  editorState = JSON.parse(JSON.stringify(state.config));
  for (const [section, values] of Object.entries(template.config)) {
    if (!editorState[section]) editorState[section] = {};
    Object.assign(editorState[section], values);
  }
  // Mark active template card
  document.querySelectorAll('.tpl-card').forEach(c => c.classList.toggle('active', c.dataset.tpl === templateId));
  renderEditorTabs();
  renderEditorPanel(activeSection);
}

function renderEditorTabs() {
  const tabsEl = document.getElementById('editor-tabs');
  tabsEl.innerHTML = Object.entries(SECTIONS).map(([key, sec]) =>
    `<button class="tab-btn${key===activeSection?' active':''}" data-sec="${key}">${sec.label}</button>`
  ).join('');
  tabsEl.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      saveCurrentPanel();
      activeSection = btn.dataset.sec;
      tabsEl.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b===btn));
      renderEditorPanel(activeSection);
    })
  );
}

function renderEditorPanel(sectionKey) {
  const section = SECTIONS[sectionKey];
  const data    = editorState[sectionKey] || {};
  const panelEl = document.getElementById('editor-panel');

  const commonFields   = section.fields.filter(f => f.common);
  const advancedFields = section.fields.filter(f => !f.common);

  let html = `<div class="field-group">`;
  html += commonFields.map(f => renderField(f, data[f.key])).join('');
  html += `</div>`;

  if (advancedFields.length) {
    html += `<details class="advanced-section">
      <summary>▶ Advanced</summary>
      <div class="field-group advanced-fields">
        ${advancedFields.map(f => renderField(f, data[f.key])).join('')}
      </div>
    </details>`;
  }

  panelEl.innerHTML = html;

  // Wire up private key toggle
  const pkToggle = panelEl.querySelector('.pk-toggle');
  if (pkToggle) {
    pkToggle.addEventListener('change', () => {
      const pkEl = panelEl.querySelector('.pk-value');
      if (pkEl) pkEl.style.display = pkToggle.checked ? '' : 'none';
    });
  }
}

function renderField(f, value) {
  const v = (value !== undefined && value !== null) ? value : '';
  const warnClass = f.warn ? ' field-warn' : '';
  const descHtml  = f.desc ? `<span class="field-desc" title="${f.desc}">?</span>` : '';

  let inputHtml = '';

  switch (f.type) {
    case 'select': {
      const opts = getOptions(f.optKey);
      const selectedOpt = opts.find(o => o.value === v);
      inputHtml = `<div class="select-wrap">
        <select class="field-input" data-key="${f.key}">
          ${opts.map(o => `<option value="${o.value}"${o.value===v?' selected':''}>${o.label}</option>`).join('')}
        </select>
        <div class="select-desc" id="desc-${f.key}">${selectedOpt?.desc || ''}</div>
      </div>`;
      break;
    }
    case 'bool':
      inputHtml = `<label class="toggle">
        <input type="checkbox" class="field-input" data-key="${f.key}"${v?' checked':''}>
        <span class="toggle-slider"></span>
      </label>`;
      break;
    case 'number':
      inputHtml = `<div class="num-wrap">
        <input type="number" class="field-input" data-key="${f.key}" value="${v}"
          ${f.min!==undefined?'min="'+f.min+'"':''} ${f.max!==undefined?'max="'+f.max+'"':''}
          ${f.unit?'placeholder="'+f.unit+'"':''}>
        ${f.unit?'<span class="unit">'+f.unit+'</span>':''}
      </div>`;
      break;
    case 'password':
      inputHtml = `<input type="password" class="field-input" data-key="${f.key}" value="${v}" autocomplete="off">`;
      break;
    case 'readonly': {
      const display = v instanceof Uint8Array || (v && v.constructor === Uint8Array)
        ? btoa(String.fromCharCode(...v))
        : (v ? String(v) : '—');
      inputHtml = `<input type="text" class="field-input readonly" readonly value="${display}">`;
      break;
    }
    case 'private': {
      const display = v instanceof Uint8Array ? btoa(String.fromCharCode(...v)) : (v ? String(v) : '');
      inputHtml = `<div class="private-wrap">
        <label class="pk-label"><input type="checkbox" class="pk-toggle"> Show private key</label>
        <input type="text" class="field-input pk-value" data-key="${f.key}" value="${display}" style="display:none" readonly>
      </div>`;
      break;
    }
    default: // text
      inputHtml = `<input type="text" class="field-input" data-key="${f.key}" value="${v}">`;
  }

  // Wire select description update
  if (f.type === 'select') {
    // Will be done after render via event delegation
  }

  return `<div class="field-row${warnClass}">
    <label class="field-label">${f.label}${descHtml}</label>
    <div class="field-input-wrap">${inputHtml}</div>
  </div>`;
}

function getOptions(optKey) {
  const map = { ROLE_OPTIONS, REGION_OPTIONS, MODEM_OPTIONS, GPS_OPTIONS, BT_MODE_OPTIONS, REBROADCAST_OPTIONS };
  return map[optKey] || [];
}

// Update select descriptions on change (event delegation on panel)
document.addEventListener('change', e => {
  if (e.target.matches('select.field-input')) {
    const key   = e.target.dataset.key;
    const descEl = document.getElementById('desc-' + key);
    if (descEl) {
      // Find the section and field
      for (const sec of Object.values(SECTIONS)) {
        const fd = sec.fields.find(f => f.key === key);
        if (fd) {
          const opts = getOptions(fd.optKey);
          const opt  = opts.find(o => String(o.value) === e.target.value);
          descEl.textContent = opt?.desc || '';
          break;
        }
      }
    }
  }
});

function saveCurrentPanel() {
  const panel = document.getElementById('editor-panel');
  if (!panel || !activeSection) return;
  if (!editorState[activeSection]) editorState[activeSection] = {};
  panel.querySelectorAll('.field-input:not(.readonly):not(.pk-value)').forEach(el => {
    const key = el.dataset.key;
    if (!key) return;
    if (el.type === 'checkbox')      editorState[activeSection][key] = el.checked;
    else if (el.type === 'number')   editorState[activeSection][key] = el.value !== '' ? Number(el.value) : undefined;
    else                             editorState[activeSection][key] = el.value;
  });
}

async function applyEditorConfig() {
  if (!state.connected) { alert('Not connected to a node.'); return; }
  saveCurrentPanel();

  if (!confirm('Apply configuration to connected node?\n\nThis will write all modified sections to the device.')) return;

  let sent = 0;
  const configTypes = ['device','position','power','network','display','lora','bluetooth','security'];
  for (const cfgType of configTypes) {
    if (!editorState[cfgType]) continue;
    // Remove undefined values
    const clean = Object.fromEntries(Object.entries(editorState[cfgType]).filter(([,v]) => v !== undefined));
    try {
      const cfgMsg   = Types.Config.create({ [cfgType]: clean });
      const adminMsg = Types.AdminMessage.create({ setConfig: cfgMsg });
      await writePacket(Types.ToRadio.create({ admin: adminMsg }));
      sent++;
      await sleep(200);
    } catch(err) { console.error('setConfig failed:', cfgType, err); }
  }
  alert(`Done — ${sent} config section(s) sent to node.\n\nThe node will apply the settings.`);
}

// ─── Backup ───────────────────────────────────────────────────────────────────

btnBackup.addEventListener('click', () => {
  if (!state.configDone) { alert('Config not fully loaded yet.'); return; }
  const yaml = jsonToYaml({
    _comment: 'MeshConfig backup — ' + new Date().toISOString(),
    owner:        state.nodeInfo?.user || {},
    owner_short:  state.nodeInfo?.user?.shortName || '',
    config:       state.config,
    module_config: state.moduleConfig,
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([yaml], { type:'text/yaml' }));
  a.download = 'meshconfig-backup.yaml';
  a.click();
});

btnRestore.addEventListener('click', () => {
  const file = inputRestore.files[0];
  if (!file)             { alert('Select a YAML file first.'); return; }
  if (!state.connected)  { alert('Not connected.'); return; }
  if (!state.configDone) { alert('Config not fully loaded yet.'); return; }
  const reader = new FileReader();
  reader.onload = e => importConfig(e.target.result);
  reader.readAsText(file);
});

async function importConfig(yamlText) {
  let doc;
  try   { doc = parseSimpleYaml(yamlText); }
  catch (err) { alert('Failed to parse file: ' + err.message); return; }
  if (!doc.config) { alert("No 'config' section found."); return; }
  if (!confirm('Apply backup config to the connected node?')) return;
  let sent = 0;
  for (const cfgType of ['device','position','power','network','display','lora','bluetooth','security']) {
    if (!doc.config[cfgType]) continue;
    try {
      const cfgMsg   = Types.Config.create({ [cfgType]: doc.config[cfgType] });
      const adminMsg = Types.AdminMessage.create({ setConfig: cfgMsg });
      await writePacket(Types.ToRadio.create({ admin: adminMsg }));
      sent++; await sleep(200);
    } catch(e) { console.error('restore failed:', cfgType, e); }
  }
  alert('Restore complete — ' + sent + ' section(s) sent.');
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setStatus(s) {
  statusEl.textContent = { disconnected:'Disconnected', connecting:'Connecting…', connected:'Connected' }[s] || s;
  statusEl.className = 'status status--' + s;
}

function showConnectedSections() {
  [sectionNodeInfo, sectionEditor, sectionBackup, sectionConfig]
    .forEach(s => s.classList.remove('hidden'));
}

function hideConnectedSections() {
  [sectionNodeInfo, sectionEditor, sectionBackup, sectionConfig]
    .forEach(s => s.classList.add('hidden'));
  configDisplay.textContent = 'No config loaded.';
  ['info-name','info-shortname','info-hw','info-fw','info-id','info-role','info-region']
    .forEach(id => document.getElementById(id).textContent = '—');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── YAML helpers ─────────────────────────────────────────────────────────────

function jsonToYaml(obj, indent=0) {
  const pad = '  '.repeat(indent);
  if (obj===null||obj===undefined) return 'null';
  if (typeof obj==='boolean') return obj?'true':'false';
  if (typeof obj==='number')  return String(obj);
  if (typeof obj==='string') {
    if (/[:#\[\]{},&*?|<>=!%@`]/.test(obj)||obj===''||['true','false','null','yes','no'].includes(obj.toLowerCase()))
      return `"${obj.replace(/"/g,'\\"')}"`;
    return obj;
  }
  if (Array.isArray(obj)) {
    if (!obj.length) return '[]';
    return obj.map(i => `${pad}- ${jsonToYaml(i,indent+1)}`).join('\n');
  }
  if (typeof obj==='object') {
    const entries = Object.entries(obj).filter(([,v])=>v!==undefined&&v!==null);
    if (!entries.length) return '{}';
    return entries.map(([k,v]) => {
      const s = jsonToYaml(v,indent+1);
      return (typeof v==='object'&&v!==null&&!Array.isArray(v)&&Object.keys(v).length>0)
        ? `${pad}${k}:\n${s}` : `${pad}${k}: ${s}`;
    }).join('\n');
  }
  return String(obj);
}

function parseSimpleYaml(text) {
  try { return JSON.parse(text); } catch(_) {}
  const result={}, stack=[{obj:result,indent:-1}];
  for (const raw of text.split('\n')) {
    if (raw.trimStart().startsWith('#')||raw.trim()==='') continue;
    const indent=raw.search(/\S/), line=raw.trim();
    const kv=line.match(/^([^:]+):\s*(.*)$/);
    if (!kv) continue;
    const key=kv[1].trim(), val=kv[2].trim();
    while (stack.length>1&&stack[stack.length-1].indent>=indent) stack.pop();
    const parent=stack[stack.length-1].obj;
    if (val===''||val==='{}') { const child={}; parent[key]=child; stack.push({obj:child,indent}); }
    else parent[key]=parseYamlValue(val);
  }
  return result;
}

function parseYamlValue(val) {
  if (val==='true') return true; if (val==='false') return false;
  if (val==='null'||val==='~') return null;
  if (/^".*"$/.test(val)) return val.slice(1,-1).replace(/\\"/g,'"');
  if (/^-?\d+$/.test(val)) return parseInt(val,10);
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  return val;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadProto();
