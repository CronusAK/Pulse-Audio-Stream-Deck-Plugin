const { exec } = require("child_process");

function run(cmd, callback) {
  exec(cmd, (err, stdout) => {
    if (err) console.error(`pipewire cmd error: ${cmd}`, err.message);
    if (callback) callback(err, stdout);
  });
}

// Convert "+5%" / "-5%" to wpctl format "5%+" / "5%-"
function toWpctlVol(change) {
  const match = change.match(/^([+-])(.+)$/);
  if (match) return `${match[2]}${match[1]}`;
  return change;
}

// Get volume and mute status for a target (sink/source/node id)
function getVolume(target, callback) {
  exec(`wpctl get-volume ${target}`, (err, stdout) => {
    if (err) return callback(null);

    const volumeMatch = stdout.match(/Volume:\s([0-9.]+)/);
    const muteMatch = stdout.includes("[MUTED]");

    if (!volumeMatch) return callback(null);

    const percent = Math.round(parseFloat(volumeMatch[1]) * 100);
    callback({ percent, muted: muteMatch });
  });
}

// --- Volume and mute control ---
function nodeVolume(id, change, callback) {
  if (!id) return;
  const vol = toWpctlVol(change);
  const limit = change.startsWith("+") ? " -l 1.0" : "";
  run(`wpctl set-volume ${id} ${vol}${limit}`, callback);
}

function nodeMute(id, callback) {
  if (!id) return;
  run(`wpctl set-mute ${id} toggle`, callback);
}

// --- pw-dump based enumeration ---

// Shared helper: parse pw-dump once, extract app streams, sinks, and sources
function parsePwDump(callback) {
  exec("pw-dump", (err, stdout) => {
    if (err) return callback([], [], []);

    try {
      const nodes = JSON.parse(stdout);
      const apps = [];
      const sinks = [];
      const sources = [];

      for (const node of nodes) {
        if (node.type !== "PipeWire:Interface:Node" || !node.info || !node.info.props) continue;
        const props = node.info.props;
        const mediaClass = props["media.class"];

        if (mediaClass === "Stream/Output/Audio") {
          apps.push({
            id: node.id,
            name: props["application.name"] || props["node.name"] || `Node ${node.id}`,
            appName: props["application.name"] || null,
          });
        } else if (mediaClass === "Audio/Sink") {
          sinks.push({
            id: node.id,
            name: props["node.nick"] || props["node.description"] || props["node.name"] || `Node ${node.id}`,
            nodeName: props["node.name"],
          });
        } else if (mediaClass === "Audio/Source") {
          sources.push({
            id: node.id,
            name: props["node.nick"] || props["node.description"] || props["node.name"] || `Node ${node.id}`,
            nodeName: props["node.name"],
          });
        }
      }

      callback(apps, sinks, sources);
    } catch (e) {
      console.error("Failed to parse pw-dump output:", e.message);
      callback([], [], []);
    }
  });
}

function getAppList(callback) {
  parsePwDump((apps) => callback(apps));
}

function getSinkList(callback) {
  parsePwDump((apps, sinks) => callback(sinks));
}

function getSourceList(callback) {
  parsePwDump((apps, sinks, sources) => callback(sources));
}

// Get app, sink, and source lists in one pw-dump call
function getLists(callback) {
  parsePwDump(callback);
}

// Resolve a stable node.name to the current numeric ID (for sinks)
function resolveNodeId(nodeName, callback) {
  parsePwDump((apps, sinks) => {
    const match = sinks.find((s) => s.nodeName === nodeName);
    callback(match ? match.id : null);
  });
}

// Resolve a stable application.name to all current matching node IDs (for app streams)
function resolveAppIds(appName, callback) {
  parsePwDump((apps) => {
    const ids = apps.filter((a) => a.appName === appName).map((a) => a.id);
    callback(ids);
  });
}

// Resolve a stable node.name to the current numeric ID (for sources)
function resolveSourceId(nodeName, callback) {
  parsePwDump((apps, sinks, sources) => {
    const match = sources.find((s) => s.nodeName === nodeName);
    callback(match ? match.id : null);
  });
}

// Set a node as the default device
function setDefault(id, callback) {
  if (!id) return;
  run(`wpctl set-default ${id}`, callback);
}

// --- wpctl inspect based lookups ---

// Inspect a node and extract multiple properties in one call
function inspectNode(target, callback) {
  exec(`wpctl inspect ${target}`, (err, stdout) => {
    if (err) return callback(null);

    const nodeName = stdout.match(/node\.name\s*=\s*"(.+?)"/);
    const nick = stdout.match(/node\.nick\s*=\s*"(.+?)"/);
    const desc = stdout.match(/node\.description\s*=\s*"(.+?)"/);
    const appName = stdout.match(/application\.name\s*=\s*"(.+?)"/);

    callback({
      stableName: nodeName ? nodeName[1] : null,
      displayName: (nick && nick[1]) || (desc && desc[1]) || null,
      appName: (appName && appName[1]) || (nodeName && nodeName[1]) || null,
    });
  });
}

// Get short display name for a physical device (sink/source)
function getNodeName(target, callback) {
  inspectNode(target, (info) => {
    callback(info ? info.displayName : null);
  });
}

// Get application name for a stream node
function getAppName(target, callback) {
  inspectNode(target, (info) => {
    callback(info ? info.appName : null);
  });
}

module.exports = {
  getVolume,
  inspectNode,
  getNodeName,
  getAppName,
  resolveNodeId,
  resolveSourceId,
  resolveAppIds,
  setDefault,
  nodeVolume,
  nodeMute,
  getAppList,
  getSinkList,
  getSourceList,
  getLists,
};
