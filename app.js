
const video = document.getElementById("video");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const manualButton = document.getElementById("manualButton");
const resetButton = document.getElementById("resetButton");

const cameraState = document.getElementById("cameraState");
const cameraMessage = document.getElementById("cameraMessage");
const statusText = document.getElementById("status");
const connection = document.getElementById("connection");

const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");
const lastStopText = document.getElementById("lastStop");
const nextStopText = document.getElementById("nextStop");

const trackCar = document.getElementById("trackCar");
const trackPosition = document.getElementById("trackPosition");
const gallery = document.getElementById("gallery");

const stops = ["STOP1", "STOP2", "STOP3", "STOP4"];

let stream = null;
let scanTimer = null;
let scanning = false;
let lastDetectedCode = "";
let detectionStartTime = 0;
let captureInProgress = false;

const canvas = document.createElement("canvas");
const context = canvas.getContext("2d", {
  willReadFrequently: true
});

const DB_NAME = "VEXTrackTracker";
const STORE_NAME = "photos";

let database;

// Open IndexedDB
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = function () {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: "code"
        });
      }
    };

    request.onsuccess = function () {
      database = request.result;
      resolve(database);
    };

    request.onerror = function () {
      reject(request.error);
    };
  });
}

// Save a photo and timestamp
function savePhoto(code, blob) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      STORE_NAME,
      "readwrite"
    );

    const store = transaction.objectStore(STORE_NAME);

    const record = {
      code: code,
      photo: blob,
      timestamp: new Date().toISOString()
    };

    const request = store.put(record);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Get all saved stops
function getAllPhotos() {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      STORE_NAME,
      "readonly"
    );

    const request = transaction
      .objectStore(STORE_NAME)
      .getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Delete all saved stops
function clearPhotos() {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      STORE_NAME,
      "readwrite"
    );

    const request = transaction
      .objectStore(STORE_NAME)
      .clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Start camera
async function startCamera() {
  try {
    if (!navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia) {
      throw new Error(
        "Camera access requires HTTPS or localhost."
      );
    }

    if (stream) {
      stopCamera();
    }

    cameraMessage.textContent = "Requesting camera permission...";
    statusText.textContent = "Starting camera...";

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: {
          ideal: "environment"
        },
        width: {
          ideal: 1280
        },
        height: {
          ideal: 720
        }
      }
    });

    video.srcObject = stream;
    video.setAttribute("playsinline", "");
    video.muted = true;

    await video.play();

    scanning = true;

    cameraState.textContent = "Camera is running.";
    cameraMessage.textContent =
      "Point the camera toward the QR codes.";

    connection.textContent = "Camera connected";
    statusText.textContent = "Scanning for STOP1 through STOP4...";

    if (scanTimer) {
      clearInterval(scanTimer);
    }

    scanTimer = setInterval(scanFrame, 150);

  } catch (error) {
    console.error("Camera error:", error);

    cameraState.textContent = "Camera could not start.";
    cameraMessage.textContent = error.message;
    statusText.textContent = "Camera error.";
  }
}

// Stop camera
function stopCamera() {
  scanning = false;

  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }

  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  video.srcObject = null;

  cameraState.textContent = "Camera is stopped.";
  cameraMessage.textContent = "Press Start Camera to scan again.";
  connection.textContent = "Camera disconnected";
}

// Scan camera frames for QR codes
function scanFrame() {
  if (!scanning ||
      video.readyState !== video.HAVE_ENOUGH_DATA ||
      video.videoWidth === 0) {
    return;
  }

  if (typeof jsQR !== "function") {
    statusText.textContent = "QR scanning library did not load.";
    return;
  }

  const scale = Math.min(
    1,
    1280 / video.videoWidth
  );

  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);

  context.drawImage(
    video,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const imageData = context.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  );

  const result = jsQR(
    imageData.data,
    imageData.width,
    imageData.height,
    {
      inversionAttempts: "attemptBoth"
    }
  );

  if (!result || !result.data) {
    lastDetectedCode = "";
    detectionStartTime = 0;
    return;
  }

  const detectedCode = result.data
    .trim()
    .toUpperCase()
    .replace(/\s/g, "");

  if (!stops.includes(detectedCode)) {
    statusText.textContent =
      "QR detected, but it is not a valid stop: " + detectedCode;
    lastDetectedCode = "";
    detectionStartTime = 0;
    return;
  }

  statusText.textContent = "Detected " + detectedCode;

  const now = Date.now();

  if (detectedCode !== lastDetectedCode) {
    lastDetectedCode = detectedCode;
    detectionStartTime = now;
    return;
  }

  // Require the same code in consecutive scans for 250 ms.
  // The car does NOT have to be stationary.
  if (now - detectionStartTime >= 250) {
    captureStop(detectedCode);
  }
}

// Capture a picture
async function captureStop(code) {
  if (captureInProgress || !database) {
    return;
  }

  if (!video.videoWidth || !video.videoHeight) {
    statusText.textContent = "Camera is not ready for a photo.";
    return;
  }

  captureInProgress = true;

  try {
    statusText.textContent = "Capturing " + code + "...";

    const photoCanvas = document.createElement("canvas");
    photoCanvas.width = video.videoWidth;
    photoCanvas.height = video.videoHeight;

    const photoContext = photoCanvas.getContext("2d");

    photoContext.drawImage(
      video,
      0,
      0,
      photoCanvas.width,
      photoCanvas.height
    );

    const blob = await new Promise(resolve => {
      photoCanvas.toBlob(
        resolve,
        "image/jpeg",
        0.9
      );
    });

    if (!blob) {
      throw new Error("Could not create photo.");
    }

    await savePhoto(code, blob);

    statusText.textContent =
      code + " photo captured and saved!";

    lastDetectedCode = "";
    detectionStartTime = 0;

    await renderGallery();

  } catch (error) {
    console.error("Capture error:", error);
    statusText.textContent =
      "Could not save photo: " + error.message;

  } finally {
    captureInProgress = false;
  }
}

// Manual capture of the next missing stop
async function manualCapture() {
  const records = await getAllPhotos();
  const savedCodes = records.map(record => record.code);

  const nextCode = stops.find(code =>
    !savedCodes.includes(code)
  );

  if (!nextCode) {
    statusText.textContent = "All four stops are already saved.";
    return;
  }

  await captureStop(nextCode);
}

// Update car location on track
function updateTrackPosition(code) {
  const positions = {
    STOP1: { x: 105, y: 35 },
    STOP2: { x: 235, y: 35 },
    STOP3: { x: 235, y: 215 },
    STOP4: { x: 105, y: 215 }
  };

  const position = positions[code];

  if (!position) {
    return;
  }

  trackCar.setAttribute(
    "transform",
    `translate(${position.x} ${position.y})`
  );

  trackPosition.textContent = "Car position: " + code;

  stops.forEach(stop => {
    const marker = document.getElementById("marker-" + stop);
    marker.classList.toggle("visited", stop === code);
  });
}

// Update the track and progress using saved records
async function renderGallery() {
  const records = await getAllPhotos();

  records.sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  );

  gallery.innerHTML = "";

  const savedCodes = records.map(record => record.code);

  const completed = stops.filter(code =>
    savedCodes.includes(code)
  );

  progressText.textContent =
    completed.length + " of 4 stops completed";

  progressBar.style.width =
    (completed.length / 4 * 100) + "%";

  lastStopText.textContent =
    records.length
      ? records[records.length - 1].code
      : "None";

  const nextStop = stops.find(code =>
    !savedCodes.includes(code)
  );

  nextStopText.textContent = nextStop || "All stops completed";

  // Display the most recently saved stop on the track.
  if (records.length > 0) {
    const latest = records[records.length - 1];
    updateTrackPosition(latest.code);
  } else {
    trackPosition.textContent =
      "Car position: Waiting for first stop";

    trackCar.setAttribute("transform", "translate(105 35)");

    stops.forEach(stop => {
      document
        .getElementById("marker-" + stop)
        .classList.remove("visited");
    });
  }

  records.forEach(record => {
    const card = document.createElement("div");
    card.className = "photoCard";

    const image = document.createElement("img");
    const imageUrl = URL.createObjectURL(record.photo);

    image.src = imageUrl;
    image.alt = record.code + " captured photo";

    const heading = document.createElement("h3");
    heading.textContent = record.code;

    const time = document.createElement("p");
    time.className = "muted";
    time.textContent =
      new Date(record.timestamp).toLocaleString();

    const download = document.createElement("a");
    download.href = imageUrl;
    download.download = record.code + ".jpg";
    download.textContent = "Download photo";

    card.appendChild(heading);
    card.appendChild(image);
    card.appendChild(time);
    card.appendChild(download);

    gallery.appendChild(card);
  });
}

// Reset all stops and saved photos
async function resetStops() {
  const confirmed = confirm(
    "Are you sure you want to delete all four saved stops and photos?"
  );

  if (!confirmed) {
    return;
  }

  await clearPhotos();

  lastDetectedCode = "";
  detectionStartTime = 0;

  await renderGallery();

  statusText.textContent = "All stops have been reset.";
}

// Button events
startButton.addEventListener("click", startCamera);
stopButton.addEventListener("click", stopCamera);
manualButton.addEventListener("click", manualCapture);
resetButton.addEventListener("click", resetStops);

// Initialize app
async function initializeApp() {
  try {
    await openDatabase();
    await renderGallery();

    cameraState.textContent = "Camera is stopped.";
    connection.textContent = "Database connected";
    statusText.textContent = "Ready to scan QR codes.";

  } catch (error) {
    console.error("Database error:", error);
    statusText.textContent =
      "Could not open photo database.";
  }
}

initializeApp();

// Register service worker if available
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .catch(error => {
        console.error("Service worker registration failed:", error);
      });
  });
}
