/* ===========================================================================
   Assembly mode: a machine that comes apart in the in-HUD viewer.

   A package (`<name>.assembly/`: assembly.json + meshes/*.stl, the format
   `jarvis-assembly/1`) is a tree of subassemblies and parts, each part with a
   mesh, a material, a mass and a line about what it does. Point at a piece
   (mouse, or a hand with the index finger out) and its card comes up: what it
   is made of, what it weighs, how it is made. Click it (mouse, or a short still
   pinch) and it glides to the centre while everything else moves out of the
   way and fades; click it again, or empty space, and it all goes back
   together. Double-click (or pinch twice) one of its parts to take that part
   out on its own; click again to go back up. Voice reaches the same moves
   through `op()`.

   Dragging turns it (right-drag slides, the wheel zooms): model.js owns the
   camera and tells a click from a drag, and only a click comes here.

   Everything is computed here from the package, roll-ups included: it stores
   one mass per part and nothing that could disagree with it. The Python side
   (jarvis/assembly.py) computes the same roll-ups for the spoken answers.

   The ModelViewer owns the camera, the turntable and the hand turning; this
   owns the pieces, where they are, the pointer and the card.
   =========================================================================== */
(function (global) {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const GLIDE_MS = 800;            // isolate, explode, put back
  const FADED = 0.15;              // what the pieces not being looked at fade to
  // jarvis/vision/gestures.py's click rule, so an air-click here is the same
  // gesture as a click anywhere else: established over STABLE_FRAMES, then a
  // short still release. A pinch that travels is a turn, not a click.
  const STABLE_FRAMES = 4, CLICK_MAX_HOLD = 0.6, CLICK_MAX_TRAVEL = 0.02;
  const PINCH_ON = 0.3, PINCH_OFF = 0.45, MIN_REACH = 1.3, MIN_HAND_SCALE = 0.07;
  // A real click from the OS (gestures armed, moving the actual mouse) and the
  // air-click read from the same pinch arrive together: one of them only.
  const SAME_CLICK_S = 0.7;
  // Two clicks this close in time and place are one double-click. A click on
  // the piece taken out waits this long before putting it back, in case it is
  // the first half of a double-click on one of its parts.
  const DOUBLE_S = 0.5;
  const DOUBLE_PX = { mouse: 24, hand: 60 };
  // Edge lines are what make the hologram read as one; past this many drawn
  // triangles they cost more than they give and are left off.
  const EDGE_BUDGET = 200000;
  const COMP_COLOURS = ['#64e3ff', '#ffb347', '#63ffa5', '#ff7ab6', '#b48cff', '#ffd866', '#7aa2ff'];

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function fmtKg(kg) {
    const v = Math.abs(kg);
    const text = v >= 100 ? kg.toFixed(0) : v >= 10 ? kg.toFixed(1) : v >= 1 ? kg.toFixed(2)
      : String(+kg.toPrecision(3));
    return `${text} kg`;
  }
  const fmtPct = (p) => `${+p.toFixed(1)} %`;

  // A dark material on a near-black stage disappears. Drawn a little lighter;
  // the card's swatch keeps the package's own colour.
  function drawColour(hex) {
    const c = new THREE.Color(hex || '#8fa3ad');
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    if (lum < 0.38) c.lerp(new THREE.Color(0xffffff), Math.min(0.5, (0.38 - lum) * 1.4));
    return c;
  }

  function meshRel(rel) {
    rel = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
    return rel.startsWith('meshes/') ? rel.slice(7) : rel;
  }

  class AssemblyView {
    constructor(viewer) {
      this.viewer = viewer;
      this.ready = false;
      this.masses = true;              // the spoken "hide masses" switch
      this.path = [];                  // focus: root, then each piece taken out
      this.exploded = false;
      this.hovered = null;
      this.anim = null;
      this.mouse = null;               // last pointer over the canvas, page px
      this.hand = null;                // last pointing fingertip, page px
      this.pinch = { on: false, frames: 0, down: null };
      this.pointFrames = 0;
      this.lastClick = null;
      this.raycaster = new THREE.Raycaster();
      this._overlays();
      this._mouseEvents();
    }

    /* ------------------------------------------------------------ loading */

    async load(model, setStatus) {
      const started = performance.now();
      // parahuman vault: the package comes decrypted from vault.js, not a server.
      const pkg = await global.VAULT.pkg();
      this.model = model;
      this.pkg = pkg;
      this.materials = pkg.materials || {};
      this.showMass = pkg.show_mass !== false;
      this.nodes = new Map();
      this.root3 = new THREE.Group();
      this.root = this._node(pkg.root, null, 0);
      this.root3.add(this.root.holder);

      // Each mesh file once, however many parts use it: the two P and the two
      // G units of the astroworm are the same files under different matrices.
      const parts = [...this.nodes.values()].filter((n) => n.kind === 'part' && n.data.mesh);
      const files = [...new Set(parts.map((n) => meshRel(n.data.mesh)))];
      const geoms = new Map();
      let done = 0, missing = 0;
      const queue = files.slice();
      const worker = async () => {
        while (queue.length) {
          const rel = queue.shift();
          try {
            const positions = global.VAULT.positions(rel);
            if (!positions) throw new Error('missing');
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            // Normals from the triangles themselves: some exporters write
            // zeros, and a flat normal per face is what the file meant anyway.
            g.computeVertexNormals();
            g.computeBoundingBox();          // lets a ray skip a mesh it misses
            g.computeBoundingSphere();
            geoms.set(rel, g);
          } catch (_) {
            missing++;
          }
          done++;
          if (setStatus) setStatus(`loading ${pkg.name}… ${done}/${files.length} meshes`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker));
      this.geoms = geoms;

      let drawn = 0;
      for (const n of parts) {
        const g = geoms.get(meshRel(n.data.mesh));
        if (g) drawn += g.attributes.position.count / 3;
      }
      const edges = drawn <= EDGE_BUDGET ? new Map() : null;
      const pick = [];
      for (const n of parts) {
        const g = geoms.get(meshRel(n.data.mesh));
        if (!g) continue;
        const mat = this.materials[n.data.material] || {};
        const material = new THREE.MeshPhongMaterial({
          color: drawColour(mat.color), specular: 0x3a5866, shininess: 26,
        });
        const mesh = new THREE.Mesh(g, material);
        mesh.userData.part = n;
        mesh.userData.base = material.color.clone();
        if (n.data.frame === 'world') {
          // Written where it sits in the assembly: undo the placement the
          // tree is about to apply, so it lands where the file says.
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(n.toAsm).invert();
        }
        if (edges) {
          if (!edges.has(g)) edges.set(g, new THREE.EdgesGeometry(g, 32));
          const line = new THREE.LineSegments(edges.get(g), new THREE.LineBasicMaterial({
            color: 0xb6f2ff, transparent: true, opacity: 0.22 }));
          line.raycast = () => {};
          mesh.add(line);
          mesh.userData.edges = line;
        }
        n.frame.add(mesh);
        n.meshes.push(mesh);
        pick.push(mesh);
      }
      this.pickables = pick;
      this.drawn = drawn;
      this.missing = missing;

      // Boxes in the assembly's frame, assembled: every centre and size the
      // moves are worked out from.
      const tmp = new THREE.Box3();
      for (const n of [...this.nodes.values()].reverse()) {
        n.box = new THREE.Box3();
        for (const mesh of n.meshes) {
          tmp.copy(mesh.geometry.boundingBox);
          const toAsm = n.data.frame === 'world' ? new THREE.Matrix4() : n.toAsm;
          n.box.union(tmp.applyMatrix4(toAsm));
        }
        for (const c of n.children) if (!c.box.isEmpty()) n.box.union(c.box);
      }
      for (const n of this.nodes.values()) {
        n.c0 = n.box.isEmpty() ? new THREE.Vector3() : n.box.getCenter(new THREE.Vector3());
        n.r = n.box.isEmpty() ? 0 : n.box.getSize(new THREE.Vector3()).length() / 2;
      }
      const size = this.root.box.getSize(new THREE.Vector3());
      this.C0 = this.root.c0.clone();
      this.R = Math.max(this.root.r, 1e-6);
      this.scale = 2 / Math.max(size.x, size.y, size.z, 1e-6);
      this.root3.scale.setScalar(this.scale);
      this.root3.position.copy(this.C0).multiplyScalar(-this.scale);
      this.axis = new THREE.Vector3().fromArray(pkg.axis || [1, 0, 0]).normalize();
      this.up = new THREE.Vector3().fromArray(pkg.up || [0, 0, 1]).normalize();

      this.path = [this.root];
      this.exploded = false;
      this.hovered = null;
      this.home = null;
      this.ready = true;
      this.loadMs = performance.now() - started;
      this._crumbs();
      this._showCaption();
      this._card();
      this._report();
      return { name: pkg.name, parts: parts.length, drawn, missing, problems: pkg._problems || [] };
    }

    _node(data, parent, depth) {
      const n = {
        id: String(data.id), name: String(data.name || data.id), kind: String(data.kind || ''),
        data, parent, depth, children: [], meshes: [],
        selectable: data.selectable !== false,
        offset: new THREE.Vector3(), fade: 1,
      };
      if (!['assembly', 'subassembly', 'part'].includes(n.kind)) {
        n.kind = (data.children && data.children.length) ? 'subassembly' : 'part';
      }
      // holder: where the piece has been moved to (a translation in its
      // parent's frame); frame: the package's placement of it in its parent.
      n.holder = new THREE.Group();
      n.frame = new THREE.Group();
      n.frame.matrixAutoUpdate = false;
      const m = Array.isArray(data.matrix) && data.matrix.length === 16 ? data.matrix : null;
      if (m) n.frame.matrix.fromArray(m);
      n.holder.add(n.frame);
      const parentToAsm = parent ? parent.toAsm : new THREE.Matrix4();
      n.toAsm = parentToAsm.clone().multiply(n.frame.matrix);
      // Moves are worked out in the assembly's frame; this turns one into a
      // translation in the frame the holder actually sits in.
      n.toLocal = new THREE.Matrix3().setFromMatrix4(parentToAsm).invert();
      this.nodes.set(n.id, n);
      for (const child of data.children || []) {
        if (!child || typeof child !== 'object' || this.nodes.has(String(child.id))) continue;
        const c = this._node(child, n, depth + 1);
        n.children.push(c);
        n.frame.add(c.holder);
      }
      return n;
    }

    dispose() {
      this._cancelClick();
      if (this.root3 && this.root3.parent) this.root3.parent.remove(this.root3);
      const seen = new Set();
      for (const n of (this.nodes || new Map()).values()) {
        for (const mesh of n.meshes) {
          mesh.material.dispose();
          if (mesh.userData.edges) {
            mesh.userData.edges.material.dispose();
            seen.add(mesh.userData.edges.geometry);
          }
          seen.add(mesh.geometry);
        }
      }
      seen.forEach((g) => g.dispose());
      this.ready = false;
      this.hovered = null;
      this.hand = null;
      for (const el of [this.cardEl, this.crumbEl, this.captionEl, this.pointerEl]) el.hidden = true;
    }

    /* -------------------------------------------------------------- levels */

    get focus() { return this.path[this.path.length - 1]; }

    /* What can be pointed at while `focus` is taken out: its children, with a
       subassembly marked `selectable: false` opened up so its own children
       stand in for it. A part taken out is its own unit. */
    units(focus) {
      if (focus.kind === 'part') return [focus];
      const out = [];
      for (const c of focus.children) {
        if (c.kind !== 'part' && !c.selectable) out.push(...this.units(c));
        else out.push(c);
      }
      return out;
    }

    /* The unit under `focus` that holds `node`, or null if it is not inside. */
    unitOf(node, focus) {
      if (node === focus) return focus.kind === 'part' ? focus : null;
      const chain = [];
      for (let n = node; n && n !== focus; n = n.parent) chain.unshift(n);
      if (!chain.length || chain[0].parent !== focus) return null;
      return chain.find((n) => n.kind === 'part' || n.selectable) || null;
    }

    inside(node, focus) {
      for (let n = node; n; n = n.parent) if (n === focus) return true;
      return false;
    }

    pathTo(node) {
      const path = [this.root];
      while (path[path.length - 1] !== node) {
        const u = this.unitOf(node, path[path.length - 1]);
        if (!u || path.includes(u)) break;
        path.push(u);
      }
      return path;
    }

    /* ------------------------------------------------------------ the moves */

    _dir(o, f, i) {
      const hint = o.data.explode;
      if (Array.isArray(hint) && hint.length === 3 && hint.some((v) => v)) {
        return new THREE.Vector3().fromArray(hint).normalize();
      }
      const v = o.c0.clone().sub(f.c0);
      if (v.length() > 0.04 * Math.max(f.r, 1e-6)) return v.normalize();
      // Sharing a centre (a shaft inside its shell): out to the sides in turn.
      const side = new THREE.Vector3().crossVectors(this.axis, this.up).normalize();
      return [this.up, side, this.up.clone().negate(), side.clone().negate()][i % 4].clone();
    }

    /* Where every piece goes for a focus path and an explode, worked out from
       the assembled positions every time, so any sequence of moves ends in
       the same place and putting it back is exact. */
    /* Camera distance that fits these boxes (assembly frame, moved to where
       they are going) in the view at the rotation the model is turned to:
       a long thin segment seen end-on or broadside fills the frame either way. */
    _fit(boxes, around) {
      const v = this.viewer;
      const cam = v.camera;
      const tv = Math.tan((cam ? cam.fov : 42) * Math.PI / 360);
      const th = tv * (cam ? cam.aspect : 1.6) * 0.7;           // the card covers the right of the view
      const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(v.target.x, v.target.y, 0));
      let d = 0;
      const p = new THREE.Vector3();
      for (const b of boxes) {
        for (let i = 0; i < 8; i++) {
          p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)
            .sub(around).multiplyScalar(this.scale).applyMatrix4(rot);
          d = Math.max(d, p.z + Math.abs(p.x) / th, p.z + Math.abs(p.y) / tv);
        }
      }
      return global.ModelViewer.clampZoom(d * 1.12);
    }

    /* The assembled machine framed so it stays in view through a whole turn
       of the turntable: a 4.5 m worm is a sliver at the distance that suits
       a compact part. */
    homeFit() {
      const v = this.viewer, yaw = v.target.y;
      let d = 0;
      for (let k = 0; k < 16; k++) {
        v.target.y = yaw + k * Math.PI / 8;
        d = Math.max(d, this._fit([this.root.box], this.root.c0));
      }
      v.target.y = yaw;
      return d;
    }

    _targets(path, exploded) {
      const T = new Map();
      const shift = new THREE.Vector3();
      for (let i = 1; i < path.length; i++) {
        const F = path[i], units = this.units(path[i - 1]);
        // It slides so its centre is the centre of the view...
        const off = this.C0.clone().sub(F.c0).sub(shift);
        T.set(F.id, { off, fade: 1 });
        // ...and the rest of its level slides with it, then out of its way.
        units.forEach((o, k) => {
          if (o === F) return;
          const d = o.c0.distanceTo(F.c0);
          const push = Math.max(0, F.r + o.r - d) + 0.6 * F.r + 0.12 * this.R;
          T.set(o.id, { off: off.clone().addScaledVector(this._dir(o, F, k), push), fade: FADED });
        });
        shift.add(off);
      }
      const F = path[path.length - 1];
      let boxes = [F.box];
      if (exploded && F.kind !== 'part') {
        boxes = [];
        this.units(F).forEach((u, k) => {
          const d = u.c0.distanceTo(F.c0);
          const dir = this._dir(u, F, k);
          const off = dir.multiplyScalar(d > 0.04 * F.r ? 0.8 * d + 0.3 * F.r : 0.9 * F.r);
          T.set(u.id, { off, fade: 1 });
          if (!u.box.isEmpty()) boxes.push(u.box.clone().translate(off));
        });
      }
      return { T, boxes, around: F.c0 };
    }

    setState(path, exploded, why) {
      if (!this.ready) return;
      const v = this.viewer;
      const wasHome = this.path.length === 1 && !this.exploded;
      const goingHome = path.length === 1 && !exploded;
      if (wasHome && !goingHome) {
        this.home = { d: v.targetDistance, pan: { x: v.targetPan.x, y: v.targetPan.y } };
      }
      this.path = path;
      this.exploded = !!exploded;
      const { T, boxes, around } = this._targets(path, exploded);
      const items = [];
      for (const n of this.nodes.values()) {
        const to = T.get(n.id) || { off: new THREE.Vector3(), fade: 1 };
        if (n.offset.distanceToSquared(to.off) < 1e-18 && Math.abs(n.fade - to.fade) < 1e-9) continue;
        items.push({ n, from: n.offset.clone(), to: to.off, f0: n.fade, f1: to.fade });
      }
      this.anim = items.length ? { t0: performance.now(), items } : null;
      // The camera: onto the piece taken out, or back to where it was before.
      v.spin = false;
      if (goingHome && this.home) {
        v.targetDistance = this.home.d;
        v.targetPan = { x: this.home.pan.x, y: this.home.pan.y };
      } else if (!goingHome) {
        v.targetDistance = this._fit(boxes, around);
        v.targetPan = { x: 0, y: 0 };
      }
      this._crumbs();
      this._card();
      this._report();
      if (why) this.viewer.setStatus('');
    }

    isolate(node) {
      if (!node) return;
      if (node === this.root) { this.reassemble(); return; }
      this.setState(this.pathTo(node), false);
    }

    back() {
      if (this.exploded) this.setState(this.path, false);
      else if (this.path.length > 1) this.setState(this.path.slice(0, -1), false);
    }

    explode() { this.setState(this.path, true); }

    reassemble() { this.setState([this.root], false); }

    /* From the voice side: {op: isolate|explode|reassemble|back|masses}. */
    op(e) {
      if (!this.ready && e.op !== 'masses') return;
      if (e.op !== 'masses') this._cancelClick();          // a click still waiting is overtaken
      if (e.op === 'isolate') this.isolate(this.nodes.get(String(e.id)));
      else if (e.op === 'explode') this.explode();
      else if (e.op === 'reassemble') this.reassemble();
      else if (e.op === 'back') this.back();
      else if (e.op === 'masses') this.setMasses(e.show !== false);
    }

    setMasses(show) {
      this.masses = !!show;
      this._crumbs();
      this._card();
      this._report();
    }

    setSmooth() {
      for (const g of (this.geoms || new Map()).values()) {
        g.setAttribute('normal', new THREE.BufferAttribute(
          ModelViewer.creasedNormals(g.attributes.position.array, 38), 3));
      }
    }

    /* ------------------------------------------------------------ the frame */

    tick(now) {
      if (!this.ready) return;
      if (this.anim) {
        const k = Math.min(1, (now - this.anim.t0) / GLIDE_MS);
        const e = ease(k);
        for (const it of this.anim.items) {
          if (k >= 1) { it.n.offset.copy(it.to); it.n.fade = it.f1; }
          else { it.n.offset.lerpVectors(it.from, it.to, e); it.n.fade = it.f0 + (it.f1 - it.f0) * e; }
          it.n.holder.position.copy(it.n.offset).applyMatrix3(it.n.toLocal);
        }
        if (k >= 1) this.anim = null;
        this._paint();
      }
      this._hover(now);
    }

    /* Opacity is the product of the fades above a part; highlight is the unit
       under the pointer. */
    _paint() {
      const focus = this.focus;
      for (const n of this.nodes.values()) {
        if (!n.meshes.length) continue;
        let a = 1;
        for (let p = n; p; p = p.parent) a *= p.fade;
        const lit = this.hovered && this.inside(n, this.hovered);
        // Under cyan light every material reads cyan, so a glow alone hardly
        // shows on a long machine: the rest of its level steps back as well.
        const dim = this.hovered && !lit && this.inside(n, focus) ? 0.55 : 1;
        for (const mesh of n.meshes) {
          const m = mesh.material;
          const see = a < 0.999;
          if (m.transparent !== see) { m.transparent = see; m.depthWrite = !see; m.needsUpdate = true; }
          m.opacity = see ? a : 1;
          m.color.copy(mesh.userData.base).multiplyScalar(dim);
          m.emissive.setHex(lit ? 0x1b6d88 : 0x000000);
          if (mesh.userData.edges) mesh.userData.edges.material.opacity = (lit ? 0.6 : 0.22 * dim) * a;
        }
      }
    }

    /* The page point a pointer is at: a pointing hand first (it is what the
       person is doing right now), else the mouse over the canvas. */
    _pointer(now) {
      if (this.hand && now - this.hand.t < 300) return this.hand;
      return this.mouse;
    }

    _ndc(pt) {
      const rect = this.viewer.renderer.domElement.getBoundingClientRect();
      if (!rect.width || pt.x < rect.left || pt.x > rect.right || pt.y < rect.top || pt.y > rect.bottom) return null;
      return new THREE.Vector2(((pt.x - rect.left) / rect.width) * 2 - 1,
                               -((pt.y - rect.top) / rect.height) * 2 + 1);
    }

    /* The unit under a page point at the current level, looking through the
       faded pieces as if they were not there. */
    unitAt(pt, fresh) {
      if (!this.ready || !pt) return null;
      const ndc = this._ndc(pt);
      if (!ndc) return null;
      if (fresh) this.viewer.scene.updateMatrixWorld();
      this.raycaster.setFromCamera(ndc, this.viewer.camera);
      const focus = this.focus;
      for (const hit of this.raycaster.intersectObjects(this.pickables, false)) {
        const part = hit.object.userData.part;
        if (!this.inside(part, focus) && part !== focus) continue;
        const u = this.unitOf(part, focus);
        if (u) return u;
      }
      return null;
    }

    _hover(now) {
      const pt = this._pointer(now);
      const p = this.pointerEl, stage = this.viewer.el.getBoundingClientRect();
      const handOn = pt && pt === this.hand;
      p.hidden = !handOn;
      if (handOn) {
        p.style.transform = `translate(${pt.x - stage.left}px, ${pt.y - stage.top}px)`;
        p.classList.toggle('pinch', this.pinch.on);
      }
      // A ray every frame through half a million triangles is wasted work;
      // every 40 ms, and only when the pointer or the view has moved.
      const v = this.viewer;
      // Held while a pinch or a mouse drag has the model: the card stays on
      // the piece it was on instead of flickering through what turns past.
      const held = !!(this.pinch.down || (v.press && v.press.drag));
      const key = pt ? `${pt.x | 0},${pt.y | 0},${v.rotation.x.toFixed(3)},${v.rotation.y.toFixed(3)},` +
        `${v.distance.toFixed(3)},${v.pan.x.toFixed(3)},${v.pan.y.toFixed(3)},${!!this.anim},${held}` : 'none';
      if (key === this._hoverKey || (this._hoverAt && now - this._hoverAt < 40)) return;
      this._hoverKey = key;
      this._hoverAt = now;
      const u = held ? this.hovered : this.unitAt(pt);
      if (u !== this.hovered) {
        this.hovered = u;
        if (u) v.spin = false;            // a piece under the pointer stops the turntable
        this._paint();
        this._card();
        this._report();
      }
    }

    /* A click from anywhere: the mouse, the OS (gestures driving the real
       pointer), or a pinch. What it means:
         assembled:                 a piece is taken out
         a subassembly taken out:   on it, or on empty space: all back together;
                                    double, on one of its parts: that part out
         a part taken out:          anywhere: back up to its subassembly
       Only the click that could still become a double-click waits for one. */
    click(pt, source) {
      if (!this.ready) return;
      const t = performance.now() / 1000;
      // The air-click and the real click the same pinch makes are one click.
      if (this.lastClick && this.lastClick.source !== source && t - this.lastClick.t < SAME_CLICK_S) return;
      this.lastClick = { source, t };
      const near = (c) => c && t - c.t <= DOUBLE_S &&
        Math.hypot(pt.x - c.at.x, pt.y - c.at.y) <= (DOUBLE_PX[source] || 24);
      const waiting = this.pendingClick;
      if (waiting) {
        clearTimeout(waiting.timer);
        this.pendingClick = null;
        if (near(waiting)) { this._double(waiting.at); this.lastFired = { t, at: waiting.at }; return; }
        this._single(waiting.at);                     // a different click: the first one stands
      }
      if (near(this.lastFired)) { this.lastFired = null; return; }   // the rest of a double already acted on
      if (this._couldBeDouble(this.unitAt(pt, true))) {
        this.pendingClick = { t, at: pt, timer: setTimeout(() => {
          this.pendingClick = null;
          this._single(pt);
        }, DOUBLE_S * 1000) };
        return;
      }
      this._single(pt);
      this.lastFired = { t, at: pt };
    }

    _cancelClick() {
      if (this.pendingClick) clearTimeout(this.pendingClick.timer);
      this.pendingClick = null;
      this.lastFired = null;
    }

    /* A double-click means something of its own only on a piece of a
       subassembly that has been taken out. */
    _couldBeDouble(u) {
      const focus = this.focus;
      return !!u && this.path.length > 1 && focus.kind !== 'part' && u !== focus;
    }

    _single(pt) {
      if (!this.ready) return;
      const u = this.unitAt(pt, true);
      if (this.path.length > 1) { this.back(); return; }      // taken out: back (up) on any click
      if (u) this.setState(this.path.concat([u]), false);       // assembled: take this one out
      else if (this.exploded) this.setState(this.path, false);  // exploded: empty space closes it
    }

    _double(pt) {
      if (!this.ready) return;
      const u = this.unitAt(pt, true);
      if (this._couldBeDouble(u)) this.setState(this.path.concat([u]), false);
      else this._single(pt);
    }

    /* ------------------------------------------------------------ the hands */

    /* Called with the user's hands every frame. Returns true when the frame
       was this view's (pointing), so the viewer does not also read it. */
    onHands(hands, t) {
      if (!this.ready) return false;
      const hand = hands.length === 1 ? hands[0] : null;
      if (!hand || (hand.scale || 0) < MIN_HAND_SCALE) {
        // A hand that was too small to trust, or two hands zooming: no pointer.
        this.pinch = { on: false, frames: 0, down: null };
        this.pointFrames = 0;
        return false;
      }
      const gaps = hand.pinches || [hand.pinch, 9, 9, 9];
      const reach = hand.reaches || [hand.index_reach || 0, 0, 0, 0];
      const ext = hand.extended || [];
      const pinching = gaps[0] < (this.pinch.on ? PINCH_OFF : PINCH_ON) && reach[0] >= MIN_REACH;
      const pinch = this.pinch;
      if (pinching) {
        pinch.on = true;
        pinch.frames++;
        if (pinch.frames >= STABLE_FRAMES && !pinch.down) {
          // Where it was pointing just before the fingers closed: closing them
          // moves the fingertip, and the click belongs where the person aimed.
          const at = this.hand && t - this.hand.ts < 0.6 ? { x: this.hand.x, y: this.hand.y }
            : this._toPage([(hand.thumb_tip[0] + hand.index_tip[0]) / 2,
                            (hand.thumb_tip[1] + hand.index_tip[1]) / 2]);
          pinch.down = { t, palm: hand.palm.slice(), at };
        }
        if (this.hand) this.hand.t = performance.now();       // keep the reticle up through it
        this.pointFrames = 0;
        return false;                                          // a travelling pinch still turns it
      }
      if (pinch.down) {
        const held = t - pinch.down.t;
        const travel = Math.hypot(hand.palm[0] - pinch.down.palm[0], hand.palm[1] - pinch.down.palm[1]);
        const at = pinch.down.at;
        this.pinch = { on: false, frames: 0, down: null };
        if (held <= CLICK_MAX_HOLD && travel <= CLICK_MAX_TRAVEL) this.click(at, 'hand');
      } else {
        this.pinch = { on: false, frames: 0, down: null };
      }
      const pointing = ext[0] && !ext[1] && !ext[2] && !ext[3];
      if (!pointing) { this.pointFrames = 0; return false; }
      this.pointFrames++;
      // Fingers closing from an open hand pass through "pointing" for a frame
      // or two; only a held point takes over from the open-hand turn.
      if (this.pointFrames < 2) return false;
      const raw = this._toPage(hand.index_tip);
      const prev = this.hand && performance.now() - this.hand.t < 300 ? this.hand : null;
      const a = 0.45;                                          // fingertip jitter, smoothed
      this.hand = prev ? { x: prev.x + a * (raw.x - prev.x), y: prev.y + a * (raw.y - prev.y) } : raw;
      this.hand.t = performance.now();
      this.hand.ts = t;
      this.viewer.grab = null;
      return true;
    }

    /* Vision coordinates to the page: the same mapping the HUD draws the hand
       skeleton with (core.js _toScreen), so the reticle sits on the finger. */
    _toPage(p) {
      return { x: p[0] * window.innerWidth, y: p[1] * window.innerHeight };
    }

    /* The mouse over the stage is a pointer for hovering. Pressing it is the
       viewer's (model.js): a still, short press comes back here as click();
       a press that travels turns or slides the model and never clicks. */
    _mouseEvents() {
      const stage = this.viewer.el;
      stage.addEventListener('pointermove', (e) => {
        if (e.target.closest('.asm-crumbs')) { this.mouse = null; return; }
        this.mouse = { x: e.clientX, y: e.clientY };
      });
      stage.addEventListener('pointerleave', () => { this.mouse = null; });
    }

    /* -------------------------------------------------------- the roll-ups */

    rollup(node) {
      let total = 0, count = 0, unknown = 0;
      const byMat = {}, countByMat = {}, groups = new Map();
      const walk = (n) => {
        if (n.kind === 'part') {
          const q = Number.isFinite(+n.data.qty) ? Math.max(0, Math.trunc(+n.data.qty)) : 1;
          const mat = String(n.data.material || '');
          count += q;
          countByMat[mat] = (countByMat[mat] || 0) + q;
          const key = String(n.data.part_no || n.name);
          if (!groups.has(key)) groups.set(key, { name: n.name, part_no: n.data.part_no, qty: 0, kg: 0, id: n.id });
          const g = groups.get(key);
          g.qty += q;
          const m = n.data.mass_kg;
          if (typeof m !== 'number') { unknown++; } else {
            total += m * q;
            byMat[mat] = (byMat[mat] || 0) + m * q;
            g.kg += m * q;
          }
        }
        n.children.forEach(walk);
      };
      walk(node);
      const heaviest = [...groups.values()].sort((a, b) => b.kg - a.kg || (a.name < b.name ? -1 : 1));
      return { mass_kg: total, parts: count, unique: groups.size, unknown, by_material: byMat,
               count_by_material: countByMat, heaviest };
    }

    /* ---------------------------------------------------------- the overlays */

    _overlays() {
      const stage = this.viewer.el;
      const make = (tag, cls) => {
        const el = document.createElement(tag);
        el.className = cls;
        el.hidden = true;
        stage.appendChild(el);
        return el;
      };
      this.cardEl = make('aside', 'asm-card');
      this.crumbEl = make('nav', 'asm-crumbs');
      this.captionEl = make('div', 'asm-caption');
      this.pointerEl = make('div', 'asm-pointer');
      this.crumbEl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b || !this.ready) return;
        const act = b.dataset.act;
        if (act === 'level') this.setState(this.path.slice(0, +b.dataset.i + 1), false);
        else if (act === 'explode') (this.exploded ? this.setState(this.path, false) : this.explode());
        else if (act === 'together') this.reassemble();
        else if (act === 'mass') this.setMasses(!this.masses);
      });
    }

    get massOn() { return this.showMass && this.masses; }

    _showCaption() {
      const text = (this.pkg && this.pkg.caption) || '';
      this.captionEl.textContent = text;
      this.captionEl.hidden = !text;
    }

    _crumbs() {
      if (!this.ready) { this.crumbEl.hidden = true; return; }
      const levels = this.path.map((n, i) =>
        `<button data-act="level" data-i="${i}" class="${i === this.path.length - 1 ? 'on' : ''}">${esc(n.name)}</button>`)
        .join('<i>›</i>');
      const tools = `<span class="asm-tools">` +
        `<button data-act="explode" class="${this.exploded ? 'on' : ''}">EXPLODE</button>` +
        `<button data-act="together">ASSEMBLE</button>` +
        (this.showMass ? `<button data-act="mass" class="${this.masses ? 'on' : ''}">MASS</button>` : '') +
        `</span>`;
      this.crumbEl.innerHTML = `<span class="asm-path">${levels}</span>${tools}`;
      this.crumbEl.hidden = false;
    }

    /* What the card is about: the piece under the pointer, else the piece
       taken out, else nothing. */
    cardNode() {
      if (this.hovered) return this.hovered;
      return this.path.length > 1 ? this.focus : null;
    }

    _card() {
      const n = this.ready ? this.cardNode() : null;
      if (!n) { this.cardEl.hidden = true; this.cardEl.innerHTML = ''; return; }
      this.cardEl.innerHTML = n.kind === 'part' ? this._partCard(n) : this._subCard(n);
      this.cardEl.hidden = false;
      this.cardEl.classList.toggle('picked', n === this.focus && !this.hovered);
    }

    _bar(segs) {
      const total = segs.reduce((a, s) => a + s.v, 0) || 1;
      return `<div class="asm-bar">` + segs.map((s) =>
        `<i style="width:${(100 * s.v / total).toFixed(2)}%;background:${esc(s.c)}" title="${esc(s.label)}"></i>`)
        .join('') + `</div>`;
    }

    _partCard(n) {
      const d = n.data, mat = this.materials[d.material] || {};
      const comp = (mat.composition || []).map((c) => ({ name: String(c[0]), pct: +c[1] }))
        .filter((c) => Number.isFinite(c.pct)).sort((a, b) => b.pct - a.pct);
      const colour = (c, i) => (/^other/i.test(c.name) ? '#5d6b73' : COMP_COLOURS[i % COMP_COLOURS.length]);
      const q = Number.isFinite(+d.qty) ? Math.max(0, Math.trunc(+d.qty)) : 1;
      const rows = [];
      if (this.massOn && typeof d.mass_kg === 'number') {
        rows.push(['mass', fmtKg(d.mass_kg) + (q > 1 ? ` each · × ${q} = ${fmtKg(d.mass_kg * q)}` : '') +
                   (d.mass_basis ? ` <em>${esc(d.mass_basis)}</em>` : '')]);
      } else if (q > 1) {
        rows.push(['quantity', `× ${q}`]);
      }
      if (typeof d.volume_cm3 === 'number') rows.push(['volume', `${+d.volume_cm3.toPrecision(4)} cm³` + (q > 1 ? ' each' : '')]);
      for (const [k, label] of [['route', 'route'], ['source', 'source'], ['assembly_op', 'assembly']]) {
        if (d[k]) rows.push([label, esc(d[k])]);
      }
      if (d.env) rows.push(['environment', esc(d.env)]);
      if (d.fos) rows.push(['load case', esc(d.fos)]);
      return `<header><b>${esc(n.name)}</b><span>${esc(d.part_no || 'PART')}</span></header>` +
        (d.function ? `<p class="asm-what">${esc(d.function)}</p>` : '') +
        `<div class="asm-mat"><i class="sw" style="background:${esc(mat.color || '#8fa3ad')}"></i>` +
        `${esc(mat.label || d.material || 'unknown material')}</div>` +
        (comp.length ? this._bar(comp.map((c, i) => ({ v: c.pct, c: colour(c, i), label: c.name }))) +
          `<ul class="asm-comp">` + comp.slice(0, 4).map((c, i) =>
            `<li><i class="sw" style="background:${colour(c, i)}"></i>${esc(c.name)}<b>${fmtPct(c.pct)}</b></li>`).join('') +
          `</ul>` + (mat.composition_basis ? `<p class="asm-basis">${esc(String(mat.composition_basis).slice(0, 90))}</p>` : '')
          : '') +
        `<dl>` + rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + `</dl>`;
    }

    _subCard(n) {
      const r = this.rollup(n);
      // Masses hidden, or none known: the same breakdown by part count.
      const byMass = this.massOn && r.mass_kg > 0;
      const mats = Object.keys(byMass ? r.by_material : r.count_by_material)
        .map((k) => ({ k, v: (byMass ? r.by_material : r.count_by_material)[k],
                       c: (this.materials[k] || {}).color || '#8fa3ad',
                       label: (this.materials[k] || {}).label || k || 'unknown' }))
        .filter((m) => m.v > 0).sort((a, b) => b.v - a.v);
      const sum = mats.reduce((a, m) => a + m.v, 0) || 1;
      const head = `<header><b>${esc(n.name)}</b><span>${n.kind === 'assembly' ? 'ASSEMBLY' : 'SUBASSEMBLY'}</span></header>` +
        (n.data.description ? `<p class="asm-what">${esc(n.data.description)}</p>` : '');
      const stats = `<div class="asm-stats">` +
        (this.massOn && r.mass_kg > 0 ? `<div><b>${fmtKg(r.mass_kg)}</b><span>total mass</span></div>` : '') +
        `<div><b>${r.parts}</b><span>parts${r.unique !== r.parts ? ` · ${r.unique} kinds` : ''}</span></div></div>`;
      const legend = `<ul class="asm-comp">` + mats.slice(0, 5).map((m) =>
        `<li><i class="sw" style="background:${esc(m.c)}"></i>${esc(m.label)}<b>` +
        (byMass ? `${fmtKg(m.v)} · ${fmtPct(100 * m.v / sum)}` : `${m.v} part${m.v === 1 ? '' : 's'}`) +
        `</b></li>`).join('') + `</ul>`;
      const list = byMass
        ? r.heaviest.filter((g) => g.kg > 0).slice(0, 5).map((g) =>
          `<li>${esc(g.name)}${g.qty > 1 ? ` × ${g.qty}` : ''}<b>${fmtKg(g.kg)}</b></li>`)
        : r.heaviest.slice().sort((a, b) => b.qty - a.qty || (a.name < b.name ? -1 : 1)).slice(0, 5).map((g) =>
          `<li>${esc(g.name)}<b>× ${g.qty}</b></li>`);
      return head + stats +
        `<h4>${byMass ? 'mass by material' : 'parts by material'}</h4>` +
        this._bar(mats.map((m) => ({ v: m.v, c: m.c, label: m.label }))) + legend +
        (list.length ? `<h4>${byMass ? 'heaviest parts' : 'parts'}</h4><ul class="asm-list">${list.join('')}</ul>` : '') +
        (this.massOn && r.unknown ? `<p class="asm-basis">${r.unknown} part${r.unknown === 1 ? '' : 's'} without a mass</p>` : '');
    }

    /* Tell the assistant what is on screen, so "what is that" and "the
       second one" mean what the person is looking at. Only on change. */
    _report() {
      if (!this.ready || !global.bus || !global.bus.send) return;
      const msg = { type: 'assembly_state', path: this.model.path, hovered: this.hovered ? this.hovered.id : null,
                    focus: this.path.map((n) => n.id), exploded: this.exploded, masses: this.masses };
      const key = JSON.stringify(msg);
      if (key === this._reported) return;
      this._reported = key;
      global.bus.send(msg);
    }

    /* ------------------------------------------------------- for the tests */

    /* Where each piece is now and where it was put together, in the
       assembly's own frame (mm), and what the card says. */
    debug() {
      const nodes = {};
      for (const n of this.nodes.values()) {
        const now = n.c0.clone();
        for (let p = n; p; p = p.parent) now.add(p.offset);
        let a = 1;
        for (let p = n; p; p = p.parent) a *= p.fade;
        nodes[n.id] = { at: now.toArray(), assembled: n.c0.toArray(), r: n.r, opacity: a };
      }
      return { path: this.path.map((n) => n.id), exploded: this.exploded, moving: !!this.anim,
               waiting: !!this.pendingClick,
               hovered: this.hovered && this.hovered.id, centre: this.C0.toArray(), nodes,
               card: this.cardEl.hidden ? '' : this.cardEl.innerText, masses: this.massOn,
               drawn: this.drawn, missing: this.missing };
    }

    /* A page point over a piece (or over nothing, for id null) at the current
       level, found by casting the same ray a pointer there would. */
    probe(id) {
      if (!this.ready) return null;
      this.viewer.scene.updateMatrixWorld();
      const want = id == null ? null : this.nodes.get(id);
      const rect = this.viewer.renderer.domElement.getBoundingClientRect();
      const v = new THREE.Vector3();
      if (want) {
        for (const n of this.nodes.values()) {
          if (!this.inside(n, want)) continue;
          for (const mesh of n.meshes) {
            const pos = mesh.geometry.attributes.position;
            const centre = mesh.geometry.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld);
            const step = Math.max(1, Math.floor(pos.count / 120));
            for (let i = 0; i < pos.count; i += step) {
              v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).lerp(centre, 0.15).project(this.viewer.camera);
              const pt = { x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height };
              if (document.elementFromPoint(pt.x, pt.y) === this.viewer.renderer.domElement &&
                  this.unitAt(pt) === want) return pt;
            }
          }
        }
        return null;
      }
      for (let gy = 0.1; gy < 0.95; gy += 0.08) {
        for (let gx = 0.08; gx < 0.95; gx += 0.07) {
          const pt = { x: rect.left + gx * rect.width, y: rect.top + gy * rect.height };
          const el = document.elementFromPoint(pt.x, pt.y);
          if (el === this.viewer.renderer.domElement && !this.unitAt(pt)) return pt;
        }
      }
      return null;
    }
  }

  global.AssemblyView = AssemblyView;
})(window);
