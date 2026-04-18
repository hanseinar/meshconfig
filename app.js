// MeshConfig — app.js
// Phase 1 MVP — WebSerial + Meshtastic protocol + Two-level config editor

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
let ROLE_OPTIONS = [], REGION_OPTIONS = [], MODEM_OPTIONS = [],
    GPS_OPTIONS = [], BT_MODE_OPTIONS = [], REBROADCAST_OPTIONS = [];

// ─── Network profiles ─────────────────────────────────────────────────────────
// Phase 2: merge/replace with localStorage('meshconfig_networks')
// 'builtin' networks cannot be deleted; others can be edited/renamed.

const NETWORKS = {
  standard: {
    id: 'standard', label: 'Meshtastic Standard', builtin: true,
    desc: 'Default Meshtastic settings. Compatible with all out-of-the-box devices worldwide.',
    lora: {
      region: 3,        // EU_868
      usePreset: true,
      modemPreset: 0,   // LONG_FAST
      hopLimit: 3,
      txEnabled: true,
    },
  },
  vestlandsnett: {
    id: 'vestlandsnett', label: 'Vestlandsnett', builtin: false,
    desc: 'Narrow-band network used in Rogaland/Vestlandet. 62 kHz BW, SF8, CR5, 869.618 MHz. Longer range, lower throughput than standard.',
    lora: {
      region: 3,        // EU_868
      usePreset: false,
      bandwidth: 62,
      spreadFactor: 8,
      codingRate: 5,
      overrideFrequency: 869.618,
      hopLimit: 4,
      txEnabled: true,
      txPower: 27,
      sx126xRxBoostedGain: true,
      ignoreMqtt: true,
    },
  },
};

// ─── Function profiles ────────────────────────────────────────────────────────
// Applied on top of a network profile. Only overrides what it needs to.

const FUNCTIONS = {
  client: {
    id: 'client', label: 'Client', icon: '🎒',
    desc: 'General-purpose node. Participates fully in the mesh: sends, receives and intelligently rebroadcasts packets. Suitable for handhelds, portable nodes and most fixed installs.',
    warn: null,
    config: {
      device: {
        role: 0,  // CLIENT
        nodeInfoBroadcastSecs: 3600,
      },
      position: {
        positionBroadcastSecs: 900,
        positionBroadcastSmartEnabled: true,
        gpsMode: 1,  // ENABLED
        gpsUpdateInterval: 120,
      },
      power: {
        isPowerSaving: false,
        waitBluetoothSecs: 60,
      },
      bluetooth: { enabled: true },
    },
  },
  fixed: {
    id: 'fixed', label: 'Fixed Install', icon: '🏠',
    desc: 'Permanently mounted node (rooftop, mast, solar). CLIENT role — contributes to mesh routing. Power saving enabled, infrequent position updates, fixed GPS position recommended.',
    warn: null,
    config: {
      device: {
        role: 0,  // CLIENT
        nodeInfoBroadcastSecs: 10800,
        ledHeartbeatDisabled: true,
      },
      position: {
        positionBroadcastSecs: 3600,
        positionBroadcastSmartEnabled: false,
        fixedPosition: true,
        gpsMode: 1,
        gpsUpdateInterval: 120,
      },
      power: {
        isPowerSaving: true,
        waitBluetoothSecs: 10,
        lsSecs: 300,
        minWakeSecs: 10,
        sdsSecs: 4294967295,
      },
      bluetooth: { enabled: true },
    },
  },
  repeater: {
    id: 'repeater', label: 'Repeater', icon: '📡',
    desc: 'ROUTER role. Always awake, always rebroadcasts. For high, well-positioned sites only — misuse causes congestion and degrades the entire mesh.',
    warn: '⚠️ ROUTER role should only be used at high, well-positioned sites with excellent line-of-sight coverage. A poorly placed ROUTER suppresses rebroadcasts from all nearby CLIENT nodes and will degrade — not improve — the mesh. When in doubt, use Client or Fixed Install instead.',
    config: {
      device: {
        role: 2,  // ROUTER
        nodeInfoBroadcastSecs: 10800,
        ledHeartbeatDisabled: true,
      },
      position: {
        positionBroadcastSecs: 3600,
        fixedPosition: true,
        gpsMode: 1,
      },
      power: {
        isPowerSaving: false,  // ROUTER cannot sleep
        waitBluetoothSecs: 60,
      },
      bluetooth: { enabled: false },
    },
  },
};

// ─── Field definitions ────────────────────────────────────────────────────────

const SECTIONS = {
  device: {
    label: 'Device', icon: '⚙️',
    fields: [
      { key:'role',                  label:'Role',                    type:'select',  optKey:'ROLE_OPTIONS',        common:true,
        desc:'Defines how the node participates in the mesh. CLIENT is correct for almost all nodes. Only use ROUTER at genuinely strategic high sites.' },
      { key:'nodeInfoBroadcastSecs', label:'Node Info Interval',      type:'number',  unit:'s', min:60,             common:true,
        desc:'How often this node announces itself to the mesh. 3600s (1 hour) is sufficient for fixed nodes.' },
      { key:'rebroadcastMode',       label:'Rebroadcast Mode',        type:'select',  optKey:'REBROADCAST_OPTIONS', common:false,
        desc:'Controls which packets this node will repeat. ALL is default and correct for most nodes.' },
      { key:'tzdef',                 label:'Timezone (POSIX)',         type:'text',                                  common:false,
        desc:'POSIX timezone string. Example for Norway: CET-1CEST,M3.5.0,M10.5.0/3' },
      { key:'ledHeartbeatDisabled',  label:'Disable LED Heartbeat',   type:'bool',                                  common:false,
        desc:'Disables the periodic LED blink. Useful for covert or power-sensitive installations.' },
      { key:'isManaged',             label:'Managed Mode',            type:'bool',                                  common:false,
        desc:'⚠️ Locks the device to remote admin commands only. Very difficult to undo without physical access.', warn:true },
    ],
  },
  lora: {
    label: 'LoRa', icon: '📻',
    fields: [
      { key:'region',              label:'Region',            type:'select', optKey:'REGION_OPTIONS', common:true,
        desc:'Frequency region. Must match every other node in your mesh. EU_868 is correct for Norway/Europe.' },
      { key:'usePreset',           label:'Use Modem Preset',  type:'bool',                            common:true,
        desc:'Use a named preset (e.g. LongFast) instead of manually specifying bandwidth, SF and CR. Recommended unless running a custom network like Vestlandsnett.' },
      { key:'modemPreset',         label:'Modem Preset',      type:'select', optKey:'MODEM_OPTIONS',  common:true,
        desc:'LongFast is the Meshtastic default and is compatible with most nodes worldwide.' },
      { key:'txPower',             label:'TX Power',          type:'number', unit:'dBm', min:1, max:30, common:true,
        desc:'Transmit power in dBm. 27 dBm is typical max for EU_868. Higher is not always better — it can increase collisions on a busy mesh.' },
      { key:'hopLimit',            label:'Hop Limit',         type:'number', min:1, max:7,             common:true,
        desc:'Maximum number of hops a packet may take. 3 covers most real-world meshes. 7 is the absolute maximum and wastes airtime.' },
      { key:'txEnabled',           label:'TX Enabled',        type:'bool',                            common:true,
        desc:'Enable the transmitter. Disable only for receive-only monitoring nodes.' },
      { key:'bandwidth',           label:'Bandwidth',         type:'number', unit:'kHz',              common:false,
        desc:'Manual bandwidth in kHz. Only used when Use Modem Preset is off. Vestlandsnett uses 62 kHz.' },
      { key:'spreadFactor',        label:'Spread Factor',     type:'number', min:7, max:12,            common:false,
        desc:'Manual spreading factor (7–12). Higher = longer range, slower data rate. Vestlandsnett uses SF8.' },
      { key:'codingRate',          label:'Coding Rate',       type:'number', min:5, max:8,             common:false,
        desc:'Manual coding rate (5 = 4/5, 8 = 4/8). Higher = more redundancy, lower throughput.' },
      { key:'overrideFrequency',   label:'Override Frequency',type:'number', unit:'MHz',              common:false,
        desc:'Override the center frequency in MHz. Vestlandsnett uses 869.618 MHz.' },
      { key:'channelNum',          label:'Channel Number',    type:'number', min:0,                   common:false,
        desc:'Frequency channel offset within the region. Usually 0 when overrideFrequency is set.' },
      { key:'sx126xRxBoostedGain', label:'SX126x Boosted Gain',type:'bool',                           common:false,
        desc:'Enable RX boost on SX126x radios (e.g. EBYTE E22). Slightly improves sensitivity at the cost of a few mA extra.' },
      { key:'ignoreMqtt',          label:'Ignore MQTT',       type:'bool',                            common:false,
        desc:'Ignore packets that arrived via MQTT. Prevents double-delivery on mixed mesh/MQTT networks.' },
      { key:'overrideDutyCycle',   label:'Override Duty Cycle',type:'bool',                           common:false,
        desc:'⚠️ Bypass the regulatory 1% duty cycle limit. Illegal in EU without special permit.', warn:true },
    ],
  },
  position: {
    label: 'Position', icon: '📍',
    fields: [
      { key:'gpsMode',                       label:'GPS Mode',              type:'select', optKey:'GPS_OPTIONS', common:true,
        desc:'ENABLED: use onboard GPS. DISABLED: no GPS. NOT_PRESENT: board has no GPS hardware.' },
      { key:'fixedPosition',                 label:'Fixed Position',        type:'bool',                        common:true,
        desc:'Use a manually set fixed position instead of live GPS. Recommended for permanent fixed installs.' },
      { key:'positionBroadcastSecs',         label:'Broadcast Interval',    type:'number', unit:'s', min:0,     common:true,
        desc:'How often to broadcast position to the mesh. 900s for mobile, 3600s for fixed nodes. 0 = only broadcast on significant movement.' },
      { key:'positionBroadcastSmartEnabled', label:'Smart Broadcast',       type:'bool',                        common:false,
        desc:'Only broadcast position when the node has moved significantly. Saves airtime for mobile nodes.' },
      { key:'gpsUpdateInterval',             label:'GPS Update Interval',   type:'number', unit:'s',            common:false,
        desc:'How often to poll the GPS module internally. Does not affect broadcast frequency.' },
      { key:'gpsAttemptTime',                label:'GPS Attempt Time',      type:'number', unit:'s',            common:false,
        desc:'How long to try to get a GPS fix before giving up and going back to sleep.' },
      { key:'positionFlags',                 label:'Position Flags',        type:'number',                      common:false,
        desc:'Bitmask controlling which position fields are included in broadcasts. Default 811 includes altitude, speed and heading.' },
    ],
  },
  power: {
    label: 'Power', icon: '🔋',
    fields: [
      { key:'isPowerSaving',              label:'Power Saving',           type:'bool',             common:true,
        desc:'Enable sleep-based power saving. The node will enter light or deep sleep between transmissions. Not available for ROUTER role.' },
      { key:'onBatteryShutdownAfterSecs', label:'Shutdown After (battery)',type:'number', unit:'s', common:true,
        desc:'Shut down completely after this many seconds on battery. 0 = never. Useful as a safety cutoff.' },
      { key:'waitBluetoothSecs',          label:'Bluetooth Timeout',      type:'number', unit:'s', common:true,
        desc:'Turn off Bluetooth after this many seconds with no connection. 60s is a good default.' },
      { key:'sdsSecs',                    label:'Super Deep Sleep',       type:'number', unit:'s', common:false,
        desc:'Enter super deep sleep (full shutdown, wakes only on reset) after this many seconds. 0 = disabled.' },
      { key:'lsSecs',                     label:'Light Sleep',            type:'number', unit:'s', common:false,
        desc:'Enter light sleep after this many seconds of inactivity. Node still wakes on incoming packets.' },
      { key:'minWakeSecs',                label:'Min Wake Time',          type:'number', unit:'s', common:false,
        desc:'Minimum time to stay awake before sleeping again. Prevents rapid sleep/wake cycling.' },
    ],
  },
  display: {
    label: 'Display', icon: '🖥️',
    fields: [
      { key:'screenOnSecs',      label:'Screen Timeout',     type:'number', unit:'s', common:true,
        desc:'Turn off the screen after this many seconds. 0 = always on. Set low on battery-powered nodes.' },
      { key:'flipScreen',        label:'Flip Screen',        type:'bool',             common:true,
        desc:'Rotate the display 180°. Useful when the device is mounted upside-down.' },
      { key:'wakeOnTapOrMotion', label:'Wake on Tap/Motion', type:'bool',             common:false,
        desc:'Wake the screen when the device is tapped or moved (requires accelerometer).' },
      { key:'compassNorthTop',   label:'Compass North Up',   type:'bool',             common:false,
        desc:'Always show North at the top of the compass display instead of heading-up.' },
      { key:'headingBold',       label:'Bold Heading',       type:'bool',             common:false,
        desc:'Display the heading text in bold on the screen.' },
    ],
  },
  bluetooth: {
    label: 'Bluetooth', icon: '🔵',
    fields: [
      { key:'enabled',  label:'Enabled',       type:'bool',                               common:true,
        desc:'Enable Bluetooth. Required for configuration via the Meshtastic mobile app.' },
      { key:'mode',     label:'Pairing Mode',  type:'select', optKey:'BT_MODE_OPTIONS',   common:true,
        desc:'How the device pairs with a phone. Fixed PIN is most convenient for permanent installs.' },
      { key:'fixedPin', label:'Fixed PIN',     type:'number', min:0, max:999999,           common:true,
        desc:'6-digit PIN used when pairing mode is set to Fixed PIN.' },
    ],
  },
  network: {
    label: 'Network', icon: '🌐',
    fields: [
      { key:'wifiEnabled',   label:'WiFi Enabled',   type:'bool',     common:true,
        desc:'Enable WiFi. Only available on ESP32-based devices. Allows HTTP API and MQTT without a phone.' },
      { key:'wifiSsid',      label:'WiFi SSID',       type:'text',     common:true,  desc:'WiFi network name.' },
      { key:'wifiPsk',       label:'WiFi Password',   type:'password', common:true,  desc:'WiFi network password.' },
      { key:'ntpServer',     label:'NTP Server',      type:'text',     common:false,
        desc:'NTP server for time synchronisation. meshtastic.pool.ntp.org is the default.' },
      { key:'ethEnabled',    label:'Ethernet',        type:'bool',     common:false,
        desc:'Enable wired Ethernet. Only available on specific hardware (RAK with ETH module).' },
      { key:'rsyslogServer', label:'Syslog Server',   type:'text',     common:false,
        desc:'Send debug logs to a remote syslog server. Useful for monitoring fixed infrastructure nodes.' },
    ],
  },
  security: {
    label: 'Security', icon: '🔒',
    fields: [
      { key:'publicKey',           label:'Public Key',             type:'readonly', common:true,
        desc:'The node\'s public identity key. Safe to share. Used by other nodes to verify this node\'s identity.' },
      { key:'privateKey',          label:'Private Key',            type:'private',  common:true,
        desc:'Secret key. Never share this. Only reveal here if you need to back it up or restore to a new device.' },
      { key:'serialEnabled',       label:'Serial API Enabled',     type:'bool',     common:true,
        desc:'Allow configuration via the USB serial port. Should be enabled for MeshConfig to work.' },
      { key:'adminChannelEnabled', label:'Admin via Mesh Channel', type:'bool',     common:false,
        desc:'⚠️ Allow admin commands to arrive over the mesh channel (unencrypted). Only enable if you understand the implications.', warn:true },
      { key:'isManaged',           label:'Managed Mode',           type:'bool',     common:false,
        desc:'⚠️ Locks the device to remote admin commands only. Very difficult to undo without physical access.', warn:true },
    ],
  },
};

// ─── Editor state ─────────────────────────────────────────────────────────────

let editorState     = {};
let activeSection   = 'device';
let activeNetworkId = null;
let activeFunctionId = null;

// ─── DOM ──────────────────────────────────────────────────────────────────────

const btnConnect       = document.getElementById('btn-connect');
const statusEl         = document.getElementById('connection-status');
const protoStatusEl    = document.getElementById('proto-status');
const sectionNodeInfo  = document.getElementById('section-nodeinfo');
const sectionEditor    = document.getElementById('section-editor');
const sectionBackup    = document.getElementById('section-backup');
const sectionConfig    = document.getElementById('section-config');
const configDisplay    = document.getElementById('config-display');
const btnBackup        = document.getElementById('btn-backup');
const inputRestore     = document.getElementById('input-restore');
const btnRestore       = document.getElementById('btn-restore');

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

    const mk = (enumObj, descMap) =>
      Object.entries(enumObj.values).map(([k,v]) => ({ value:v, label:k, desc: descMap?.[k]||'' }));

    ROLE_OPTIONS = mk(Root.lookupEnum('meshtastic.Config.DeviceConfig.Role'), {
      CLIENT:        'General purpose. Sends, receives and rebroadcasts. Correct for most nodes.',
      CLIENT_MUTE:   'Sends and receives but never rebroadcasts. Use near a stronger node to reduce airtime.',
      ROUTER:        'Always rebroadcasts with priority. Only for high, well-positioned infrastructure sites.',
      ROUTER_CLIENT: 'Deprecated. Use CLIENT or ROUTER.',
      REPEATER:      'Rebroadcasts everything blindly. Rarely the right choice — can cause congestion.',
      TRACKER:       'GPS tracker. Sends position only, special sleep behaviour.',
      SENSOR:        'Telemetry sensor. Sends environment data only, special sleep behaviour.',
      TAK:           'TAK/ATAK compatible mode for tactical applications.',
      CLIENT_HIDDEN: 'Like CLIENT but hidden from the node list.',
      LOST_AND_FOUND:'Lost and found beacon mode.',
      TAK_TRACKER:   'TAK tracker combined mode.',
    });
    REGION_OPTIONS    = mk(Root.lookupEnum('meshtastic.Config.LoRaConfig.RegionCode'), null);
    MODEM_OPTIONS     = mk(Root.lookupEnum('meshtastic.Config.LoRaConfig.ModemPreset'), {
      LONG_FAST:      'Best balance of range and speed. Meshtastic default. ~1.07 kbps.',
      LONG_SLOW:      'Longer range, slower. ~0.18 kbps.',
      VERY_LONG_SLOW: 'Maximum range, very slow. Use sparingly — wastes airtime.',
      MEDIUM_SLOW:    'Medium range, slower.',
      MEDIUM_FAST:    'Medium range, faster.',
      SHORT_SLOW:     'Short range, slower.',
      SHORT_FAST:     'Short range, fastest.',
      LONG_MODERATE:  'Long range, moderate speed.',
    });
    GPS_OPTIONS       = mk(Root.lookupEnum('meshtastic.Config.PositionConfig.GpsMode'), {
      DISABLED:    'GPS disabled. Node will not determine its own position.',
      ENABLED:     'GPS enabled. Node uses onboard GPS receiver.',
      NOT_PRESENT: 'No GPS hardware on this board.',
    });
    BT_MODE_OPTIONS   = mk(Root.lookupEnum('meshtastic.Config.BluetoothConfig.PairingMode'), {
      RANDOM_PIN: 'New random PIN each time the device is paired.',
      FIXED_PIN:  'Use the fixed PIN defined below. Easier for permanent installs.',
      NO_PIN:     'No PIN required. Convenient but less secure.',
    });
    REBROADCAST_OPTIONS = mk(Root.lookupEnum('meshtastic.Config.DeviceConfig.RebroadcastMode'), {
      ALL:               'Repeat all packets (default).',
      ALL_SKIP_DECODING: 'Repeat without decoding. Slightly faster but no SNR filtering.',
      LOCAL_ONLY:        'Only repeat packets from nodes heard directly (no multi-hop).',
      KNOWN_ONLY:        'Only repeat packets from nodes in this node\'s database.',
      NONE:              'Do not repeat any packets.',
    });

    protoStatusEl.textContent = 'Proto: loaded';
    protoStatusEl.className   = 'status status--connected';
  } catch (err) {
    protoStatusEl.textContent = 'Proto: FAILED';
    protoStatusEl.className   = 'status status--disconnected';
    console.error('Proto load failed:', err);
  }
}

// ─── Connection ───────────────────────────────────────────────────────────────

btnConnect.addEventListener('click', async () => {
  state.connected ? await disconnect() : await connect();
});

async function connect() {
  if (!('serial' in navigator)) { alert('WebSerial requires Chrome or Edge.'); return; }
  if (!Root) { alert('Proto not loaded yet — reload the page.'); return; }
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
  editorState = {}; activeNetworkId = null; activeFunctionId = null;
  setStatus('disconnected');
  btnConnect.textContent = 'Connect via USB';
  hideConnectedSections();
}

// ─── Serial write ─────────────────────────────────────────────────────────────

async function writePacket(msg) {
  if (!state.writer) return;
  const payload = Types.ToRadio.encode(msg).finish();
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
  const append  = b => { if (rxLen+b.length > rxBuf.length) { const n=new Uint8Array(Math.max(rxBuf.length*2,rxLen+b.length+1024)); n.set(rxBuf.subarray(0,rxLen)); rxBuf=n; } rxBuf.set(b,rxLen); rxLen+=b.length; };
  const consume = n => { rxBuf.copyWithin(0,n); rxLen-=n; };
  try {
    while (state.connected) {
      const { value, done } = await state.reader.read();
      if (done) break;
      if (!value?.length) continue;
      append(value);
      let progress = true;
      while (progress) {
        progress = false;
        let sp = -1;
        for (let i=0; i<rxLen-1; i++) { if (rxBuf[i]===START1&&rxBuf[i+1]===START2) { sp=i; break; } }
        if (sp < 0)  { if (rxLen>1) consume(rxLen-1); break; }
        if (sp > 0)  { consume(sp); progress=true; continue; }
        if (rxLen<4) break;
        const pLen = (rxBuf[2]<<8)|rxBuf[3];
        if (pLen===0||pLen>MAX_PACKET) { consume(1); progress=true; continue; }
        if (rxLen < 4+pLen) break;
        const payload = rxBuf.slice(4,4+pLen);
        let ok = false;
        try { dispatchFromRadio(Types.FromRadio.decode(payload)); ok=true; }
        catch(e) { console.debug('Skip sync:', e.message.substring(0,60)); }
        consume(ok ? 4+pLen : 1); progress=true;
      }
    }
  } finally { try { state.reader.releaseLock(); } catch(_) {} state.reader=null; }
}

// ─── FromRadio dispatch ───────────────────────────────────────────────────────

function dispatchFromRadio(msg) {
  const v = msg.payloadVariant;
  if (!v) { console.debug('FromRadio: no variant num='+msg.num); return; }
  console.log('FromRadio:', v);
  switch(v) {
    case 'myInfo':           handleMyInfo(msg.myInfo);                  break;
    case 'nodeInfo':         handleNodeInfo(msg.nodeInfo);              break;
    case 'config':           handleConfig(msg.config);                  break;
    case 'moduleConfig':     handleModuleConfig(msg.moduleConfig);      break;
    case 'channel':          handleChannel(msg.channel);                break;
    case 'deviceMetadata':   handleDeviceMetadata(msg.deviceMetadata);  break;
    case 'configCompleteId': handleConfigComplete();                    break;
    case 'deviceUiConfig':   break;
    case 'logRecord':        console.debug('[Node]',msg.logRecord?.message); break;
    default:                 console.debug('FromRadio unhandled:',v);   break;
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

function handleMyInfo(myInfo) {
  state.myInfo = myInfo;
  document.getElementById('info-id').textContent =
    myInfo.myNodeNum ? '!'+myInfo.myNodeNum.toString(16).padStart(8,'0') : '—';
  updateOwnNodeDisplay();
}

function handleNodeInfo(nodeInfo) {
  state.nodeInfos[nodeInfo.num] = nodeInfo;
  updateOwnNodeDisplay();
}

function updateOwnNodeDisplay() {
  if (!state.myInfo||!state.nodeInfos) return;
  const own = state.nodeInfos[state.myInfo.myNodeNum];
  if (!own) return;
  state.nodeInfo = own;
  const u = own.user||{};
  document.getElementById('info-name').textContent      = u.longName  || '—';
  document.getElementById('info-shortname').textContent = u.shortName || '—';
  document.getElementById('info-hw').textContent        = u.hwModel!==undefined ? String(u.hwModel) : '—';
  document.getElementById('info-role').textContent      = labelFor(ROLE_OPTIONS, u.role);
}

function handleConfig(config) {
  const t = config.payloadVariant;
  state.config[t] = config[t];
  if (t==='lora'&&config.lora)
    document.getElementById('info-region').textContent = labelFor(REGION_OPTIONS, config.lora.region);
  refreshConfigDisplay();
}

function handleModuleConfig(mc) {
  const t = mc.payloadVariant;
  state.moduleConfig[t] = mc[t];
  refreshConfigDisplay();
}

function handleChannel(ch) { state.channels[ch.index] = ch; }

function handleDeviceMetadata(md) {
  state.metadata = md;
  document.getElementById('info-fw').textContent = md.firmwareVersion || '—';
}

function handleConfigComplete() {
  state.configDone = true;
  console.log('Config complete');
  refreshConfigDisplay();
  if (activeNetworkId && activeFunctionId) rebuildEditorState();
}

function refreshConfigDisplay() {
  const prefix = state.configDone ? '' : '// Receiving config...\n\n';
  configDisplay.textContent = prefix + JSON.stringify({config:state.config, moduleConfig:state.moduleConfig},null,2);
}

function labelFor(opts, val) {
  const o = opts.find(o=>o.value===val);
  return o ? o.label : (val!==undefined ? String(val) : '—');
}

// ─── Two-level editor ─────────────────────────────────────────────────────────

function selectNetwork(networkId) {
  activeNetworkId  = networkId;
  activeFunctionId = null;

  document.querySelectorAll('.net-card').forEach(c =>
    c.classList.toggle('active', c.dataset.net === networkId));

  // Show function selector, hide form
  document.getElementById('function-row').classList.remove('hidden');
  document.getElementById('editor-form').classList.add('hidden');
  document.querySelectorAll('.fn-card').forEach(c => c.classList.remove('active'));
}

function selectFunction(functionId) {
  activeFunctionId = functionId;

  document.querySelectorAll('.fn-card').forEach(c =>
    c.classList.toggle('active', c.dataset.fn === functionId));

  rebuildEditorState();

  // Show warning if repeater
  const fn = FUNCTIONS[functionId];
  const warnEl = document.getElementById('fn-warning');
  if (fn.warn) {
    warnEl.textContent = fn.warn;
    warnEl.classList.remove('hidden');
  } else {
    warnEl.classList.add('hidden');
  }

  document.getElementById('editor-form').classList.remove('hidden');
  renderEditorTabs();
  renderEditorPanel(activeSection);
}

function rebuildEditorState() {
  const net = NETWORKS[activeNetworkId];
  const fn  = FUNCTIONS[activeFunctionId];
  // Start from node's current config
  editorState = JSON.parse(JSON.stringify(state.config));
  // Apply network LoRa settings
  if (!editorState.lora) editorState.lora = {};
  Object.assign(editorState.lora, net.lora);
  // Apply function settings section by section
  for (const [section, values] of Object.entries(fn.config)) {
    if (!editorState[section]) editorState[section] = {};
    Object.assign(editorState[section], values);
  }
}

// ─── Editor render ────────────────────────────────────────────────────────────

function renderEditorTabs() {
  const tabsEl = document.getElementById('editor-tabs');
  tabsEl.innerHTML = Object.entries(SECTIONS).map(([key,sec]) =>
    `<button class="tab-btn${key===activeSection?' active':''}" data-sec="${key}">${sec.icon} ${sec.label}</button>`
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
  const panel   = document.getElementById('editor-panel');
  const common  = section.fields.filter(f => f.common);
  const advanced= section.fields.filter(f => !f.common);
  let html = `<div class="field-group">${common.map(f=>renderField(f,data[f.key])).join('')}</div>`;
  if (advanced.length)
    html += `<details class="advanced-section"><summary>▶ Advanced</summary>
      <div class="field-group advanced-fields">${advanced.map(f=>renderField(f,data[f.key])).join('')}</div>
    </details>`;
  panel.innerHTML = html;
  // Wire private key toggle
  panel.querySelector('.pk-toggle')?.addEventListener('change', e => {
    panel.querySelector('.pk-value').style.display = e.target.checked ? '' : 'none';
  });
}

function renderField(f, value) {
  const v = (value!==undefined&&value!==null) ? value : '';
  const warnCls = f.warn ? ' field-warn' : '';
  const descHtml = f.desc
    ? `<span class="field-desc" title="${f.desc.replace(/"/g,'&quot;')}">?</span>` : '';

  let input = '';
  switch(f.type) {
    case 'select': {
      const opts = getOptions(f.optKey);
      const selOpt = opts.find(o=>o.value===v);
      input = `<div class="select-wrap">
        <select class="field-input" data-key="${f.key}">
          ${opts.map(o=>`<option value="${o.value}"${o.value===v?' selected':''}>${o.label}</option>`).join('')}
        </select>
        <div class="select-desc" id="sdesc-${f.key}">${selOpt?.desc||''}</div>
      </div>`;
      break;
    }
    case 'bool':
      input = `<label class="toggle">
        <input type="checkbox" class="field-input" data-key="${f.key}"${v?' checked':''}>
        <span class="toggle-slider"></span>
      </label>`;
      break;
    case 'number':
      input = `<div class="num-wrap">
        <input type="number" class="field-input" data-key="${f.key}" value="${v}"
          ${f.min!==undefined?`min="${f.min}"`:''}
          ${f.max!==undefined?`max="${f.max}"`:''}
          ${f.unit?`placeholder="${f.unit}"`:''}
          step="any">
        ${f.unit?`<span class="unit">${f.unit}</span>`:''}
      </div>`;
      break;
    case 'password':
      input = `<input type="password" class="field-input" data-key="${f.key}" value="${v}" autocomplete="off">`;
      break;
    case 'readonly': {
      const disp = v instanceof Uint8Array ? btoa(String.fromCharCode(...v)) : (v?String(v):'—');
      input = `<input type="text" class="field-input readonly" readonly value="${disp}" title="Read-only">`;
      break;
    }
    case 'private': {
      const disp = v instanceof Uint8Array ? btoa(String.fromCharCode(...v)) : (v?String(v):'');
      input = `<div class="private-wrap">
        <label class="pk-label"><input type="checkbox" class="pk-toggle"> Show private key</label>
        <input type="text" class="field-input pk-value" data-key="${f.key}" value="${disp}" style="display:none" readonly>
      </div>`;
      break;
    }
    default:
      input = `<input type="text" class="field-input" data-key="${f.key}" value="${v}">`;
  }

  return `<div class="field-row${warnCls}">
    <label class="field-label">${f.label}${descHtml}</label>
    <div class="field-input-wrap">${input}</div>
  </div>`;
}

function getOptions(optKey) {
  return ({ROLE_OPTIONS,REGION_OPTIONS,MODEM_OPTIONS,GPS_OPTIONS,BT_MODE_OPTIONS,REBROADCAST_OPTIONS})[optKey]||[];
}

// Update select descriptions live
document.addEventListener('change', e => {
  if (!e.target.matches('select.field-input')) return;
  const key = e.target.dataset.key;
  const descEl = document.getElementById('sdesc-'+key);
  if (!descEl) return;
  for (const sec of Object.values(SECTIONS)) {
    const fd = sec.fields.find(f=>f.key===key);
    if (fd) { const o=getOptions(fd.optKey).find(o=>String(o.value)===e.target.value); descEl.textContent=o?.desc||''; break; }
  }
});

function saveCurrentPanel() {
  const panel = document.getElementById('editor-panel');
  if (!panel||!activeSection) return;
  if (!editorState[activeSection]) editorState[activeSection]={};
  panel.querySelectorAll('.field-input:not(.readonly):not(.pk-value)').forEach(el => {
    const key = el.dataset.key;
    if (!key) return;
    if (el.type==='checkbox')   editorState[activeSection][key] = el.checked;
    else if (el.type==='number') editorState[activeSection][key] = el.value!=='' ? Number(el.value) : undefined;
    else                         editorState[activeSection][key] = el.value;
  });
}

async function applyEditorConfig() {
  if (!state.connected) { alert('Not connected.'); return; }
  saveCurrentPanel();
  const net = NETWORKS[activeNetworkId];
  const fn  = FUNCTIONS[activeFunctionId];
  const summary = `Network: ${net?.label||'—'}\nFunction: ${fn?.label||'—'}\n\nThis will write all modified sections to the device.`;
  if (!confirm(`Apply configuration to node?\n\n${summary}`)) return;

  let sent = 0;
  for (const cfgType of ['device','position','power','network','display','lora','bluetooth','security']) {
    if (!editorState[cfgType]) continue;
    const clean = Object.fromEntries(Object.entries(editorState[cfgType]).filter(([,v])=>v!==undefined));
    try {
      await writePacket(Types.ToRadio.create({ admin: Types.AdminMessage.create({ setConfig: Types.Config.create({ [cfgType]: clean }) }) }));
      sent++; await sleep(200);
    } catch(e) { console.error('setConfig failed:', cfgType, e); }
  }
  alert(`Done — ${sent} section(s) sent.\n\nThe node will apply the settings.`);
}

// ─── Backup ───────────────────────────────────────────────────────────────────

btnBackup.addEventListener('click', () => {
  if (!state.configDone) { alert('Config not fully loaded yet.'); return; }
  const yaml = jsonToYaml({
    _comment: 'MeshConfig backup — ' + new Date().toISOString(),
    owner:         state.nodeInfo?.user || {},
    owner_short:   state.nodeInfo?.user?.shortName || '',
    config:        state.config,
    module_config: state.moduleConfig,
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([yaml], {type:'text/yaml'}));
  a.download = 'meshconfig-backup.yaml';
  a.click();
});

btnRestore.addEventListener('click', () => {
  const file = inputRestore.files[0];
  if (!file)             { alert('Select a YAML file first.'); return; }
  if (!state.connected)  { alert('Not connected.'); return; }
  if (!state.configDone) { alert('Config not fully loaded yet.'); return; }
  const r = new FileReader();
  r.onload = e => importConfig(e.target.result);
  r.readAsText(file);
});

async function importConfig(yamlText) {
  let doc;
  try { doc = parseSimpleYaml(yamlText); } catch(e) { alert('Parse failed: '+e.message); return; }
  if (!doc.config) { alert("No 'config' section found."); return; }
  if (!confirm('Apply backup config to the connected node?\n\nThis will overwrite the current configuration.')) return;
  let sent = 0;
  for (const t of ['device','position','power','network','display','lora','bluetooth','security']) {
    if (!doc.config[t]) continue;
    try {
      await writePacket(Types.ToRadio.create({ admin: Types.AdminMessage.create({ setConfig: Types.Config.create({ [t]: doc.config[t] }) }) }));
      sent++; await sleep(200);
    } catch(e) { console.error('restore failed:', t, e); }
  }
  alert('Restore complete — ' + sent + ' section(s) sent.');
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function setStatus(s) {
  statusEl.textContent = {disconnected:'Disconnected',connecting:'Connecting…',connected:'Connected'}[s]||s;
  statusEl.className = 'status status--'+s;
}

function showConnectedSections() {
  [sectionNodeInfo,sectionEditor,sectionBackup,sectionConfig].forEach(s=>s.classList.remove('hidden'));
}
function hideConnectedSections() {
  [sectionNodeInfo,sectionEditor,sectionBackup,sectionConfig].forEach(s=>s.classList.add('hidden'));
  configDisplay.textContent = 'No config loaded.';
  ['info-name','info-shortname','info-hw','info-fw','info-id','info-role','info-region']
    .forEach(id=>document.getElementById(id).textContent='—');
}

function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

// ─── YAML helpers ─────────────────────────────────────────────────────────────

function jsonToYaml(obj, i=0) {
  const p='  '.repeat(i);
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
    return obj.map(x=>`${p}- ${jsonToYaml(x,i+1)}`).join('\n');
  }
  if (typeof obj==='object') {
    const e=Object.entries(obj).filter(([,v])=>v!==undefined&&v!==null);
    if (!e.length) return '{}';
    return e.map(([k,v])=>{
      const s=jsonToYaml(v,i+1);
      return (typeof v==='object'&&v!==null&&!Array.isArray(v)&&Object.keys(v).length>0)
        ?`${p}${k}:\n${s}`:`${p}${k}: ${s}`;
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
    if (val===''||val==='{}') { const c={}; parent[key]=c; stack.push({obj:c,indent}); }
    else parent[key]=parseYamlValue(val);
  }
  return result;
}

function parseYamlValue(v) {
  if (v==='true') return true; if (v==='false') return false;
  if (v==='null'||v==='~') return null;
  if (/^".*"$/.test(v)) return v.slice(1,-1).replace(/\\"/g,'"');
  if (/^-?\d+$/.test(v)) return parseInt(v,10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  return v;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadProto();
