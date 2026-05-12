const video = document.getElementById("video");
const canvas = document.getElementById("canvas");

const ctx = canvas.getContext("2d", {
  willReadFrequently: true
});

const API = "/api";

let detecting = false;
let saving = false;

let lastFaceTime = 0;

const FACE_COOLDOWN = 10000;

// ---------------- API ----------------
async function api(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      "Content-Type": "application/json"
    },
    credentials: "include"
  });

  // SESSION EXPIRED
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
    return;
  }
}

// ---------------- CAMERA ----------------
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: 1280,
      height: 720
    },
    audio: false
  });

  video.srcObject = stream;

  // FULLSCREEN VIDEO
  const fullscreenVideo =
    document.getElementById("fullscreenVideo");

  if (fullscreenVideo) {
    fullscreenVideo.srcObject = stream;
  }

  return new Promise(resolve => {
    video.onloadedmetadata = () => {
      video.play();

      if (fullscreenVideo) {
        fullscreenVideo.play();
      }

      resolve();
    };
  });
}

// ---------------- LOAD MODELS ----------------
async function loadModels() {
  const MODEL_URL = "/models";

  console.log("Loading models...");

  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);

  await faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL);

  console.log("Models loaded");
}

// ---------------- CAPTURE FACE ----------------
function captureFace(box) {
  const temp = document.createElement("canvas");

  temp.width = box.width;
  temp.height = box.height;

  const tempCtx = temp.getContext("2d");

  tempCtx.drawImage(
    video,
    box.x,
    box.y,
    box.width,
    box.height,
    0,
    0,
    box.width,
    box.height
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

    logs.reverse().forEach(l => {
      const div = document.createElement("div");

      div.className = "log-item";

      div.innerHTML = `
        <div class="visitor-card">

          <img
            src="${l.image}"
            class="visitor-image"
          >

          <div class="visitor-info">
            <div>
              <strong>
                ${l.gender || "Unknown"}
              </strong>
            </div>

            <div>
              Age: ${l.age || "Unknown"}
            </div>

            <div>
              ${l.time}
            </div>
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
async function saveFace(image, age, gender) {
  if (saving) return;

  saving = true;

  try {
    const res = await api("/logs", {
      method: "POST",
      body: JSON.stringify({
        image,
        age,
        gender,
        time: new Date().toLocaleString()
      })
    });

    console.log("SAVE RESPONSE:", res);

    await loadLogs();

  } catch (err) {
    console.error("SAVE ERROR:", err);
  }

  saving = false;
}

// ---------------- DETECT ----------------
async function detect() {
  if (detecting) {
    requestAnimationFrame(detect);
    return;
  }

  detecting = true;

  try {
    if (!video.videoWidth) {
      detecting = false;

      requestAnimationFrame(detect);

      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    const detections = await faceapi
      .detectAllFaces(
        video,
        new faceapi.TinyFaceDetectorOptions({
          inputSize: 416,
          scoreThreshold: 0.5
        })
      )
      .withAgeAndGender();

    for (const detection of detections) {
      const box = detection.detection.box;

      const age = Math.round(detection.age);

      const gender = detection.gender;

      if (
        Date.now() - lastFaceTime >
        FACE_COOLDOWN
      ) {
        lastFaceTime = Date.now();

        const image = captureFace(box);

        await saveFace(
          image,
          age,
          gender
        );
      }
    }

  } catch (err) {
    console.error("DETECTION ERROR:", err);
  }

  detecting = false;

  setTimeout(() => {
    requestAnimationFrame(detect);
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
const modal =
  document.getElementById("fullscreenModal");

document.getElementById("openFullscreen")
.onclick = () => {

  modal.style.display = "flex";
};

document.getElementById("closeFullscreen")
.onclick = () => {

  modal.style.display = "none";
};

// ---------------- INIT ----------------
async function init() {
  await checkAuth();

  await startCamera();

  await loadModels();

  await loadLogs();

  detect();
}

init();