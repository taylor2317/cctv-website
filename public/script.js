const cameraGrid = document.getElementById("cameraGrid");
const fullscreenVideo = document.getElementById("fullscreenVideo");
const fullscreenModal = document.getElementById("fullscreenModal");
const fullscreenTitle = document.getElementById("fullscreenTitle");
const fullscreenStatus = document.getElementById("fullscreenStatus");
const fullscreenSettingsBtn = document.getElementById("fullscreenSettingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const cameraNameInput = document.getElementById("cameraNameInput");
const renameCameraBtn = document.getElementById("renameCameraBtn");
const toggleEnabledBtn = document.getElementById("toggleEnabledBtn");
const toggleFlipHBtn = document.getElementById("toggleFlipHBtn");
const toggleFlipVBtn = document.getElementById("toggleFlipVBtn");
const API = "/api";

const FACE_COOLDOWN = 10000;
const cameras = [];

let activeCamera = null;

// ---------------- API ----------------
async function api(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      "Content-Type": "application/json"
    },
    credentials: "include"
  });

  if (res.status === 401) {
    window.location.href = "/";
    return;
  }

  return res.json();
}

// ---------------- CHECK AUTH ----------------
async function checkAuth() {
  const res = await api("/me");

  if (!res || !res.user) {
    window.location.href = "/";
  }
}

// ---------------- LOAD MODELS ----------------
async function loadModels() {
  const MODEL_URL = "/models";

  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  await faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL);
}

// ---------------- CAMERA UI ----------------
function createCameraCard(camera) {
  const card = document.createElement("article");
  card.className = "camera-card";

  const preview = document.createElement("button");
  preview.className = "camera-preview";
  preview.type = "button";
  preview.setAttribute("aria-label", `Open ${camera.label}`);

  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;

  const canvas = document.createElement("canvas");

  const name = document.createElement("div");
  name.className = "camera-name";
  name.textContent = camera.label;

  const status = document.createElement("div");
  status.className = "camera-status";
  status.textContent = "Connecting";

  preview.append(video, canvas);
  card.append(preview, name, status);
  cameraGrid.appendChild(card);

  camera.card = card;
  camera.preview = preview;
  camera.video = video;
  camera.canvas = canvas;
  camera.ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });
  camera.status = status;

  preview.onclick = () => openFullscreen(camera);
}

function setCameraStatus(camera, status) {
  camera.status.textContent = status;
  camera.card.dataset.status = status.toLowerCase();
}

function applyCameraFlip(camera) {
  const scaleX = camera.flipH ? -1 : 1;
  const scaleY = camera.flipV ? -1 : 1;
  const transform = `scale(${scaleX}, ${scaleY})`;

  if (camera.video) camera.video.style.transform = transform;
  if (camera.canvas) camera.canvas.style.transform = transform;

  if (activeCamera === camera && fullscreenVideo) {
    fullscreenVideo.style.transform = transform;
  }
}

function setCameraEnabled(camera, enabled) {
  camera.enabled = enabled;

  if (camera.stream) {
    camera.stream.getVideoTracks().forEach(track => {
      track.enabled = enabled;
    });
  }

  if (enabled) {
    camera.video.play().catch(() => {});
    setCameraStatus(camera, "Live");
  } else {
    camera.video.pause();
    setCameraStatus(camera, "Disabled");
  }
}

function renameCamera(camera, newLabel) {
  camera.label = newLabel || camera.label;
  camera.name.textContent = camera.label;

  if (activeCamera === camera) {
    fullscreenTitle.textContent = camera.label;
  }
}

function updateSettingsState(camera) {
  if (!camera) return;

  toggleEnabledBtn.textContent = camera.enabled
    ? "Disable Camera"
    : "Enable Camera";

  toggleFlipHBtn.textContent = camera.flipH
    ? "Unflip Horizontal"
    : "Flip Horizontal";

  toggleFlipVBtn.textContent = camera.flipV
    ? "Unflip Vertical"
    : "Flip Vertical";

  fullscreenStatus.textContent = camera.status.textContent;
}

function toggleSettingsPanel() {
  settingsPanel.classList.toggle("open");
}

function openFullscreen(camera) {
  cameraGrid.innerHTML = "";

  const empty = document.createElement("div");
  empty.className = "camera-empty";
  empty.textContent = message;

  cameraGrid.appendChild(empty);
}

function openFullscreen(camera) {
  activeCamera = camera;
  fullscreenTitle.textContent = camera.label;
  cameraNameInput.value = camera.label;
  fullscreenStatus.textContent = camera.status.textContent;

  fullscreenVideo.srcObject = camera.stream;
  fullscreenVideo.style.transform = "";
  applyCameraFlip(camera);

  settingsPanel.classList.remove("open");
  updateSettingsState(camera);

  fullscreenVideo.play().catch(() => {});
  fullscreenModal.style.display = "flex";
}

// ---------------- CAMERA STARTUP ----------------
async function getCameraDevices() {
  let permissionStream = null;

  try {
    permissionStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false
    });
  } finally {
    if (permissionStream) {
      permissionStream.getTracks().forEach(track => track.stop());
    }
  }

  const devices = await navigator.mediaDevices.enumerateDevices();

  return devices.filter(device => device.kind === "videoinput");
}

async function startCamera(device, index) {
  const camera = {
    id: device.deviceId || `camera-${index + 1}`,
    label: device.label || `Camera ${index + 1}`,
    lastFaceTime: 0,
    detecting: false,
    saving: false,
    enabled: true,
    flipH: false,
    flipV: false
  };

  createCameraCard(camera);
  cameras.push(camera);

  try {
    camera.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: device.deviceId
          ? { exact: device.deviceId }
          : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    camera.video.srcObject = camera.stream;

    await new Promise(resolve => {
      camera.video.onloadedmetadata = resolve;
    });

    await camera.video.play();
    setCameraStatus(camera, "Live");
    detect(camera);
  } catch (err) {
    console.error("CAMERA ERROR:", err);
    setCameraStatus(camera, "Unavailable");
  }
}

async function startCameras() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCameraMessage("Camera access is not available in this browser.");
    return;
  }

  try {
    const devices = await getCameraDevices();

    if (!devices.length) {
      showCameraMessage("No cameras found.");
      return;
    }

    await Promise.all(
      devices.map((device, index) => startCamera(device, index))
    );
  } catch (err) {
    console.error("CAMERA START ERROR:", err);
    showCameraMessage("Camera permission is needed to start monitoring.");
  }
}

// ---------------- CAPTURE FACE ----------------
function captureFace(camera, box) {
  const temp = document.createElement("canvas");
  const width = Math.max(1, Math.round(box.width));
  const height = Math.max(1, Math.round(box.height));

  temp.width = width;
  temp.height = height;

  temp.getContext("2d").drawImage(
    camera.video,
    box.x,
    box.y,
    box.width,
    box.height,
    0,
    0,
    width,
    height
  );

  return temp.toDataURL("image/jpeg");
}

// ---------------- LOAD LOGS ----------------
async function loadLogs() {
  try {
    const response = await api("/logs");
    const logs = Array.isArray(response)
      ? response
      : response.logs || [];
    const log = document.getElementById("log");

    log.innerHTML = "";

    logs.forEach(l => {
      const div = document.createElement("div");

      div.className = "log-item";
      div.innerHTML = `
        <div class="visitor-card">
          <img src="${l.image}" class="visitor-image" alt="">

          <div class="visitor-info">
            <div>
              <strong>${l.gender || "Unknown"}</strong>
            </div>

            <div>Age: ${l.age || "Unknown"}</div>
            <div>Camera: ${l.camera || "Camera 1"}</div>
            <div>${l.time}</div>
          </div>
        </div>
      `;

      log.appendChild(div);
    });
  } catch (err) {
    console.error("LOAD LOG ERROR:", err);
  }
}

// ---------------- SAVE FACE ----------------
async function saveFace(camera, image, age, gender) {
  if (camera.saving) {
    return;
  }

  camera.saving = true;

  try {
    await api("/logs", {
      method: "POST",
      body: JSON.stringify({
        image,
        age,
        gender,
        camera: camera.label,
        time: new Date().toLocaleString()
      })
    });

    await loadLogs();
  } catch (err) {
    console.error("SAVE ERROR:", err);
  }

  camera.saving = false;
}

// ---------------- DETECT ----------------
async function detect(camera) {
  if (camera.detecting) {
    requestAnimationFrame(() => detect(camera));
    return;
  }

  camera.detecting = true;

  try {
    if (!camera.video.videoWidth || !camera.enabled) {
      camera.detecting = false;
      setTimeout(() => {
        requestAnimationFrame(() => detect(camera));
      }, 250);
      return;
    }

    camera.canvas.width = camera.video.videoWidth;
    camera.canvas.height = camera.video.videoHeight;
    camera.ctx.clearRect(
      0,
      0,
      camera.canvas.width,
      camera.canvas.height
    );

    const detections = await faceapi
      .detectAllFaces(
        camera.video,
        new faceapi.TinyFaceDetectorOptions({
          inputSize: 416,
          scoreThreshold: 0.5
        })
      )
      .withAgeAndGender();

    detections.forEach(detection => {
      const box = detection.detection.box;

      camera.ctx.strokeStyle = "#61e2ff";
      camera.ctx.lineWidth = 3;
      camera.ctx.strokeRect(
        box.x,
        box.y,
        box.width,
        box.height
      );
    });

    if (
      detections.length &&
      Date.now() - camera.lastFaceTime > FACE_COOLDOWN
    ) {
      const detection = detections[0];
      const image = captureFace(
        camera,
        detection.detection.box
      );

      camera.lastFaceTime = Date.now();

      await saveFace(
        camera,
        image,
        Math.round(detection.age),
        detection.gender
      );
    }
  } catch (err) {
    console.error("DETECTION ERROR:", err);
  }

  camera.detecting = false;

  setTimeout(() => {
    requestAnimationFrame(() => detect(camera));
  }, 250);
}

// ---------------- CLEAR ----------------
document.getElementById("clearBtn").onclick =
async () => {
  await api("/clear", {
    method: "DELETE"
  });

  await loadLogs();
};

// ---------------- EXPORT ----------------
document.getElementById("exportBtn").onclick =
async () => {
  const response = await api("/logs");
  const logs = Array.isArray(response)
    ? response
    : response.logs || [];
  const blob = new Blob(
    [JSON.stringify(logs, null, 2)],
    {
      type: "application/json"
    }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "logs.json";
  a.click();

  URL.revokeObjectURL(url);
};

// ---------------- LOGOUT ----------------
document.getElementById("logoutBtn").onclick =
async () => {
  await api("/logout", {
    method: "POST"
  });

  window.location.href = "/";
};

// ---------------- FULLSCREEN ----------------
const modal = document.getElementById("fullscreenModal");

document.getElementById("closeFullscreen").onclick = () => {
  fullscreenVideo.pause();
  fullscreenVideo.srcObject = null;
  modal.style.display = "none";
};

fullscreenSettingsBtn.onclick = () => {
  toggleSettingsPanel();
};

renameCameraBtn.onclick = () => {
  if (!activeCamera) return;
  renameCamera(activeCamera, cameraNameInput.value.trim() || activeCamera.label);
};

toggleEnabledBtn.onclick = () => {
  if (!activeCamera) return;
  setCameraEnabled(activeCamera, !activeCamera.enabled);
  updateSettingsState(activeCamera);
};

toggleFlipHBtn.onclick = () => {
  if (!activeCamera) return;
  activeCamera.flipH = !activeCamera.flipH;
  applyCameraFlip(activeCamera);
  updateSettingsState(activeCamera);
};

toggleFlipVBtn.onclick = () => {
  if (!activeCamera) return;
  activeCamera.flipV = !activeCamera.flipV;
  applyCameraFlip(activeCamera);
  updateSettingsState(activeCamera);
};

// ---------------- INIT ----------------
async function init() {
  await checkAuth();
  await loadModels();
  await startCameras();
  await loadLogs();
}

init();

// Particles
const particlesContainer = document.querySelector(".particles");

for (let i = 0; i < 30; i++) {
  const particle = document.createElement("span");
  particle.style.left = Math.random() * 100 + "%";
  particle.style.animationDelay = Math.random() * 20 + "s";
  particle.style.animationDuration = (15 + Math.random() * 10) + "s";
  particlesContainer.appendChild(particle);
}

// Parallax
if (window.innerWidth > 768) {
  document.addEventListener("mousemove", e => {
    const x = (e.clientX / window.innerWidth - 0.5) * 10;
    const y = (e.clientY / window.innerHeight - 0.5) * 10;

    document.body.style.setProperty("--parallax-x", x);
    document.body.style.setProperty("--parallax-y", y);
  });
}
