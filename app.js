
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  onValue
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";

// ==========================================
// 1. FIREBASE CONFIGURATION
// ==========================================

const firebaseConfig = {
  apiKey: "AIzaSyAznsW3cB8xo_76Mb2KJoLg1e4n_7C4Qm0",
  authDomain: "vex-tracker-cd912.firebaseapp.com",
  databaseURL: "https://vex-tracker-cd912-default-rtdb.firebaseio.com",
  projectId: "vex-tracker-cd912",
  storageBucket: "vex-tracker-cd912.firebasestorage.app",
  messagingSenderId: "630495882859",
  appId: "1:630495882859:web:4b289b20ef394877ea8b2e",
  measurementId: "G-CHDB89VHKK"
};

// ==========================================
// 2. INITIALIZE FIREBASE
// ==========================================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

let currentRoomId = null;
let currentRoomData = {};
let isViewer = false;
let cameraStream = null;
let scanning = false;
let animationFrame = null;
let lastDetectedCode = null;
let lastCapturedCode = null;
let captureInProgress = false;
let lastSeenTime = 0;
let currentFacingMode = "environment";

const STOP_CODES = ["STOP1", "STOP2", "STOP3", "STOP4"];

const roomParameter = new URLSearchParams(window.location.search).get("view");

const ownerControls = document.getElementById("ownerControls");
const viewerMessage = document.getElementById("viewerMessage");

// ==========================================
// 3. HTML ELEMENTS
// ==========================================

const video = document.getElementById("video");

const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const manualButton = document.getElementById("manualButton");
const resetButton = document.getElementById("resetButton");

const cameraState = document.getElementById("cameraState");
const cameraMessage = document.getElementById("cameraMessage");

const statusElement = document.getElementById("status");
const connectionElement = document.getElementById("connection");

const progressText = document.getElementById("progressText");
const progressBar = document.getElementById("progressBar");

const lastStopElement = document.getElementById("lastStop");
const nextStopElement = document.getElementById("nextStop");
const lastUpdatedElement = document.getElementById("lastUpdated");

const trackCar = document.getElementById("trackCar");
const trackPosition = document.getElementById("trackPosition");

const gallery = document.getElementById("gallery");

const shareLink = document.getElementById("shareLink");
const copyLinkButton = document.getElementById("copyLinkButton");
const copyStatus = document.getElementById("copyStatus");

const pageHeading = document.getElementById("pageHeading");

// ==========================================
// 4. HELPER FUNCTIONS
// ==========================================

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function setCameraMessage(message) {
  setText(cameraMessage, message);
}

function getStopNumber(code) {
  return STOP_CODES.indexOf(code) + 1;
}

function getCompletedStops() {
  return STOP_CODES.filter(code =>
    currentRoomData.stops &&
    currentRoomData.stops[code]
  );
}

function getNextStop() {
  return STOP_CODES.find(code =>
    !currentRoomData.stops ||
    !currentRoomData.stops[code]
  );
}

function getFormattedTime(timestamp) {
  if (!timestamp) return "Not recorded";

  return new Date(timestamp).toLocaleString();
}

function createRoomId() {
  if (window.crypto && crypto.randomUUID) {
    return crypto.randomUUID().replaceAll("-", "");
  }

  return (
    Date.now().toString(36) +
    Math.random().toString(36).substring(2, 15)
  );
}

// ==========================================
// 5. INITIALIZE ROOM
// ==========================================

async function initializeRoom() {
  if (roomParameter) {
    isViewer = true;
    currentRoomId = roomParameter;

    if (ownerControls) {
      ownerControls.style.display = "none";
    }

    if (viewerMessage) {
      viewerMessage.style.display = "block";
      viewerMessage.textContent =
        "You are viewing the live VEX Tracker session.";
    }

    setText(pageHeading, "VEX Tracker - Live Viewer");

  } else {
    isViewer = false;

    currentRoomId = localStorage.getItem("vexTrackerRoom");

    if (!currentRoomId) {
      currentRoomId = createRoomId();

      localStorage.setItem(
        "vexTrackerRoom",
        currentRoomId
      );
    }

    if (ownerControls) {
      ownerControls.style.display = "block";
    }

    if (viewerMessage) {
      viewerMessage.style.display = "none";
    }

    setText(pageHeading, "VEX Tracker");

    createShareLink();
  }

  const roomRef = ref(
    database,
    "rooms/" + currentRoomId
  );

  const existingRoom = await get(roomRef);

  if (!existingRoom.exists() && !isViewer) {
    await set(roomRef, {
      status: {
        lastStop: "None",
        updatedAt: Date.now()
      },
      stops: {}
    });
  }

  listenForRoomUpdates();

  setText(connectionElement, "Connected to Firebase");
}

// ==========================================
// 6. CREATE SHAREABLE VIEWER LINK
// ==========================================

function createShareLink() {
  if (!shareLink) return;

  const viewerUrl = new URL(window.location.href);

  viewerUrl.search = "";
  viewerUrl.searchParams.set("view", currentRoomId);

  shareLink.value = viewerUrl.toString();
}

if (copyLinkButton) {
  copyLinkButton.addEventListener("click", async () => {
    if (!shareLink || !shareLink.value) return;

    try {
      await navigator.clipboard.writeText(shareLink.value);

      setText(copyStatus, "Link copied! Send it to the other phone.");

    } catch (error) {
      shareLink.select();
      document.execCommand("copy");

      setText(copyStatus, "Link copied!");
    }
  });
}

// ==========================================
// 7. LISTEN FOR FIREBASE UPDATES
// ==========================================

function listenForRoomUpdates() {
  const roomRef = ref(
    database,
    "rooms/" + currentRoomId
  );

  onValue(
    roomRef,
    snapshot => {
      if (!snapshot.exists()) {
        currentRoomData = {};
      } else {
        currentRoomData = snapshot.val() || {};
      }

      renderRoom();
    },
    error => {
      console.error("Firebase listener error:", error);

      setText(
        connectionElement,
        "Database connection error"
      );
    }
  );
}

// ==========================================
// 8. DISPLAY TRACKING INFORMATION
// ==========================================

function renderRoom() {
  const completedStops = getCompletedStops();
  const completedCount = completedStops.length;

  setText(
    progressText,
    completedCount + " of 4 stops completed"
  );

  if (progressBar) {
    progressBar.style.width =
      (completedCount / 4 * 100) + "%";
  }

  const lastStop =
    currentRoomData.status?.lastStop || "None";

  setText(lastStopElement, lastStop);

  const nextStop = getNextStop();

  setText(
    nextStopElement,
    nextStop || "All stops completed!"
  );

  if (completedCount === 4) {
    setText(statusElement, "Tracking complete!");
  } else {
    setText(statusElement, "Tracking in progress");
  }

  setText(
    lastUpdatedElement,
    getFormattedTime(
      currentRoomData.status?.updatedAt
    )
  );

  updateTrackPosition(lastStop);
  updateGallery();

  STOP_CODES.forEach(code => {
    const marker = document.getElementById(
      "marker-" + code
    );

    if (marker) {
      marker.style.opacity =
        currentRoomData.stops &&
        currentRoomData.stops[code]
          ? "1"
          : "0.35";
    }
  });
}

// ==========================================
// 9. UPDATE CAR POSITION ON TRACK
// ==========================================

function updateTrackPosition(lastStop) {
  const positions = {
    STOP1: { x: "15%", y: "50%" },
    STOP2: { x: "50%", y: "15%" },
    STOP3: { x: "85%", y: "50%" },
    STOP4: { x: "50%", y: "85%" }
  };

  if (lastStop === "None" || !positions[lastStop]) {
    return;
  }

  const position = positions[lastStop];

  if (trackCar) {
    trackCar.style.left = position.x;
    trackCar.style.top = position.y;
    trackCar.style.transform = "translate(-50%, -50%)";
  }

  setText(
    trackPosition,
    "Car last detected at " + lastStop
  );
}

// ==========================================
// 10. DISPLAY PHOTOS
// ==========================================

function updateGallery() {
  if (!gallery) return;

  gallery.innerHTML = "";

  STOP_CODES.forEach(code => {
    const stop = currentRoomData.stops?.[code];

    const card = document.createElement("div");

    card.style.padding = "12px";
    card.style.marginBottom = "12px";
    card.style.border = "1px solid #ccc";
    card.style.borderRadius = "10px";

    const heading = document.createElement("h3");
    heading.textContent = code;

    card.appendChild(heading);

    if (stop && stop.photo) {
      const image = document.createElement("img");

      image.src = stop.photo;
      image.alt = "Photo captured at " + code;
      image.style.width = "100%";
      image.style.maxWidth = "350px";
      image.style.borderRadius = "8px";

      card.appendChild(image);

      const time = document.createElement("p");

      time.textContent =
        "Captured: " + getFormattedTime(stop.timestamp);

      card.appendChild(time);

      const completed = document.createElement("p");

      completed.textContent = "Completed";
      completed.style.color = "green";

      card.appendChild(completed);

    } else {
      const waiting = document.createElement("p");

      waiting.textContent = "Waiting for QR code...";
      card.appendChild(waiting);
    }

    gallery.appendChild(card);
  });
}

// ==========================================
// 11. COMPRESS PHOTO
// ==========================================

function capturePhoto() {
  if (!video || !video.videoWidth || !video.videoHeight) {
    throw new Error("Camera is not ready.");
  }

  const canvas = document.createElement("canvas");

  const maxWidth = 800;

  const scale = Math.min(
    1,
    maxWidth / video.videoWidth
  );

  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);

  const context = canvas.getContext("2d");

  context.drawImage(
    video,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas.toDataURL("image/jpeg", 0.65);
}

// ==========================================
// 12. SAVE STOP AND PHOTO TO FIREBASE
// ==========================================

async function saveStop(code) {
  if (isViewer) return;

  if (!STOP_CODES.includes(code)) {
    console.warn("Unknown QR code:", code);
    return;
  }

  if (captureInProgress) return;

  if (
    currentRoomData.stops &&
    currentRoomData.stops[code]
  ) {
    return;
  }

  captureInProgress = true;

  setCameraMessage(
    "QR code detected: " + code + ". Capturing photo..."
  );

  try {
    const photo = capturePhoto();

    const timestamp = Date.now();

    const stopData = {
      code: code,
      photo: photo,
      timestamp: timestamp
    };

    const stopRef = ref(
      database,
      "rooms/" + currentRoomId +
      "/stops/" + code
    );

    await set(stopRef, stopData);

    const statusRef = ref(
      database,
      "rooms/" + currentRoomId + "/status"
    );

    await update(statusRef, {
      lastStop: code,
      updatedAt: timestamp
    });

    lastCapturedCode = code;

    setCameraMessage(
      code + " saved successfully!"
    );

    console.log("Saved stop:", code);

  } catch (error) {
    console.error("Could not save stop:", error);

    setCameraMessage(
      "Error saving " + code + ": " + error.message
    );

    lastCapturedCode = null;

  } finally {
    captureInProgress = false;
  }
}

// ==========================================
// 13. QR CODE SCANNING
// ==========================================

const scanCanvas = document.createElement("canvas");
const scanContext = scanCanvas.getContext("2d");

function scanFrame() {
  if (!scanning || !video) return;

  if (
    video.readyState >= video.HAVE_ENOUGH_DATA &&
    video.videoWidth > 0
  ) {
    scanCanvas.width = video.videoWidth;
    scanCanvas.height = video.videoHeight;

    scanContext.drawImage(
      video,
      0,
      0,
      scanCanvas.width,
      scanCanvas.height
    );

    if (typeof window.jsQR === "function") {
      const imageData = scanContext.getImageData(
        0,
        0,
        scanCanvas.width,
        scanCanvas.height
      );

      const result = window.jsQR(
        imageData.data,
        imageData.width,
        imageData.height,
        {
          inversionAttempts: "attemptBoth"
        }
      );

      if (result && result.data) {
        const code = result.data.trim();

        if (STOP_CODES.includes(code)) {
          lastSeenTime = Date.now();

          if (code !== lastDetectedCode) {
            lastDetectedCode = code;
            console.log("Detected QR:", code);
          }

          if (
            code !== lastCapturedCode &&
            !captureInProgress
          ) {
            saveStop(code);
          }

        } else {
          lastDetectedCode = null;
        }

      } else {
        if (Date.now() - lastSeenTime > 700) {
          lastDetectedCode = null;
          lastCapturedCode = null;
        }
      }

    } else {
      setCameraMessage(
        "QR scanner library is missing. Check that jsQR is loaded in index.html."
      );
    }
  }

  animationFrame = requestAnimationFrame(scanFrame);
}

// ==========================================
// 14. START CAMERA
// ==========================================

async function startCamera() {
  if (isViewer) return;

  try {
    stopCamera();

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Camera access requires HTTPS. Open the GitHub Pages website."
      );
    }

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: {
          ideal: currentFacingMode
        },
        width: {
          ideal: 1280
        },
        height: {
          ideal: 720
        }
      },
      audio: false
    });

    video.srcObject = cameraStream;

    await video.play();

    scanning = true;

    lastDetectedCode = null;
    lastCapturedCode = null;

    setText(cameraState, "Camera running");
    setCameraMessage(
      "Camera is scanning for STOP1, STOP2, STOP3, and STOP4."
    );

    scanFrame();

  } catch (error) {
    console.error("Camera error:", error);

    setText(cameraState, "Camera error");

    setCameraMessage(
      "Could not start camera: " + error.message
    );
  }
}

// ==========================================
// 15. STOP CAMERA
// ==========================================

function stopCamera() {
  scanning = false;

  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => {
      track.stop();
    });

    cameraStream = null;
  }

  if (video) {
    video.srcObject = null;
  }

  setText(cameraState, "Camera stopped");
}

// ==========================================
// 16. BUTTON CONTROLS
// ==========================================

if (startButton) {
  startButton.addEventListener("click", startCamera);
}

if (stopButton) {
  stopButton.addEventListener("click", () => {
    stopCamera();

    setCameraMessage("Camera stopped.");
  });
}

if (manualButton) {
  manualButton.addEventListener("click", async () => {
    if (isViewer) return;

    const nextStop = getNextStop();

    if (!nextStop) {
      setCameraMessage("All four stops are completed.");
      return;
    }

    if (!cameraStream) {
      setCameraMessage("Start the camera before capturing.");
      return;
    }

    await saveStop(nextStop);
  });
}

// ==========================================
// 17. RESET TRACKING SESSION
// ==========================================

if (resetButton) {
  resetButton.addEventListener("click", async () => {
    if (isViewer) return;

    const confirmed = confirm(
      "Are you sure you want to delete all four stops and photos?"
    );

    if (!confirmed) return;

    try {
      stopCamera();

      const stopsRef = ref(
        database,
        "rooms/" + currentRoomId + "/stops"
      );

      await remove(stopsRef);

      const statusRef = ref(
        database,
        "rooms/" + currentRoomId + "/status"
      );

      await set(statusRef, {
        lastStop: "None",
        updatedAt: Date.now()
      });

      lastDetectedCode = null;
      lastCapturedCode = null;

      setCameraMessage("Tracking session reset.");

    } catch (error) {
      console.error("Reset error:", error);

      setCameraMessage(
        "Could not reset: " + error.message
      );
    }
  });
}

// ==========================================
// 18. START THE APPLICATION
// ==========================================

async function startApp() {
  try {
    setText(connectionElement, "Connecting to Firebase...");

    await signInAnonymously(auth);

    await initializeRoom();

    console.log("VEX Tracker is ready.");

  } catch (error) {
    console.error("Application startup error:", error);

    setText(
      connectionElement,
      "Firebase connection failed: " + error.message
    );

    setCameraMessage(
      "Check your Firebase Authentication and Realtime Database settings."
    );
  }
}

// ==========================================
// 19. SERVICE WORKER
// ==========================================

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js")
      .then(registration => {
        console.log(
          "Service worker registered:",
          registration.scope
        );
      })
      .catch(error => {
        console.error(
          "Service worker registration failed:",
          error
        );
      });
  });
}

// ==========================================
// 20. RUN APP
// ==========================================

startApp();
