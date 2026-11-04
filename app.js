const video = document.getElementById("video");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const manualButton = document.getElementById("manualButton");
const resetButton = document.getElementById("resetButton");

const statusEl = document.getElementById("status");
const cameraState = document.getElementById("cameraState");
const cameraMessage = document.getElementById("cameraMessage");
const motionStatus = document.getElementById("motionStatus");

const stops = ["STOP1", "STOP2", "STOP3", "STOP4"];

let stream = null;
let scanTimer = null;
let motionEnabled = false;
let motionEvents = 0;
let previousAcceleration = null;
let lastMovementTime = Date.now();

let candidateCode = null;
let candidateSince = 0;
let currentCode = null;
let capturing = false;
let lastCompleted = null;

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const scanCanvas = document.createElement("canvas");
const scanCtx = scanCanvas.getContext("2d", {
  willReadFrequently: true
});

const DB_NAME = "VEXTrackTracker";
const STORE_NAME = "photos";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "code" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function savePhoto(record) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function getPhotos() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME)
      .objectStore(STORE_NAME).getAll();

    request.onsuccess = () => {
      db.close();
      resolve(request.result || []);
    };

    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

async function clearPhotos() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

function setStatus(message) {
  statusEl.textContent = message;
}

function updateProgress(completed) {
  const count = completed.length;

  document.getElementById("progressText").textContent =
    `${count} / 4`;

  document.getElementById("progressBar").style.width =
    `${count * 25}%`;

  document.getElementById("lastStop").textContent =
    count ? `Stop ${count}` : "None";

  document.getElementById("nextStop").textContent =
    count < 4 ? `Stop ${count + 1}` : "Complete";
}

function isStationary() {
  if (!motionEnabled || motionEvents < 5) return false;
  return Date.now() - lastMovementTime > 1400;
}

function onMotion(event) {
  const a = event.acceleration;
  const g = event.accelerationIncludingGravity;

  let current;

  if (a && a.x !== null && a.y !== null && a.z !== null) {
    current = [a.x, a.y, a.z];
  } else if (g && g.x !== null && g.y !== null && g.z !== null) {
    current = [g.x, g.y, g.z];
  } else {
    return;
  }

  motionEvents++;

  if (previousAcceleration) {
    const difference = Math.sqrt(
      current.reduce((sum, value, index) => {
        return sum + Math.pow(value - previousAcceleration[index], 2);
      }, 0)
    );

    const threshold =
      a && a.x !== null ? 0.45 : 0.85;

    if (difference > threshold) {
      lastMovementTime = Date.now();
    }
  }

  previousAcceleration = current;

  motionStatus.textContent = isStationary()
    ? "Car appears stationary."
    : "Movement detected or waiting for a stable reading.";
}

async function enableMotion() {
  try {
    if (typeof DeviceMotionEvent === "undefined") {
      motionEnabled = false;
      motionStatus.textContent =
        "Motion sensor unavailable. Use manual capture.";
      return;
    }

    if (typeof DeviceMotionEvent.requestPermission === "function") {
      const permission = await DeviceMotionEvent.requestPermission();

      if (permission !== "granted") {
        motionEnabled = false;
        motionStatus.textContent =
          "Motion permission denied. Use manual capture.";
        return;
      }
    }

    window.addEventListener("devicemotion", onMotion, true);
    motionEnabled = true;
    lastMovementTime = Date.now();

    motionStatus.textContent =
      "Motion sensor enabled. Waiting for readings.";
  } catch (error) {
    motionEnabled = false;
    motionStatus.textContent =
      "Motion detection unavailable. Use manual capture.";
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert("Camera access requires HTTPS and a supported browser.");
    return;
  }

  if (typeof jsQR !== "function") {
    alert("QR scanner library did not load. Connect to the internet and reload.");
    return;
  }

  try {
    await enableMotion();

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });

    video.srcObject = stream;
    await video.play();

    startButton.disabled = true;
    stopButton.disabled = false;

    cameraState.textContent = "Camera running";
    cameraMessage.textContent = "Searching for STOP1–STOP4";
    document.getElementById("connection").textContent = "SCANNING";

    setStatus("Camera running — searching for QR codes.");

    scanTimer = setInterval(scanFrame, 180);
  } catch (error) {
    console.error(error);
    alert("Could not start camera. Check camera permissions in iPhone Settings.");
    stopCamera();
  }
}

function stopCamera() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }

  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  video.srcObject = null;

  startButton.disabled = false;
  stopButton.disabled = true;

  cameraState.textContent = "Camera off";
  cameraMessage.textContent = "Press START CAMERA to begin";
  document.getElementById("connection").textContent = "READY";

  window.removeEventListener("devicemotion", onMotion, true);
  motionEnabled = false;
}

function scanFrame() {
  if (!video.videoWidth || !video.videoHeight) return;

  const scale = Math.min(1, 800 / video.videoWidth);
  scanCanvas.width = Math.round(video.videoWidth * scale);
  scanCanvas.height = Math.round(video.videoHeight * scale);

  scanCtx.drawImage(
    video, 0, 0, scanCanvas.width, scanCanvas.height
  );

  const image = scanCtx.getImageData(
    0, 0, scanCanvas.width, scanCanvas.height
  );

  const result = jsQR(
    image.data,
    image.width,
    image.height,
    { inversionAttempts: "dontInvert" }
  );

  if (!result || !stops.includes(result.data)) {
    candidateCode = null;
    candidateSince = 0;
    currentCode = null;
    manualButton.disabled = true;

    cameraMessage.textContent = "Searching for QR code";

    if (lastCompleted) {
      const next = stops.indexOf(lastCompleted) + 1;
      setStatus(
        next < 4
          ? `Traveling after Stop ${next} — next: Stop ${next + 1}`
          : "All four stops completed!"
      );
    }

    return;
  }

  currentCode = result.data;
  manualButton.disabled = false;

  if (candidateCode !== result.data) {
    candidateCode = result.data;
    candidateSince = Date.now();
  }

  const stopNumber = stops.indexOf(result.data) + 1;

  cameraMessage.textContent = `QR CODE DETECTED: STOP ${stopNumber}`;

  if (savedCodes.has(result.data)) {
    setStatus(`Stop ${stopNumber} already captured.`);
    return;
  }

  if (capturing) return;

  setStatus(
    isStationary()
      ? `Stop ${stopNumber} detected — preparing photo.`
      : `Stop ${stopNumber} detected — waiting for car to stop.`
  );

  const qrHeldLongEnough = Date.now() - candidateSince > 700;

  if (qrHeldLongEnough && isStationary()) {
    captureStop(result.data);
  }
}

const savedCodes = new Set();

async function captureStop(code) {
  if (capturing || savedCodes.has(code)) return;
  if (!video.videoWidth || !video.videoHeight) return;

  capturing = true;

  try {
    // Capture the actual camera image, not a screen screenshot.
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });

    if (!blob) throw new Error("Could not create photo.");

    const record = {
      code,
      timestamp: new Date().toISOString(),
      image: blob
    };

    await savePhoto(record);
    savedCodes.add(code);
    lastCompleted = code;

    await renderGallery();

    const number = stops.indexOf(code) + 1;

    cameraMessage.textContent = `STOP ${number} PHOTO SAVED`;
    setStatus(`Stop ${number} photo successfully saved.`);

    if (savedCodes.size === 4) {
      setStatus("All four stops completed!");
    }
  } catch (error) {
    console.error(error);
    setStatus("Photo save failed. Try manual capture again.");
  } finally {
    capturing = false;
  }
}

manualButton.addEventListener("click", () => {
  if (currentCode && !savedCodes.has(currentCode)) {
    captureStop(currentCode);
  }
});

async function renderGallery() {
  const photos = await getPhotos();

  savedCodes.clear();

  photos.forEach(record => {
    savedCodes.add(record.code);
  });

  for (const code of stops) {
    const record = photos.find(photo => photo.code === code);
    const photoElement = document.getElementById(`photo-${code}`);
    const timeElement = document.getElementById(`time-${code}`);
    const downloadElement =
      document.getElementById(`download-${code}`);

    if (!record) {
      photoElement.textContent = String(stops.indexOf(code) + 1);
      timeElement.textContent = "Not captured";
      downloadElement.hidden = true;
      downloadElement.removeAttribute("href");
      continue;
    }

    const imageUrl = URL.createObjectURL(record.image);

    photoElement.replaceChildren();

    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = `${code} captured QR code`;
    photoElement.appendChild(image);

    timeElement.textContent =
      new Date(record.timestamp).toLocaleString();

    downloadElement.href = imageUrl;
    downloadElement.hidden = false;
  }

  updateProgress(photos.sort(
    (a, b) => stops.indexOf(a.code) - stops.indexOf(b.code)
  ));
}

async function resetSession() {
  const confirmed = confirm(
    "Delete all four saved pictures and reset the track session?"
  );

  if (!confirmed) return;

  await clearPhotos();

  savedCodes.clear();
  lastCompleted = null;
  candidateCode = null;
  candidateSince = 0;
  currentCode = null;

  await renderGallery();

  setStatus("Session reset. Ready for a new run.");
  cameraMessage.textContent = "Searching for QR codes";
}

startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);
resetButton.addEventListener("click", resetSession);

window.addEventListener("pagehide", stopCamera);

async function initialize() {
  try {
    await renderGallery();

    if ("serviceWorker" in navigator) {
      await navigator.serviceWorker.register("./service-worker.js");
    }
  } catch (error) {
    console.error(error);
    setStatus("App loaded, but local storage initialization failed.");
  }
}

initialize();