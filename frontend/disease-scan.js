/**
 * Mitti Mantra · Offline-First Crop Disease Scan Engine
 * Exposes window.MittiDiseaseScan with:
 *  - loadModel(statusCallback)
 *  - startCamera(videoElement)
 *  - stopCamera()
 *  - capturePhoto(videoElement, canvasElement)
 *  - runInference(canvasElement, cropCtx)
 *  - analyzeSeverity(canvasElement)
 *  - getHistory()
 *  - saveScan(scanResult)
 *  - clearHistory()
 */
(function () {
  'use strict';

  if (window.MittiDiseaseScan) return;

  const DISEASE_CLASSES = [
    "maize_common_rust", "maize_gray_leaf_spot", "maize_northern_leaf_blight", "maize_healthy",
    "potato_early_blight", "potato_late_blight", "potato_healthy",
    "soybean_healthy",
    "tomato_bacterial_spot", "tomato_early_blight", "tomato_late_blight", "tomato_leaf_mold",
    "tomato_septoria_leaf_spot", "tomato_spider_mites", "tomato_target_spot",
    "tomato_yellow_leaf_curl_virus", "tomato_mosaic_virus", "tomato_healthy"
  ];

  const DISEASE_METADATA = {
    "maize_common_rust": {
      "name": "Maize Common Rust",
      "organic": [
        "Destroy infected crop debris after harvest to prevent winter survival.",
        "Plant resistant maize hybrids.",
        "Apply organic copper-based fungicides if caught in very early stages."
      ],
      "chemical": [
        "Spray Mancozeb 75 WP at 2g/L or Propiconazole 25 EC at 1ml/L of water."
      ],
      "schemes": ["pmfby", "kkc"]
    },
    "maize_gray_leaf_spot": {
      "name": "Maize Gray Leaf Spot",
      "organic": [
        "Rotate crops for 2 or more years with non-host crops (e.g. pulses, soybean).",
        "Deep tillage to bury infected plant residues in the soil."
      ],
      "chemical": [
        "Spray Pyraclostrobin or Azoxystrobin based fungicides at recommended intervals."
      ],
      "schemes": ["pmfby", "kkc"]
    },
    "maize_northern_leaf_blight": {
      "name": "Maize Northern Leaf Blight",
      "organic": [
        "Select resistant cultivars.",
        "Bury crop residues with deep tillage after harvest."
      ],
      "chemical": [
        "Apply foliar spray of Mancozeb or Zineb when lesions are first observed."
      ],
      "schemes": ["pmfby"]
    },
    "maize_healthy": {
      "name": "Maize Healthy Leaf",
      "organic": [
        "Continue standard crop rotation.",
        "Ensure balanced fertilization according to soil tests."
      ],
      "chemical": [
        "No chemical inputs are required."
      ],
      "schemes": []
    },
    "potato_early_blight": {
      "name": "Potato Early Blight",
      "organic": [
        "Prune lower infected leaves.",
        "Avoid overhead irrigation to keep leaves dry.",
        "Apply neem oil spray (0.5%) as a biological preventative."
      ],
      "chemical": [
        "Spray Chlorothalonil or Mancozeb (2g/L) at 10-14 day intervals."
      ],
      "schemes": ["pmfby", "kkc"]
    },
    "potato_late_blight": {
      "name": "Potato Late Blight",
      "organic": [
        "Plant certified disease-free seed tubers.",
        "Destroy all cull piles and volunteers immediately.",
        "Apply Trichoderma-based bio-fungicides."
      ],
      "chemical": [
        "Foliar application of Metalaxyl-M (8%) + Mancozeb (64%) WP (Ridomil Gold) at 2.5g/L."
      ],
      "schemes": ["pmfby", "kkc"]
    },
    "potato_healthy": {
      "name": "Potato Healthy Leaf",
      "organic": [
        "Monitor weather patterns (humidity) and spray preventive bio-agents."
      ],
      "chemical": [
        "No chemical fungicide is required."
      ],
      "schemes": []
    },
    "soybean_healthy": {
      "name": "Soybean Healthy Leaf",
      "organic": [
        "Practice crop rotation.",
        "Ensure proper drainage in fields."
      ],
      "chemical": [
        "No chemical fungicide is required."
      ],
      "schemes": []
    },
    "tomato_bacterial_spot": {
      "name": "Tomato Bacterial Spot",
      "organic": [
        "Use certified pathogen-free seeds.",
        "Avoid working in fields when foliage is wet.",
        "Apply copper hydroxide bio-blends."
      ],
      "chemical": [
        "Apply Copper Hydroxide (2g/L) mixed with Streptocycline (0.1g/L) at weekly intervals."
      ],
      "schemes": ["pmfby"]
    },
    "tomato_early_blight": {
      "name": "Tomato Early Blight",
      "organic": [
        "Prune lower branches to improve airflow and reduce soil splash.",
        "Apply organic straw mulch to create a barrier over soil.",
        "Foliar spray of Bacillus subtilis biological agent."
      ],
      "chemical": [
        "Foliar spray of Azoxystrobin 23% SC (1ml/L) or Mancozeb 75 WP (2g/L)."
      ],
      "schemes": ["pmfby", "kkc"]
    },
    "tomato_late_blight": {
      "name": "Tomato Late Blight",
      "organic": [
        "Remove and burn infected plants immediately.",
        "Avoid overhead irrigation.",
        "Spray copper-based organic fungicides at first sign of rain/fog."
      ],
      "chemical": [
        "Apply Cymoxanil + Mancozeb (Curzate) or Metalaxyl + Mancozeb (Ridomil Gold) immediately."
      ],
      "schemes": ["pmfby", "kkc"]
    },
    "tomato_leaf_mold": {
      "name": "Tomato Leaf Mold",
      "organic": [
        "Increase spacing and ventilation.",
        "Avoid overhead watering and keep humidity below 85%."
      ],
      "chemical": [
        "Spray Chlorothalonil or Difenoconazole if infection becomes severe."
      ],
      "schemes": []
    },
    "tomato_septoria_leaf_spot": {
      "name": "Tomato Septoria Leaf Spot",
      "organic": [
        "Remove and destroy lower infected leaves.",
        "Mulch the soil base and water at ground level."
      ],
      "chemical": [
        "Apply Chlorothalonil or Mancozeb sprays at first sign of leaf spots."
      ],
      "schemes": []
    },
    "tomato_spider_mites": {
      "name": "Tomato Spider Mite Infestation",
      "organic": [
        "Spray neem oil (1-2%) or insecticidal soaps.",
        "Release phytoseiid predatory mites.",
        "Keep plants well irrigated (dry dust promotes mite breeding)."
      ],
      "chemical": [
        "Apply Abamectin or Spiromesifen acaricides."
      ],
      "schemes": []
    },
    "tomato_target_spot": {
      "name": "Tomato Target Spot",
      "organic": [
        "Improve air circulation through staking and pruning.",
        "Bury or burn crop residues."
      ],
      "chemical": [
        "Spray Azoxystrobin or Chlorothalonil."
      ],
      "schemes": []
    },
    "tomato_yellow_leaf_curl_virus": {
      "name": "Tomato Yellow Leaf Curl Virus (TYLCV)",
      "organic": [
        "Place yellow sticky traps to catch whitefly vectors.",
        "Use insect netting on nursery beds.",
        "Spray neem seed kernel extract (NSKE) to deter pests."
      ],
      "chemical": [
        "Spray systemic insecticides like Imidacloprid (0.5ml/L) or Thiamethoxam to control whiteflies."
      ],
      "schemes": ["pmfby"]
    },
    "tomato_mosaic_virus": {
      "name": "Tomato Mosaic Virus (ToMV)",
      "organic": [
        "Drench tools and hands in 10% trisodium phosphate.",
        "Promptly pull out and destroy infected plants."
      ],
      "chemical": [
        "No chemical cure is available for viral infections. Manage vector insects chemically if needed."
      ],
      "schemes": []
    },
    "tomato_healthy": {
      "name": "Tomato Healthy Leaf",
      "organic": [
        "Maintain clean hygiene and baseline soil care and clean field hygiene."
      ],
      "chemical": [
        "No chemical inputs are required."
      ],
      "schemes": []
    }
  };

  const MODEL_URL = './models/disease/model.json';
  const DB_NAME = 'MittiMantraML';
  const DB_VERSION = 1;
  const STORE_NAME = 'model_files';
  const HISTORY_STORE_NAME = 'scan_history';

  let tfjsModel = null;
  let activeStream = null;

  // Helper: Open IndexedDB
  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) {
          db.createObjectStore(HISTORY_STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = e => resolve(e.target.result);
      request.onerror = e => reject(e.target.error);
    });
  }

  // Helper: Get item from DB
  async function getDBItem(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Helper: Put item into DB
  async function putDBItem(storeName, key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Helper: Load TFJS CDN Dynamically
  function loadTFJSLib() {
    return new Promise((resolve, reject) => {
      if (window.tf) return resolve();
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
      script.onload = () => resolve();
      script.onerror = err => reject(err);
      document.head.appendChild(script);
    });
  }

  // Custom IndexedDB IO Handler for TensorFlow.js
  class IDBHandler {
    constructor(modelPath) {
      this.modelPath = modelPath;
    }

    async save(modelArtifacts) {
      try {
        await putDBItem(STORE_NAME, 'model_artifacts', modelArtifacts);
        return { modelArtifactsInfo: {} };
      } catch (err) {
        console.warn('Could not save model to IndexedDB:', err);
        return {};
      }
    }

    async load() {
      try {
        const artifacts = await getDBItem(STORE_NAME, 'model_artifacts');
        if (artifacts) {
          return artifacts;
        }
      } catch (err) {
        console.warn('Could not load model from IndexedDB, falling back to HTTP fetch:', err);
      }
      // Fallback: Fetch model from network/service worker cache
      const response = await fetch(this.modelPath);
      const modelJson = await response.json();
      
      // Load weights
      const weightManifest = modelJson.weightsManifest;
      const baseDir = this.modelPath.substring(0, this.modelPath.lastIndexOf('/') + 1);
      
      const weightBuffers = [];
      for (const entry of weightManifest) {
        for (const path of entry.paths) {
          const weightResponse = await fetch(baseDir + path);
          const buffer = await weightResponse.arrayBuffer();
          weightBuffers.push(new Uint8Array(buffer));
        }
      }

      // Combine weights
      let totalLength = 0;
      weightBuffers.forEach(b => totalLength += b.byteLength);
      const combinedWeights = new Uint8Array(totalLength);
      let offset = 0;
      weightBuffers.forEach(b => {
        combinedWeights.set(b, offset);
        offset += b.byteLength;
      });

      const modelArtifacts = {
        modelTopology: modelJson.modelTopology,
        weightSpecs: weightManifest.flatMap(entry => entry.weights),
        weightData: combinedWeights.buffer
      };

      // Save to IndexedDB asynchronously
      putDBItem(STORE_NAME, 'model_artifacts', modelArtifacts).catch(e => console.warn(e));

      return modelArtifacts;
    }
  }

  // Main Object API
  const MittiDiseaseScan = {
    DISEASE_CLASSES,
    DISEASE_METADATA,

    // 1. Dynamic Load and Offline Caching (IndexedDB)
    async loadModel(statusCallback = () => {}) {
      if (tfjsModel) return tfjsModel;
      
      statusCallback('Loading TensorFlow.js library...');
      await loadTFJSLib();

      statusCallback('Initializing model from database cache...');
      const handler = new IDBHandler(MODEL_URL);
      tfjsModel = await tf.loadLayersModel(handler);
      
      statusCallback('✓ Model active and ready offline');
      return tfjsModel;
    },

    // 2. Camera Controls
    async startCamera(videoElement) {
      if (activeStream) {
        MittiDiseaseScan.stopCamera();
      }

      const constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      };

      try {
        activeStream = await navigator.mediaDevices.getUserMedia(constraints);
        videoElement.srcObject = activeStream;
        videoElement.setAttribute('playsinline', true);
        videoElement.play();
        return true;
      } catch (err) {
        console.error('Camera access failed:', err);
        // Fallback constraint
        try {
          activeStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          videoElement.srcObject = activeStream;
          videoElement.setAttribute('playsinline', true);
          videoElement.play();
          return true;
        } catch (fallbackErr) {
          throw new Error('Webcam access was denied or is not supported.');
        }
      }
    },

    stopCamera() {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
        activeStream = null;
      }
    },

    // 3. Photo Capture
    capturePhoto(videoElement, canvasElement) {
      const ctx = canvasElement.getContext('2d');
      const w = videoElement.videoWidth || videoElement.width || 640;
      const h = videoElement.videoHeight || videoElement.height || 480;
      
      // Setup canvas size
      canvasElement.width = w;
      canvasElement.height = h;

      // Draw frame
      ctx.drawImage(videoElement, 0, 0, w, h);

      // Perform local image compression (canvas quality setting)
      // returns base64 string at 80% JPEG quality
      return canvasElement.toDataURL('image/jpeg', 0.8);
    },

    // 4. Color Thresholding & Leaf Segmentation (Severity Calculation)
    analyzeSeverity(canvasElement) {
      // Scale canvas logic or use incoming 224x224 scaled canvas
      const ctx = canvasElement.getContext('2d');
      const imgData = ctx.getImageData(0, 0, canvasElement.width, canvasElement.height);
      const data = imgData.data;

      let greenCount = 0;
      let lesionCount = 0;
      let nonLeafCount = 0;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];

        const brightness = (r + g + b) / 3.0;
        // Ignore very dark and very bright pixels (background / soil / reflections)
        if (brightness < 25 || brightness > 240) {
          nonLeafCount++;
          continue;
        }

        // Green leaf classification: Green channel dominates red and blue significantly
        const isGreen = (g > r) && (g > b) && (g > 35);
        
        // Lesion classification: Reddish/brownish/yellowish spots
        const isLesion = ((r > g) || ((r > 95) && (g > 95) && (b < 80))) && !isGreen && (r > 30 || g > 30);

        if (isGreen) {
          greenCount++;
        } else if (isLesion) {
          lesionCount++;
        } else {
          nonLeafCount++;
        }
      }

      const leafPixels = greenCount + lesionCount;
      const lesionPct = leafPixels > 0 ? (lesionCount / leafPixels) * 100.0 : 0.0;
      
      let severity = 'early';
      if (lesionPct > 20.0) {
        severity = 'severe';
      } else if (lesionPct > 5.0) {
        severity = 'moderate';
      }

      return {
        greenPixels: greenCount,
        lesionPixels: lesionCount,
        leafPixels: leafPixels,
        lesionPct: lesionPct,
        severity: severity
      };
    },

    // 5. Client-Side Inference Engine (TF.js) with Crop Context Filter
    async runInference(canvasElement, cropCtx = "") {
      if (!tfjsModel) {
        await MittiDiseaseScan.loadModel();
      }

      // Preprocessing image to [1, 224, 224, 3] normalised to [0, 1]
      const predictions = tf.tidy(() => {
        // Grab pixels from canvas, resize to 224x224
        const img = tf.browser.fromPixels(canvasElement);
        const resized = tf.image.resizeBilinear(img, [224, 224]);
        const normalized = resized.toFloat().div(tf.scalar(255.0));
        const batched = normalized.expandDims(0);
        return tfjsModel.predict(batched);
      });

      const probs = await predictions.data();
      predictions.dispose();

      // Apply crop context filter if cropCtx selected
      let bestIdx = 0;
      let bestProb = -1.0;

      for (let i = 0; i < probs.length; i++) {
        const clsName = DISEASE_CLASSES[i];
        let score = probs[i];

        if (cropCtx) {
          // Boost scores of selected crop, suppress non-matching crops
          score = clsName.startsWith(cropCtx) ? score * 2.0 : score * 0.02;
        }

        if (score > bestProb) {
          bestProb = score;
          bestIdx = i;
        }
      }

      const predictedClass = DISEASE_CLASSES[bestIdx];
      const confidence = Math.min(0.99, Math.max(0.40, probs[bestIdx]));

      return {
        classId: predictedClass,
        confidence: confidence,
        allProbs: Array.from(probs)
      };
    },

    // 6. Scan History (IndexedDB Storage)
    async getHistory() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(HISTORY_STORE_NAME, 'readonly');
        const store = tx.objectStore(HISTORY_STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          // Sort descending by timestamp
          const sorted = (req.result || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          resolve(sorted);
        };
        req.onerror = () => reject(req.error);
      });
    },

    async saveScan(scanResult) {
      const db = await openDB();
      const item = {
        ...scanResult,
        timestamp: new Date().toISOString()
      };
      return new Promise((resolve, reject) => {
        const tx = db.transaction(HISTORY_STORE_NAME, 'readwrite');
        const store = tx.objectStore(HISTORY_STORE_NAME);
        const req = store.add(item);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },

    async clearHistory() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(HISTORY_STORE_NAME, 'readwrite');
        const store = tx.objectStore(HISTORY_STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  };

  window.MittiDiseaseScan = MittiDiseaseScan;
})();
