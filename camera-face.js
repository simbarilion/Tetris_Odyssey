(function () {
  const UNAVAILABLE = "Камера недоступна, используйте кнопки.";
  const FACE_MESH_VERSION = "0.4.1633559619";
  const FACE_MESH_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@" + FACE_MESH_VERSION + "/";

  const LEFT_EYE = 33;
  const RIGHT_EYE = 263;
  const NOSE = 1;

  const ROLL_ENTER = 0.12;
  const ROLL_EXIT = 0.07;
  const MOVE_REPEAT_MS = 240;
  const NOD_DOWN = 0.028;
  const NOD_RESET = 0.012;
  const NOD_COOLDOWN_MS = 700;

  const statusEl = document.getElementById("cameraStatus");
  const videoEl = document.getElementById("cameraFeed");

  let faceMesh = null;
  let sending = false;
  let tiltDir = 0;
  let nextMoveAt = 0;
  let nodArmed = true;
  let lastNodAt = 0;
  let pitchEma = null;

  function setUnavailable() {
    if (!statusEl) return;
    statusEl.textContent = UNAVAILABLE;
    statusEl.classList.add("is-off");
    statusEl.classList.remove("is-hidden");
  }

  function hideStatus() {
    if (!statusEl) return;
    statusEl.classList.add("is-hidden");
  }

  function cameraBlocked() {
    return !window.isSecureContext || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function";
  }

  function game() {
    return window.TetrisOdyssey;
  }

  function playing() {
    const api = game();
    return api && typeof api.isPlaying === "function" && api.isPlaying();
  }

  function rollFrom(landmarks) {
    const left = landmarks[LEFT_EYE];
    const right = landmarks[RIGHT_EYE];
    if (!left || !right) return 0;
    const lx = 1 - left.x;
    const rx = 1 - right.x;
    return Math.atan2(right.y - left.y, rx - lx);
  }

  function pitchFrom(landmarks) {
    const left = landmarks[LEFT_EYE];
    const right = landmarks[RIGHT_EYE];
    const nose = landmarks[NOSE];
    if (!left || !right || !nose) return 0;
    return nose.y - (left.y + right.y) / 2;
  }

  function applyTilt(roll, now) {
    const api = game();
    if (!playing() || !api) {
      tiltDir = 0;
      return;
    }

    let dir = tiltDir;
    if (roll > ROLL_ENTER) dir = 1;
    else if (roll < -ROLL_ENTER) dir = -1;
    else if (Math.abs(roll) < ROLL_EXIT) dir = 0;

    if (dir !== tiltDir) {
      tiltDir = dir;
      if (!tiltDir) return;
      if (tiltDir < 0) api.moveLeft();
      else api.moveRight();
      nextMoveAt = now + MOVE_REPEAT_MS;
      return;
    }
    if (!tiltDir || now < nextMoveAt) return;
    if (tiltDir < 0) api.moveLeft();
    else api.moveRight();
    nextMoveAt = now + MOVE_REPEAT_MS;
  }

  function applyNod(pitch, now) {
    const api = game();
    if (pitchEma == null) pitchEma = pitch;
    else pitchEma = pitchEma * 0.9 + pitch * 0.1;

    if (!playing() || !api) {
      nodArmed = true;
      return;
    }
    if (now - lastNodAt < NOD_COOLDOWN_MS) return;

    const delta = pitch - pitchEma;
    if (!nodArmed && delta < NOD_RESET) nodArmed = true;
    if (nodArmed && delta > NOD_DOWN) {
      api.rotate();
      nodArmed = false;
      lastNodAt = now;
    }
  }

  function onLandmarks(landmarks) {
    const now = performance.now();
    applyTilt(rollFrom(landmarks), now);
    applyNod(pitchFrom(landmarks), now);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error("script " + src)); };
      document.head.appendChild(script);
    });
  }

  function loop() {
    if (!faceMesh || !videoEl || videoEl.readyState < 2 || document.hidden) {
      requestAnimationFrame(loop);
      return;
    }
    if (sending) {
      requestAnimationFrame(loop);
      return;
    }
    sending = true;
    faceMesh.send({ image: videoEl }).catch(function () {
      return null;
    }).then(function () {
      sending = false;
      requestAnimationFrame(loop);
    });
  }

  async function startCamera() {
    setUnavailable();
    if (cameraBlocked()) return;
    if (!videoEl) return;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user" }
      });
    } catch (err) {
      return;
    }

    videoEl.srcObject = stream;
    videoEl.setAttribute("playsinline", "true");
    try {
      await videoEl.play();
    } catch (err) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      return;
    }

    try {
      await loadScript(FACE_MESH_CDN + "face_mesh.js");
      if (typeof FaceMesh !== "function") throw new Error("FaceMesh missing");
      faceMesh = new FaceMesh({
        locateFile: function (file) { return FACE_MESH_CDN + file; }
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      faceMesh.onResults(function (results) {
        const face = results.multiFaceLandmarks && results.multiFaceLandmarks[0];
        if (face) onLandmarks(face);
        else tiltDir = 0;
      });
    } catch (err) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      return;
    }

    hideStatus();
    requestAnimationFrame(loop);
  }

  startCamera();
})();
