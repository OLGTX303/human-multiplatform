// HoloVoice.jslib - browser-side microphone capture + WebSocket streaming for
// the WebGL build. Downsamples getUserMedia audio to 16 kHz mono PCM16 and
// streams 80ms chunks; text frames from the server are forwarded to Unity.
mergeInto(LibraryManager.library, {

  HoloVoice_Init: function (urlPtr, goPtr) {
    var url = UTF8ToString(urlPtr);
    var go = UTF8ToString(goPtr);
    window.__holoVoice = { url: url, go: go, ws: null, ctx: null, node: null, stream: null };
  },

  HoloVoice_Start: function () {
    var H = window.__holoVoice;
    if (!H || H.ws) return;

    function send(name, msg) {
      if (typeof SendMessage === 'function') SendMessage(H.go, name, msg);
    }

    H.ws = new WebSocket(H.url);
    H.ws.binaryType = 'arraybuffer';
    H.ws.onmessage = function (e) {
      if (typeof e.data === 'string') send('OnAsrResult', e.data);
    };
    H.ws.onerror = function () { send('OnAsrError', 'websocket error'); };

    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } }).then(function (stream) {
      H.stream = stream;
      H.ctx = new (window.AudioContext || window.webkitAudioContext)();
      var src = H.ctx.createMediaStreamSource(stream);
      // ScriptProcessor is deprecated but universally supported; swap for an
      // AudioWorklet if you target only modern browsers.
      var node = H.ctx.createScriptProcessor(4096, 1, 1);
      H.node = node;
      var inRate = H.ctx.sampleRate, outRate = 16000;

      node.onaudioprocess = function (ev) {
        if (!H.ws || H.ws.readyState !== 1) return;
        var input = ev.inputBuffer.getChannelData(0);
        var ratio = inRate / outRate;
        var outLen = Math.floor(input.length / ratio);
        var pcm = new Int16Array(outLen);
        for (var i = 0; i < outLen; i++) {
          var v = input[Math.floor(i * ratio)];
          v = Math.max(-1, Math.min(1, v));
          pcm[i] = v < 0 ? v * 0x8000 : v * 0x7FFF;
        }
        H.ws.send(pcm.buffer);
      };
      src.connect(node);
      node.connect(H.ctx.destination);
    }).catch(function (err) { send('OnAsrError', 'mic denied: ' + err); });
  },

  HoloVoice_Stop: function () {
    var H = window.__holoVoice;
    if (!H) return;
    if (H.node) { H.node.disconnect(); H.node = null; }
    if (H.ctx) { H.ctx.close(); H.ctx = null; }
    if (H.stream) { H.stream.getTracks().forEach(function (t) { t.stop(); }); H.stream = null; }
    if (H.ws) { H.ws.close(); H.ws = null; }
  }
});
