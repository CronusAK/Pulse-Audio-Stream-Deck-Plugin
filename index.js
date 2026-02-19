const WebSocket = require("ws");
const { spawn } = require("child_process");
const pipewire = require("./pipewire");

// --- CLI arg parsing ---
// OpenDeck launches plugins with: -port <port> -pluginUUID <uuid> -registerEvent <event> -info <json>
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^-/, "")] = process.argv[i + 1];
}

const port = args.port;
const pluginUUID = args.pluginUUID;
const registerEvent = args.registerEvent;

if (!port || !pluginUUID || !registerEvent) {
  console.error("Missing required args: -port, -pluginUUID, -registerEvent");
  process.exit(1);
}

// --- Action UUID prefix ---
const PREFIX = "com.sfgrimes.pipewire-audio.";

// --- Context tracking ---
// Map of context string -> { action, short, context, settings, controller, ... }
const contexts = new Map();

// Derive the short action name and icon type from a full action UUID
function actionMeta(action) {
  const short = action.replace(PREFIX, "");
  let iconType = null;
  if (short.startsWith("volume") || short === "mutetoggle") iconType = "speaker";
  else if (short.startsWith("mic") || short === "micmute") iconType = "microphone";
  else if (short.startsWith("app")) iconType = "app";
  else if (short.startsWith("output") || short === "switchoutput") iconType = "output";
  else if (short.startsWith("input") || short === "switchinput") iconType = "input";
  else if (short === "pushtotalk") iconType = "microphone";
  return { short, iconType };
}

// --- WebSocket helpers ---
function send(obj) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// Per-context caches to avoid redundant sends (and resulting disk writes)
const lastTitleCache = new Map();
const lastImageCache = new Map();
const lastStateCache = new Map();

function setTitle(context, title) {
  if (lastTitleCache.get(context) === title) return;
  lastTitleCache.set(context, title);
  send({
    event: "setTitle",
    context,
    payload: { title, target: 0 },
  });
}

function setState(context, state) {
  if (lastStateCache.get(context) === state) return;
  lastStateCache.set(context, state);
  send({
    event: "setState",
    context,
    payload: { state },
  });
}

function sendToPropertyInspector(context, payload) {
  send({
    event: "sendToPropertyInspector",
    context,
    payload,
  });
}

// --- SVG layout presets ---
const LAYOUTS = {
  Encoder: {
    w: 200, h: 100, cx: 100,
    barX: 10, barW: 180, barY: 80,
    nameWrapThreshold: 10,
    nameSingleSize: 50, nameSingleYOff: 6,
    nameWrapSize: 30, nameWrapYOff1: -14, nameWrapYOff2: 18,
    pctLargeSize: 56, pctLargeYOff: 8,
    pctSmallSize: 30, pctSmallYOff: 6,
    bothNameY: 28, bothPctY: 56,
    singleY: 38,
    muteTransform: "translate(170,4) scale(0.6)",
    bgIcons: {
      speaker: `<g transform="translate(62,5) scale(3.2)" opacity="0.15">
<path d="M3 9v6h4l5 5V4L7 9H3z" fill="#fff"/>
<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" fill="#fff"/>
<path d="M19 12c0 2.87-1.65 5.36-4 6.58v2.16c3.44-1.35 6-4.73 6-8.74s-2.56-7.39-6-8.74v2.16c2.35 1.22 4 3.71 4 6.58z" fill="#fff"/>
</g>`,
      microphone: `<g transform="translate(72,2) scale(3.2)" opacity="0.15">
<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="#fff"/>
<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="#fff"/>
</g>`,
      app: `<g transform="translate(62,2) scale(3.2)" opacity="0.15">
<path d="M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z" fill="#fff"/>
</g>`,
      output: `<g transform="translate(60,0) scale(3.4)" opacity="0.15">
<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="#fff"/>
<path d="M6 10c-.6 0-1 .4-1 1a7 7 0 0 0 14 0c0-.6-.4-1-1-1s-1 .4-1 1a5 5 0 0 1-10 0c0-.6-.4-1-1-1z" fill="#fff"/>
<rect x="11" y="19" width="2" height="3" rx="1" fill="#fff"/>
<rect x="8" y="21" width="8" height="2" rx="1" fill="#fff"/>
</g>`,
      input: `<g transform="translate(72,2) scale(3.2)" opacity="0.15">
<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="#fff"/>
<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="#fff"/>
</g>`,
    },
  },
  Keypad: {
    w: 144, h: 144, cx: 72,
    barX: 12, barW: 120, barY: 126,
    nameWrapThreshold: 8,
    nameSingleSize: 28, nameSingleYOff: 4,
    nameWrapSize: 20, nameWrapYOff1: -10, nameWrapYOff2: 14,
    pctLargeSize: 48, pctLargeYOff: 6,
    pctSmallSize: 24, pctSmallYOff: 4,
    bothNameY: 46, bothPctY: 82,
    singleY: 60,
    muteTransform: "translate(112,4) scale(0.8)",
    bgIcons: {
      speaker: `<g transform="translate(24,8) scale(4.0)" opacity="0.15">
<path d="M3 9v6h4l5 5V4L7 9H3z" fill="#fff"/>
<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" fill="#fff"/>
<path d="M19 12c0 2.87-1.65 5.36-4 6.58v2.16c3.44-1.35 6-4.73 6-8.74s-2.56-7.39-6-8.74v2.16c2.35 1.22 4 3.71 4 6.58z" fill="#fff"/>
</g>`,
      microphone: `<g transform="translate(24,2) scale(4.0)" opacity="0.15">
<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="#fff"/>
<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="#fff"/>
</g>`,
      app: `<g transform="translate(24,4) scale(4.0)" opacity="0.15">
<path d="M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z" fill="#fff"/>
</g>`,
      output: `<g transform="translate(22,0) scale(4.2)" opacity="0.15">
<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="#fff"/>
<path d="M6 10c-.6 0-1 .4-1 1a7 7 0 0 0 14 0c0-.6-.4-1-1-1s-1 .4-1 1a5 5 0 0 1-10 0c0-.6-.4-1-1-1z" fill="#fff"/>
<rect x="11" y="19" width="2" height="3" rx="1" fill="#fff"/>
<rect x="8" y="21" width="8" height="2" rx="1" fill="#fff"/>
</g>`,
      input: `<g transform="translate(24,2) scale(4.0)" opacity="0.15">
<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="#fff"/>
<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="#fff"/>
</g>`,
    },
  },
};

// --- Unified SVG rendering ---
function buildNameText(title, yCenter, L) {
  if (title.length > L.nameWrapThreshold) {
    const mid = title.lastIndexOf(" ", Math.ceil(title.length / 2));
    if (mid > 0) {
      const l1 = title.substring(0, mid);
      const l2 = title.substring(mid + 1);
      return `<text x="${L.cx}" y="${yCenter + L.nameWrapYOff1}" text-anchor="middle" fill="#fff" font-size="${L.nameWrapSize}" font-family="sans-serif" font-weight="bold" textLength="${L.barW}" lengthAdjust="spacingAndGlyphs">${l1}</text>
<text x="${L.cx}" y="${yCenter + L.nameWrapYOff2}" text-anchor="middle" fill="#fff" font-size="${L.nameWrapSize}" font-family="sans-serif" font-weight="bold" textLength="${L.barW}" lengthAdjust="spacingAndGlyphs">${l2}</text>`;
    }
  }
  return `<text x="${L.cx}" y="${yCenter + L.nameSingleYOff}" text-anchor="middle" fill="#fff" font-size="${L.nameSingleSize}" font-family="sans-serif" font-weight="bold" textLength="${L.barW}" lengthAdjust="spacingAndGlyphs">${title}</text>`;
}

function buildPercentText(percent, yCenter, large, L) {
  const size = large ? L.pctLargeSize : L.pctSmallSize;
  const yOff = large ? L.pctLargeYOff : L.pctSmallYOff;
  return `<text x="${L.cx}" y="${yCenter + yOff}" text-anchor="middle" fill="#fff" font-size="${size}" font-family="sans-serif" font-weight="bold">${percent}%</text>`;
}

function renderSVG(title, muted, percent, options, L) {
  const showName = options && options.showName !== undefined ? options.showName : true;
  const showPercent = options && options.showPercent !== undefined ? options.showPercent : false;
  const showBar = options && options.showBar !== undefined ? options.showBar : true;
  const iconType = options && options.iconType || null;

  const fillW = Math.round((percent / 100) * L.barW);
  const barColor = (options && options.barColor) || (muted ? "#666" : "#f7821b");

  const bgIcon = (!showName && iconType && L.bgIcons[iconType]) ? L.bgIcons[iconType] : "";

  const muteIcon = muted
    ? `<g transform="${L.muteTransform}"><path d="M3 9v6h4l5 5V4L7 9H3z" fill="#fff"/><line x1="2" y1="2" x2="22" y2="22" stroke="#e33" stroke-width="3" stroke-linecap="round"/></g>`
    : "";

  let textBlock = "";
  if (showName && showPercent) {
    textBlock = buildNameText(title, L.bothNameY, L) + "\n" + buildPercentText(percent, L.bothPctY, false, L);
  } else if (showName) {
    textBlock = buildNameText(title, L.singleY, L);
  } else if (showPercent) {
    textBlock = buildPercentText(percent, L.singleY, true, L);
  }

  const barBlock = showBar
    ? `<rect x="${L.barX}" y="${L.barY}" width="${L.barW}" height="10" rx="5" fill="#333"/>
<rect x="${L.barX}" y="${L.barY}" width="${fillW}" height="10" rx="5" fill="${barColor}"/>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.w}" height="${L.h}">
<rect width="${L.w}" height="${L.h}" fill="#000"/>
${bgIcon}
${textBlock}
${muteIcon}
${barBlock}
</svg>`;
}

function renderKeypadSVG(muted, percent, options) {
  const W = 144, H = 144, CX = 72;
  const barX = 12, barW = 120, barH = 6, barY = 110;
  const fillW = Math.round((percent / 100) * barW);
  const barColor = muted ? "#666" : "#f7821b";
  const hint = options && options.actionHint;
  const showBar = options && options.showBar !== undefined ? options.showBar : true;
  const showPercent = options && options.showPercent !== undefined ? options.showPercent : false;

  // Action-specific center icon
  let icon = "";
  if (hint === "up") {
    icon = `<polyline points="40,82 72,44 104,82" fill="none" stroke="#4caf50" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (hint === "down") {
    icon = `<polyline points="40,44 72,82 104,44" fill="none" stroke="#f44336" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (hint === "mute") {
    const iconType = options && options.iconType;
    if (iconType === "microphone" || iconType === "input") {
      icon = `<g transform="translate(36,36) scale(3.0)" opacity="0.85">
<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="#fff"/>
<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="#fff"/>
</g>`;
    } else {
      icon = `<g transform="translate(30,38) scale(3.5)" opacity="0.85">
<path d="M3 9v6h4l5 5V4L7 9H3z" fill="#fff"/>
<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" fill="#fff"/>
<path d="M19 12c0 2.87-1.65 5.36-4 6.58v2.16c3.44-1.35 6-4.73 6-8.74s-2.56-7.39-6-8.74v2.16c2.35 1.22 4 3.71 4 6.58z" fill="#fff"/>
</g>`;
    }
    if (muted) {
      icon += `<line x1="32" y1="32" x2="112" y2="100" stroke="#e33" stroke-width="5" stroke-linecap="round"/>`;
    }
  }

  // Volume bar (conditional)
  const bar = showBar
    ? `<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="3" fill="#333"/>
<rect x="${barX}" y="${barY}" width="${fillW}" height="${barH}" rx="3" fill="${barColor}"/>`
    : "";

  // Percentage below bar (conditional)
  const pctText = showPercent
    ? `<text x="${CX}" y="132" text-anchor="middle" fill="#fff" font-size="16" font-family="sans-serif" font-weight="bold">${percent}%</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#000"/>
${icon}
${bar}
${pctText}
</svg>`;
}

// --- Push-to-talk SVG rendering (Keypad only) ---
function renderPTTSvg(active) {
  const bgDark  = active ? "#1b5e20" : "#b71c1c";
  const bgLight = active ? "#388e3c" : "#c62828";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
<rect width="144" height="144" fill="#000"/>
<circle cx="72" cy="72" r="62" fill="${bgDark}"/>
<circle cx="72" cy="72" r="56" fill="${bgLight}"/>
<g transform="translate(36,38) scale(3.0)">
<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" fill="#fff"/>
<path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" fill="#fff"/>
</g>
</svg>`;
}

function setPTTImage(ctx, active) {
  const svg = renderPTTSvg(active);
  if (lastImageCache.get(ctx.context) === svg) return;
  lastImageCache.set(ctx.context, svg);
  const b64 = Buffer.from(svg).toString("base64");
  setTitle(ctx.context, "");
  send({
    event: "setImage",
    context: ctx.context,
    payload: { image: `data:image/svg+xml;base64,${b64}`, target: 0 },
  });
}

function setImage(context, title, muted, percent, options, controller) {
  const pct = percent != null ? percent : 0;
  let svg;
  if (controller === "Keypad" && options && options.actionHint) {
    svg = renderKeypadSVG(!!muted, pct, options);
  } else {
    const L = LAYOUTS[controller] || LAYOUTS.Keypad;
    svg = renderSVG(title, !!muted, pct, options, L);
  }
  if (lastImageCache.get(context) === svg) return;
  lastImageCache.set(context, svg);
  const b64 = Buffer.from(svg).toString("base64");
  if (controller === "Keypad") {
    const showName = options && options.showName !== undefined ? options.showName : true;
    setTitle(context, showName ? title : "");
  }
  send({
    event: "setImage",
    context,
    payload: { image: `data:image/svg+xml;base64,${b64}`, target: 0 },
  });
}

// --- Display helpers ---
function getTargetForAction(short) {
  if (short.startsWith("volume") || short === "mutetoggle") {
    return "@DEFAULT_AUDIO_SINK@";
  }
  if (short.startsWith("mic") || short === "micmute") {
    return "@DEFAULT_AUDIO_SOURCE@";
  }
  return null;
}

const COMBINED_VOL = ["volume", "micvolume", "appvolume", "outputvolume", "inputvolume"];

function displayOpts(ctx) {
  const showName = ctx.settings && ctx.settings.showName !== undefined ? ctx.settings.showName : true;
  const showPercent = ctx.settings && ctx.settings.showPercent !== undefined ? ctx.settings.showPercent : false;
  const showBar = ctx.settings && ctx.settings.showBar !== undefined ? ctx.settings.showBar : true;
  const opts = { showName, showPercent, showBar, iconType: ctx.iconType };
  if (ctx.short === "switchoutput" || ctx.short === "switchinput") {
    opts.barColor = ctx.isActive ? "#4caf50" : "#666";
  }
  let actionHint = null;
  if (COMBINED_VOL.includes(ctx.short)) {
    const dir = ctx.settings && ctx.settings.direction;
    actionHint = dir === "mute" ? "mute" : (dir === "down" ? "down" : "up");
  } else if (ctx.short.endsWith("up")) {
    actionHint = "up";
  } else if (ctx.short.endsWith("down")) {
    actionHint = "down";
  } else if (ctx.short.includes("mute")) {
    actionHint = "mute";
  }
  opts.actionHint = actionHint;
  return opts;
}

function updateDisplay(ctx, data) {
  const title = (ctx.settings && ctx.settings.customName) || ctx.nodeName || "...";
  const opts = displayOpts(ctx);

  // Switch actions: show active state via bar
  if (ctx.short === "switchoutput" || ctx.short === "switchinput") {
    const pct = ctx.isActive ? 100 : 0;
    setImage(ctx.context, title, false, pct, opts, ctx.controller);
    setState(ctx.context, ctx.isActive ? 0 : 1);
    return;
  }

  setImage(ctx.context, title, data ? data.muted : false, data ? data.percent : 0, opts, ctx.controller);

  // State for mute mode: track muted/unmuted so OpenDeck shows the right icon
  if (data) {
    const isMuteMode = COMBINED_VOL.includes(ctx.short) && ctx.settings && ctx.settings.direction === "mute";
    if (isMuteMode) {
      setState(ctx.context, data.muted ? 1 : 0);
    }
  }
}

// --- Refresh display for a context ---
function refreshTitle(ctx) {
  // For push-to-talk, resolve device and show current PTT state
  if (ctx.short === "pushtotalk") {
    const inputName = ctx.settings && ctx.settings.inputName;
    if (!inputName) {
      ctx.resolvedPTTId = null;
      setPTTImage(ctx, false);
      return;
    }
    pipewire.resolveSourceId(inputName, (id) => {
      ctx.resolvedPTTId = id;
      setPTTImage(ctx, ctx.pttActive || false);
    });
    return;
  }

  // For app actions, resolve by stable application.name
  if (ctx.short.startsWith("app")) {
    const appName = ctx.settings && ctx.settings.appName;
    const legacyId = ctx.settings && ctx.settings.app;

    if (!appName && !legacyId) {
      ctx.nodeName = "No App";
      ctx.resolvedAppIds = [];
      updateDisplay(ctx, null);
      return;
    }

    if (appName) {
      pipewire.resolveAppIds(appName, (ids) => {
        ctx.resolvedAppIds = ids;
        if (ids.length === 0) {
          ctx.nodeName = appName;
          updateDisplay(ctx, null);
          return;
        }
        pipewire.getAppName(ids[0], (name) => {
          ctx.nodeName = name || appName;
          pipewire.getVolume(ids[0], (data) => updateDisplay(ctx, data));
        });
      });
    } else {
      // Legacy: use numeric ID directly, auto-migrate to appName
      ctx.resolvedAppIds = [legacyId];
      pipewire.inspectNode(legacyId, (info) => {
        if (info && info.appName) {
          ctx.settings.appName = info.appName;
          send({ event: "setSettings", context: ctx.context, payload: ctx.settings });
        }
        ctx.nodeName = (info && info.appName) || `ID ${legacyId}`;
        pipewire.getVolume(legacyId, (data) => updateDisplay(ctx, data));
      });
    }
    return;
  }

  // For input device actions, resolve by stable node.name
  if (ctx.short.startsWith("input")) {
    const inputName = ctx.settings && ctx.settings.inputName;

    if (!inputName) {
      ctx.nodeName = "No Device";
      ctx.resolvedInputId = null;
      updateDisplay(ctx, null);
      return;
    }

    pipewire.resolveSourceId(inputName, (id) => {
      if (!id) {
        ctx.nodeName = inputName;
        ctx.resolvedInputId = null;
        updateDisplay(ctx, null);
        return;
      }
      ctx.resolvedInputId = id;
      pipewire.getNodeName(id, (name) => {
        ctx.nodeName = name || inputName;
        pipewire.getVolume(id, (data) => updateDisplay(ctx, data));
      });
    });
    return;
  }

  // For switch actions, resolve device and check if it's the current default
  if (ctx.short === "switchoutput" || ctx.short === "switchinput") {
    const isOutput = ctx.short === "switchoutput";
    const deviceName = ctx.settings && (isOutput ? ctx.settings.outputName : ctx.settings.inputName);
    const defaultTarget = isOutput ? "@DEFAULT_AUDIO_SINK@" : "@DEFAULT_AUDIO_SOURCE@";
    const resolveFn = isOutput ? pipewire.resolveNodeId : pipewire.resolveSourceId;

    if (!deviceName) {
      ctx.nodeName = "No Device";
      ctx.isActive = false;
      ctx.resolvedSwitchId = null;
      updateDisplay(ctx, null);
      return;
    }

    resolveFn(deviceName, (id) => {
      ctx.resolvedSwitchId = id;
      // Get display name
      if (id) {
        pipewire.getNodeName(id, (name) => {
          ctx.nodeName = name || deviceName;
          // Check if this device is the current default
          pipewire.inspectNode(defaultTarget, (info) => {
            ctx.isActive = !!(info && info.stableName === deviceName);
            updateDisplay(ctx, null);
          });
        });
      } else {
        ctx.nodeName = deviceName;
        ctx.isActive = false;
        updateDisplay(ctx, null);
      }
    });
    return;
  }

  // For output device actions, resolve by stable node.name
  if (ctx.short.startsWith("output")) {
    const outputName = ctx.settings && ctx.settings.outputName;
    const legacyId = ctx.settings && ctx.settings.output;

    if (!outputName && !legacyId) {
      ctx.nodeName = "No Device";
      ctx.resolvedOutputId = null;
      updateDisplay(ctx, null);
      return;
    }

    if (outputName) {
      pipewire.resolveNodeId(outputName, (id) => {
        if (!id) {
          ctx.nodeName = outputName;
          ctx.resolvedOutputId = null;
          updateDisplay(ctx, null);
          return;
        }
        ctx.resolvedOutputId = id;
        pipewire.getNodeName(id, (name) => {
          ctx.nodeName = name || outputName;
          pipewire.getVolume(id, (data) => updateDisplay(ctx, data));
        });
      });
    } else {
      // Legacy: use numeric ID directly, auto-migrate to node.name
      ctx.resolvedOutputId = legacyId;
      pipewire.inspectNode(legacyId, (info) => {
        if (info && info.stableName) {
          ctx.settings.outputName = info.stableName;
          send({ event: "setSettings", context: ctx.context, payload: ctx.settings });
        }
        ctx.nodeName = (info && info.displayName) || `ID ${legacyId}`;
        pipewire.getVolume(legacyId, (data) => updateDisplay(ctx, data));
      });
    }
    return;
  }

  const target = getTargetForAction(ctx.short);
  if (!target) return;

  // Resolve physical device name then update display
  pipewire.getNodeName(target, (name) => {
    const fallback = target === "@DEFAULT_AUDIO_SINK@" ? "Output" : "Input";
    ctx.nodeName = name || fallback;
    pipewire.getVolume(target, (data) => updateDisplay(ctx, data));
  });
}

function refreshAllTitles() {
  for (const ctx of contexts.values()) {
    refreshTitle(ctx);
  }
}

// --- Shared action callback: refresh display after a short delay ---
function afterAction(context) {
  setTimeout(() => {
    const ctx = contexts.get(context);
    if (ctx) refreshTitle(ctx);
  }, 50);
}

// --- Property inspector tracking ---
const openPIs = new Set();

function pushAppListToOpenPIs() {
  if (openPIs.size === 0) return;
  pipewire.getLists((apps, sinks, sources) => {
    for (const piContext of openPIs) {
      sendToPropertyInspector(piContext, { event: "appList", apps });
      sendToPropertyInspector(piContext, { event: "sinkList", sinks });
      sendToPropertyInspector(piContext, { event: "sourceList", sources });
    }
  });
}

// --- Target resolution ---
function resolveTarget(short, ctx, settings) {
  if (short.startsWith("volume") || short === "mutetoggle") return "@DEFAULT_AUDIO_SINK@";
  if (short.startsWith("mic") || short === "micmute") return "@DEFAULT_AUDIO_SOURCE@";
  if (short.startsWith("app")) return (ctx && ctx.resolvedAppIds && ctx.resolvedAppIds.length > 0) ? ctx.resolvedAppIds : (settings && settings.app ? [settings.app] : []);
  if (short.startsWith("output")) return (ctx && ctx.resolvedOutputId) || (settings && settings.output);
  if (short.startsWith("input")) return (ctx && ctx.resolvedInputId) || (settings && settings.input);
  if (short === "switchoutput" || short === "switchinput") return ctx && ctx.resolvedSwitchId;
  if (short === "pushtotalk") return (ctx && ctx.resolvedPTTId) || null;
  return null;
}

// --- Settings resolution ---
function getSettings(context, payload) {
  return contexts.has(context)
    ? contexts.get(context).settings
    : (payload && payload.settings) || {};
}

// --- Helper: apply action to each ID in a target array ---
function forEachTarget(ids, fn, afterAll) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  let remaining = ids.length;
  ids.forEach((id) => {
    fn(id, () => {
      remaining--;
      if (remaining === 0 && afterAll) afterAll();
    });
  });
}

// --- Key action dispatch ---
function handleKeyDown(action, context, settings) {
  const ctx = contexts.get(context);
  const short = ctx ? ctx.short : action.replace(PREFIX, "");
  const target = resolveTarget(short, ctx, settings);
  const cb = () => afterAction(context);
  const step = (settings && settings.volumeStep) || 5;
  const isApp = short.startsWith("app");

  switch (short) {
    case "volume":
    case "micvolume":
    case "appvolume":
    case "outputvolume":
    case "inputvolume": {
      if (settings && settings.direction === "mute") {
        if (isApp) {
          forEachTarget(target, (id, done) => pipewire.nodeMute(id, done), cb);
        } else {
          pipewire.nodeMute(target, cb);
        }
      } else {
        const dir = (settings && settings.direction === "down") ? "-" : "+";
        const change = `${dir}${step}%`;
        if (isApp) {
          forEachTarget(target, (id, done) => pipewire.nodeVolume(id, change, done), cb);
        } else {
          pipewire.nodeVolume(target, change, cb);
        }
      }
      break;
    }
    case "mutetoggle":
    case "micmute":
    case "appmute":
    case "outputmute":
    case "inputmute":
      if (isApp) {
        forEachTarget(target, (id, done) => pipewire.nodeMute(id, done), cb);
      } else {
        pipewire.nodeMute(target, cb);
      }
      break;
    case "switchoutput":
    case "switchinput":
      pipewire.setDefault(target, cb);
      break;
  }
}

// --- Dial action dispatch ---
function handleDialRotate(action, context, settings, ticks) {
  const ctx = contexts.get(context);
  const short = ctx ? ctx.short : action.replace(PREFIX, "");
  // No-op for switch actions
  if (short === "switchoutput" || short === "switchinput") return;
  const target = resolveTarget(short, ctx, settings);
  const stepBase = (settings && settings.volumeStep) || 5;
  const step = Math.abs(ticks) * stepBase;
  const change = `${ticks > 0 ? "+" : "-"}${step}%`;
  const cb = () => afterAction(context);
  if (short.startsWith("app")) {
    forEachTarget(target, (id, done) => pipewire.nodeVolume(id, change, done), cb);
  } else {
    pipewire.nodeVolume(target, change, cb);
  }
}

function handleDialPress(action, context, settings) {
  const ctx = contexts.get(context);
  const short = ctx ? ctx.short : action.replace(PREFIX, "");
  const target = resolveTarget(short, ctx, settings);
  const cb = () => afterAction(context);
  if (short === "switchoutput" || short === "switchinput") {
    pipewire.setDefault(target, cb);
  } else if (short.startsWith("app")) {
    forEachTarget(target, (id, done) => pipewire.nodeMute(id, done), cb);
  } else {
    pipewire.nodeMute(target, cb);
  }
}

// --- Push-to-talk press/release ---
function handlePTTPress(context) {
  const ctx = contexts.get(context);
  if (!ctx) return;
  ctx.pttActive = true;
  const target = resolveTarget("pushtotalk", ctx, ctx.settings);
  if (target) pipewire.nodeMuteSet(target, false, () => {});
  setPTTImage(ctx, true);
}

function handlePTTRelease(context) {
  const ctx = contexts.get(context);
  if (!ctx) return;
  ctx.pttActive = false;
  const target = resolveTarget("pushtotalk", ctx, ctx.settings);
  if (target) pipewire.nodeMuteSet(target, true, () => {});
  setPTTImage(ctx, false);
}

// --- PipeWire monitor (pactl subscribe) ---
let monitor = null;
let debounceTimer = null;

function startMonitor() {
  monitor = spawn("pactl", ["subscribe"], { stdio: ["ignore", "pipe", "ignore"] });

  monitor.stdout.on("data", () => {
    // Debounce: coalesce rapid events into a single refresh
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      refreshAllTitles();
      pushAppListToOpenPIs();
    }, 100);
  });

  monitor.on("error", (err) => {
    console.error("pactl subscribe failed:", err.message);
  });

  monitor.on("close", (code) => {
    console.log(`pactl subscribe exited with code ${code}`);
    // Restart after a delay if still running
    if (!shuttingDown) {
      setTimeout(startMonitor, 2000);
    }
  });
}

let shuttingDown = false;

function cleanup() {
  shuttingDown = true;
  if (monitor) {
    monitor.kill();
    monitor = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

// --- WebSocket connection ---
const ws = new WebSocket(`ws://localhost:${port}`);

ws.on("open", () => {
  // Register this plugin with OpenDeck
  send({ event: registerEvent, uuid: pluginUUID });
  console.log(`Plugin registered: ${pluginUUID}`);
  startMonitor();
});

ws.on("message", (raw) => {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  const { event, action, context, payload } = msg;

  switch (event) {
    case "willAppear": {
      const settings = (payload && payload.settings) || {};
      const controller = (payload && payload.controller) || "Keypad";
      const { short, iconType } = actionMeta(action);
      contexts.set(context, { action, short, iconType, context, settings, controller });
      refreshTitle(contexts.get(context));
      break;
    }

    case "willDisappear":
      contexts.delete(context);
      lastImageCache.delete(context);
      lastTitleCache.delete(context);
      lastStateCache.delete(context);
      break;

    case "keyDown": {
      const kdCtx = contexts.get(context);
      if (kdCtx && kdCtx.short === "pushtotalk") {
        handlePTTPress(context);
      } else {
        handleKeyDown(action, context, getSettings(context, payload));
      }
      break;
    }

    case "keyUp": {
      const kuCtx = contexts.get(context);
      if (kuCtx && kuCtx.short === "pushtotalk") {
        handlePTTRelease(context);
      }
      break;
    }

    case "didReceiveSettings": {
      const settings = (payload && payload.settings) || {};
      if (contexts.has(context)) {
        contexts.get(context).settings = settings;
        refreshTitle(contexts.get(context));
      }
      break;
    }

    case "dialRotate": {
      if (contexts.has(context)) contexts.get(context).controller = "Encoder";
      const ticks = (payload && payload.ticks) || 0;
      handleDialRotate(action, context, getSettings(context, payload), ticks);
      break;
    }

    case "dialDown":
    case "touchTap": {
      if (contexts.has(context)) contexts.get(context).controller = "Encoder";
      handleDialPress(action, context, getSettings(context, payload));
      break;
    }

    case "propertyInspectorDidAppear":
      openPIs.add(context);
      break;

    case "propertyInspectorDidDisappear":
      openPIs.delete(context);
      break;

    case "sendToPlugin": {
      if (payload && payload.request === "getAppList") {
        pipewire.getAppList((apps) => {
          sendToPropertyInspector(context, { event: "appList", apps });
        });
      }
      if (payload && payload.request === "getSinkList") {
        pipewire.getSinkList((sinks) => {
          sendToPropertyInspector(context, { event: "sinkList", sinks });
        });
      }
      if (payload && payload.request === "getSourceList") {
        pipewire.getSourceList((sources) => {
          sendToPropertyInspector(context, { event: "sourceList", sources });
        });
      }
      break;
    }
  }
});

ws.on("close", () => {
  console.log("WebSocket closed");
  cleanup();
  process.exit(0);
});

ws.on("error", (err) => {
  console.error("WebSocket error:", err.message);
  cleanup();
  process.exit(1);
});

// --- Graceful shutdown ---
process.on("SIGTERM", () => {
  cleanup();
  ws.close();
});

process.on("SIGINT", () => {
  cleanup();
  ws.close();
});
