// Shared Property Inspector boilerplate for OpenDeck plugin
var websocket = null;
var uuid = "";
var actionInfo = {};
var settings = {};

// Initialize the PI WebSocket connection.
// onReady(websocket, actionInfo) is called after registration completes.
// onMessage(msg) is called for each parsed incoming message.
function initPI(onReady, onMessage) {
  // Stream Deck calls this global function to bootstrap the PI
  window.connectElgatoStreamDeckSocket = function (inPort, inPropertyInspectorUUID, inRegisterEvent, inInfo, inActionInfo) {
    uuid = inPropertyInspectorUUID;

    try {
      actionInfo = JSON.parse(inActionInfo);
      settings = actionInfo.payload.settings || {};
    } catch (e) {
      actionInfo = {};
      settings = {};
    }

    loadDisplaySettings();
    loadVolumeStep();

    websocket = new WebSocket("ws://localhost:" + inPort);

    websocket.onopen = function () {
      websocket.send(JSON.stringify({
        event: inRegisterEvent,
        uuid: uuid
      }));
      if (onReady) onReady(websocket, actionInfo);
    };

    websocket.onmessage = function (evt) {
      var msg;
      try {
        msg = JSON.parse(evt.data);
      } catch (e) {
        return;
      }

      if (msg.event === "didReceiveSettings") {
        settings = (msg.payload && msg.payload.settings) || {};
        loadDisplaySettings();
        loadVolumeStep();
      }

      if (onMessage) onMessage(msg);
    };
  };
}

function loadDisplaySettings() {
  var showNameEl = document.getElementById("showName");
  var showPercentEl = document.getElementById("showPercent");
  if (showNameEl) showNameEl.checked = settings.showName !== false;
  if (showPercentEl) showPercentEl.checked = settings.showPercent === true;
}

function saveDisplaySettings() {
  settings.showName = document.getElementById("showName").checked;
  settings.showPercent = document.getElementById("showPercent").checked;
}

function loadVolumeStep() {
  var stepEl = document.getElementById("volumeStep");
  var labelEl = document.getElementById("volumeStepLabel");
  if (stepEl) {
    stepEl.value = settings.volumeStep || 5;
    if (labelEl) labelEl.textContent = (settings.volumeStep || 5) + "%";
  }
}

function saveVolumeStep() {
  var stepEl = document.getElementById("volumeStep");
  if (stepEl) settings.volumeStep = parseInt(stepEl.value, 10);
}

function sendSettings() {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({
      event: "setSettings",
      context: uuid,
      payload: settings
    }));
  }
}
