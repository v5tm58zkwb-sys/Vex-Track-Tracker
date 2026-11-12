
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously
} from
  "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  set,
  update,
  remove,
  onValue
} from
  "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";


// ==========================================
// 1. FIREBASE CONFIGURATION
// REPLACE THESE VALUES WITH YOUR OWN
// ==========================================

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "YOUR_DATABASE_URL",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};


// ==========================================
// 2. INITIALIZE FIREBASE
// ==========================================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);


// ==========================================
// 3. PAGE ELEMENTS
// ==========================================

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
const lastUpdated = document.getElementById("lastUpdated");

const trackCar = document.getElementById("trackCar");
const trackPosition = document.getElementById("trackPosition");
const gallery = document.getElementById("gallery");

const ownerControls = document.getElementById("ownerControls");
const viewerMessage = document.getElementById("viewerMessage");
const pageHeading = document.getElementById("pageHeading");

const shareLink = document.getElementById("shareLink");
const copyLinkButton = document.getElementById("copyLinkButton");
const copyStatus = document.getElementById("copyStatus");


// ==========================================
// 4. ROOM AND VIEWER SETUP
// ==========================================

const params = new URLSearchParams(window.location.search);

const viewerMode = params.has("view");

function createRoomId() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

let roomId;

if (viewerMode) {
  roomId = params.get("view");

  if (!/^[a-f0-9]{36}$/.test(roomId || "")) {
    statusText.textContent = "Invalid viewer link.";
    throw new Error("Invalid room ID.");
  }

} else {
  roomId = localStorage.getItem("vexTrackerRoomId");

  if (!roomId) {
    roomId = createRoomId();
    localStorage.setItem("vexTrackerRoomId", roomId);
  }
}

const roomRef = ref(db, "rooms/" + roomId);
const stopsRef = ref(db, "rooms/" + roomId + "/stops");
const statusRef = ref(db, "rooms/" + roomId + "/status");

const stops = ["STOP1", "STOP2", "STOP3", "STOP4"];

let stream = null;
let scanTimer = null;
let scanning = false;
let captureInProgress = false;

let lastDetectedCode = "";
let detectionStartTime = 0;
let lastCapturedCode = "";

let currentRoomData = {};

const canvas = document.createElement("canvas");
const context = canvas.getContext("2d", {
  willReadFrequently: true
});


// ==========================================
// 5. SET UP OWNER OR VIEWER SCREEN
// ==========================================

if (viewerMode) {
  ownerControls.classList.add("hidden");
  viewerMessage.classList.remove("hidden");
  pageHeading.textContent = "VEX Tracker Live Viewer";
} else {
  const viewerUrl =
    window.location.origin +
    window.location.pathname +
    "?view=" +
    encodeURIComponent(roomId);

  shareLink.value = viewerUrl;
  pageHeading.textContent = "VEX Tracker Control";
}


// ==========================================
// 6. CONNECT TO FIREBASE
// ==========================================

async function initializeAppConnection() {
  try {
    await signInAnonymously(auth);

    connection.textContent = "Connected";
    connection.style.background = "#dcfce7";
    connection.style.color = "#166534";

    statusText.textContent =
      viewerMode
        ? "Connected. Waiting for car updates..."
        : "Connected. Ready to track the car.";

    listenForUpdates();

  } catch (error) {
    console.error(error);

    connection.textContent = "Connection failed";
    statusText.textContent =
      "Firebase error: " + error.message;
  }
}


// ==========================================
// 7. LISTEN FOR LIVE DATABASE UPDATES
// ==========================================

function listenForUpdates() {
  onValue(
    roomRef,
    snapshot => {
      currentRoomData = snapshot.val() || {};
      renderRoom(currentRoomData);
    },
    error => {
      console.error(error);
      statusText.textContent =
        "Database access error: " + error.message;
    }
  );
}


// ==========================================
// 8. RENDER LIVE STATUS
// ==========================================

function renderRoom(data) {
  const savedStops = data.stops || {};
  const roomStatus = data.status || {};

  const records = Object.values(savedStops)
    .sort((a, b) => a.timestamp - b.timestamp);

  const completed = stops.filter(code =>
    Boolean(savedStops[code])
  );

  progressText.textContent =
    completed.length + " of 4 stops completed";

  progressBar.style.width =
    (completed.length / 4 * 100) + "%";

  const lastCode = roomStatus.lastStop || null;

  lastStopText.textContent = lastCode || "None";

  const nextCode = stops.find(code =>
    !savedStops[code]
  );

  nextStopText.textContent =
    nextCode || "All stops completed";

  if (lastCode) {
    updateTrackPosition(lastCode);
  } else {
    trackPosition.textContent =
      "Car position: Waiting for first stop";
  }

  if (roomStatus.updatedAt) {
    lastUpdated.textContent =
      "Last update: " +
      new Date(roomStatus.updatedAt).toLocaleString();
  } else {
    lastUpdated.textContent = "No updates yet";
  }

  renderPhotos(records);

  if (viewerMode) {
    statusText.textContent = lastCode
      ? "Live update: " + lastCode + " detected."
      : "Waiting for the car to scan its first QR code.";
  }
}


// ==========================================
// 9. UPDATE TRACK MAP
// ==========================================

function updateTrackPosition(code) {
  const positions = {
    STOP1: { x: 105, y: 35 },
    STOP2: { x: 235, y: 35 },
    STOP3: { x: 235, y: 215 },
    STOP4: { x: 105, y: 215 }
  };

  const position = positions[code];

  if (!position) return;

  trackCar.setAttribute(
    "transform",
    `translate(${position.x} ${position.y})`
  );

  trackPosition.textContent = "Car position: " + code;

  stops.forEach(stop => {
    document
      .getElementById("marker-" + stop)
      .classList.toggle("visited", Boolean(
        currentRoomData.stops &&
        currentRoomData.stops[stop]
      ));
  });
}


// ==========================================
// 10. DISPLAY PHOTOS
// ==========================================

function renderPhotos(records) {
  gallery.innerHTML = "";

  records.forEach(record => {
    const card = document.createElement("div");
    card.className = "photoCard";

    const heading = document.createElement("h3");
    heading.textContent = record.code;

    const image = document.createElement("img");
    image.src = record.photo;
    image.alt = record.code + " photo";

    const time = document.createElement("p");
    time.className = "muted";
    time.textContent =
      new Date(record.timestamp).toLocaleString();

    const download = document.createElement("a");
    download.href = record.photo;
    download.download = record.code + ".jpg";
    download.textContent = "Download photo";

    card.appendChild(heading);
    card.appendChild(image);
    card.appendChild(time);
    card.appendChild(download);

    gallery.appendChild(card);
  });
}


// ==========================================
// 11. START CAMERA
// ==========================================

async function startCamera() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera requires an HTTPS website.");
    }

    stopCamera();

    cameraMessage.textContent =
      "Requesting camera permission...";

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    video.srcObject = stream;
    video.setAttribute("playsinline", "");
    video.muted = true;

    await video.play();

    scanning = true;

    cameraState.textContent = "Camera is running.";
    cameraMessage.textContent =
      "Scanning for STOP1, STOP2, STOP3, and STOP4.";

    statusText.textContent = "Scanning...";

    scanTimer = setInterval(scanFrame, 150);

  } catch (error) {
    console.error(error);
    cameraState.textContent = "Camera could not start.";
    cameraMessage.textContent = error.message;
  }
}


// ==========================================
// 12. STOP CAMERA
// ==========================================

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

  if (video) {
    video.srcObject = null;
  }

  if (cameraState) {
    cameraState.textContent = "Camera is stopped.";
  }
}


// ==========================================
// 13. SCAN QR CODES
// ==========================================

function scanFrame() {
  if (
    !scanning ||
    video.readyState !== video.HAVE_ENOUGH_DATA ||
    !video.videoWidth
  ) {
    return;
  }

  if (typeof jsQR !== "function") {
    statusText.textContent = "QR library failed to load.";
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
    { inversionAttempts: "attemptBoth" }
  );

  if (!result || !result.data) {
    lastDetectedCode = "";
    lastCapturedCode = "";
    detectionStartTime = 0;
    return;
  }

  const code = result.data
    .trim()
    .toUpperCase()
    .replace(/\s/g, "");

  if (!stops.includes(code)) {
    return;
  }

  if (code !== lastDetectedCode) {
    lastDetectedCode = code;
    detectionStartTime = Date.now();
    return;
  }

  if (
    Date.now() - detectionStartTime >= 250 &&
    lastCapturedCode !== code
  ) {
    lastCapturedCode = code;
    captureStop(code);
  }
}


// ==========================================
// 14. CAPTURE PHOTO AND UPLOAD TO FIREBASE
// ==========================================

async function captureStop(code) {
  if (
    viewerMode ||
    captureInProgress ||
    !video.videoWidth
  ) {
    return;
  }

  captureInProgress = true;

  try {
    statusText.textContent =
      "Capturing and uploading " + code + "...";

    // Reduce image size to keep database usage lower.
    const maxWidth = 800;
    const scale = Math.min(
      1,
      maxWidth / video.videoWidth
    );

    const photoCanvas = document.createElement("canvas");

    photoCanvas.width =
      Math.round(video.videoWidth * scale);

    photoCanvas.height =
      Math.round(video.videoHeight * scale);

    const photoContext = photoCanvas.getContext("2d");

    photoContext.drawImage(
      video,
      0,
      0,
      photoCanvas.width,
      photoCanvas.height
    );

    const photoData = photoCanvas.toDataURL(
      "image/jpeg",
      0.65
    );

    const timestamp = Date.now();

    const record = {
      code: code,
      photo: photoData,
      timestamp: timestamp
    };

    // Save the photo and timestamp online.
    await set(
      ref(db, "rooms/" + roomId + "/stops/" + code),
      record
    );

    // Update the live car position.
    await update(statusRef, {
      lastStop: code,
      updatedAt: new Date(timestamp).toISOString()
    });

    statusText.textContent =
      code + " captured and uploaded successfully!";

  } catch (error) {
    console.error(error);

    statusText.textContent =
      "Upload failed: " + error.message;

    lastCapturedCode = "";
  } finally {
    captureInProgress = false;
  }
}


// ==========================================
// 15. MANUAL PHOTO CAPTURE
// ==========================================

async function manualCapture() {
  const savedStops =
    currentRoomData.stops || {};

  const nextCode = stops.find(code =>
    !savedStops[code]
  );

  if (!nextCode) {
    statusText.textContent =
      "All four stops have already been captured.";
    return;
  }

  if (!stream || !video.videoWidth) {
    statusText.textContent =
      "Start the camera before taking a photo.";
    return;
  }

  lastCapturedCode = nextCode;

  await captureStop(nextCode);
}


// ==========================================
// 16. RESET TRACKER
// ==========================================

async function resetStops() {
  if (viewerMode) return;

  const confirmed = confirm(
    "Delete all four saved photos and reset the tracker?"
  );

  if (!confirmed) return;

  try {
    await remove(stopsRef);

    await set(statusRef, {
      lastStop: null,
      updatedAt: new Date().toISOString()
    });

    lastDetectedCode = "";
    lastCapturedCode = "";
    detectionStartTime = 0;

    statusText.textContent =
      "Tracker has been reset.";

  } catch (error) {
    statusText.textContent =
      "Could not reset: " + error.message;
  }
}


// ==========================================
// 17. COPY VIEWER LINK
// ==========================================

async function copyViewerLink() {
  try {
    await navigator.clipboard.writeText(
      shareLink.value
    );

    copyStatus.textContent =
      "Viewer link copied! Send it to the other phone.";

  } catch (error) {
    shareLink.select();
    copyStatus.textContent =
      "Select and copy the link manually.";
  }
}


// ==========================================
// 18. BUTTON EVENTS
// ==========================================

if (!viewerMode) {
  startButton.addEventListener("click", startCamera);
  stopButton.addEventListener("click", stopCamera);
  manualButton.addEventListener("click", manualCapture);
  resetButton.addEventListener("click", resetStops);
  copyLinkButton.addEventListener("click", copyViewerLink);
}


// ==========================================
// 19. START APP
// ==========================================

initializeAppConnection();


// ==========================================
// 20. SERVICE WORKER
// ==========================================

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .catch(error => console.error(error));
  });
}
