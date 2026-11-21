/* Hands in the browser: MediaPipe HandLandmarker on the webcam, turned into the
   same per-hand record JARVIS's Python tracker sends (jarvis/vision/tracker.py
   _describe_hand), so model.js and assembly.js drive the model unchanged.
   The frame is mirrored like JARVIS's (cfg mirror): x -> 1 - x. */
import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const WRIST = 0, THUMB_CMC = 1, THUMB_TIP = 4, INDEX_MCP = 5, MIDDLE_MCP = 9, PINKY_MCP = 17, INDEX_TIP = 8;
const FINGERS = [[8, 6, 5], [12, 10, 9], [16, 14, 13], [20, 18, 17]];
const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
               [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function describe(lm, label) {
  const pts = lm.map((p) => [1 - p.x, p.y, p.z]);          // mirrored
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const scale = Math.max(dist(pts[WRIST], pts[MIDDLE_MCP]), 1e-4);
  const pinches = FINGERS.map(([tip]) => dist(pts[THUMB_TIP], pts[tip]) / scale);
  const reaches = FINGERS.map(([tip]) => dist(pts[tip], pts[WRIST]) / scale);
  const palm = [(pts[WRIST][0] + pts[INDEX_MCP][0] + pts[PINKY_MCP][0]) / 3,
                (pts[WRIST][1] + pts[INDEX_MCP][1] + pts[PINKY_MCP][1]) / 3];
  const extended = FINGERS.map(([tip, pip]) => dist(pts[tip], pts[WRIST]) > dist(pts[pip], pts[WRIST]) * 1.12);
  const thumbOut = dist(pts[THUMB_TIP], pts[PINKY_MCP]) > dist(pts[THUMB_CMC], pts[PINKY_MCP]) * 1.05;
  const minx = Math.min(...xs), miny = Math.min(...ys);
  return {
    label, points: pts, palm,
    index_tip: [pts[INDEX_TIP][0], pts[INDEX_TIP][1]],
    thumb_tip: [pts[THUMB_TIP][0], pts[THUMB_TIP][1]],
    pinch: pinches[0], pinches, reaches, index_reach: reaches[0], scale,
    extended, n_extended: extended.filter(Boolean).length, thumb_out: thumbOut,
    bbox: [minx, miny, Math.max(...xs) - minx, Math.max(...ys) - miny],
    owner: true,
  };
}

export async function startHands(viewer, { video, canvas, onStatus }) {
  onStatus && onStatus('starting camera…');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
  video.srcObject = stream;
  await video.play();
  onStatus && onStatus('loading hand model…');
  const files = await FilesetResolver.forVisionTasks(WASM);
  let lm;
  try {
    lm = await HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 2 });
  } catch (_) {
    lm = await HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 2 });
  }
  onStatus && onStatus('');
  const ctx = canvas.getContext('2d');
  let last = -1, running = true;
  function frame() {
    if (!running) return;
    if (video.readyState >= 2 && video.currentTime !== last) {
      last = video.currentTime;
      const now = performance.now();
      const res = lm.detectForVideo(video, now);
      const hands = (res.landmarks || []).map((l, i) => {
        const h = res.handednesses && res.handednesses[i] && res.handednesses[i][0];
        // mirroring swaps chirality back, as in the Python tracker
        const label = h ? (h.categoryName === 'Left' ? 'Right' : 'Left') : 'Right';
        return describe(l, label);
      });
      // the biggest hand is the user's; a far-off second hand is not
      if (hands.length > 1) {
        const big = Math.max(...hands.map((h) => h.scale));
        hands.forEach((h) => { h.owner = h.scale >= big * 0.55; });
      }
      viewer.onVision({ hands, t: now / 1000 });
      canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#64e3ff'; ctx.fillStyle = '#b6f2ff'; ctx.lineWidth = 1.5;
      for (const h of hands) {
        const P = h.points.map((p) => [p[0] * canvas.width, p[1] * canvas.height]);
        ctx.beginPath();
        for (const [a, b] of BONES) { ctx.moveTo(P[a][0], P[a][1]); ctx.lineTo(P[b][0], P[b][1]); }
        ctx.stroke();
        for (const p of P) { ctx.beginPath(); ctx.arc(p[0], p[1], 2, 0, 7); ctx.fill(); }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return () => { running = false; stream.getTracks().forEach((t) => t.stop()); lm.close(); };
}
