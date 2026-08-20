import * as THREE from "three"
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/* The printable zone is the front of the guard, which faces +Z in this model.
 * A vertex only receives artwork if its normal points forward enough — this is
 * the cutoff, where 1 is dead-on and 0 is side-on.
 *
 * 0.10 (about 84 degrees off-centre) wraps artwork around the curve until the
 * geometry runs out, giving 99% of the canvas width as usable surface. At 0.25
 * it was 90%, and designs dragged toward the edges vanished. The cost is that
 * artwork near the extreme edges sits on steeply angled surface and stretches —
 * unavoidable with a flat projection, and those edges are cropped in production. */
const FRONT_FACING_MIN = 0.10;

/* Facing forward isn't enough on its own: the inner face of the guard's back
 * wall also looks forward, and artwork was landing there, readable from above.
 * So a vertex must also sit within this much of the frontmost surface in its
 * slice, as a fraction of the model's depth. The two shells are about 0.15
 * apart on this model, so 0.10 separates them with room to spare. */
const FRONT_DEPTH_TOLERANCE = 0.10;
const DEPTH_SLICES = 64;

/* Artwork lives on a clone of the model rendered just in front of the body.
 * These nudge it forward in the depth buffer so it never z-fights. */
const ARTWORK_DEPTH_OFFSET = -1;

// How much empty space to leave around the model when framing it. 1 = the model
// exactly fills the frame, so anything above 1 is breathing room.
const FRAMING_PADDING = 1.3;

// Length of the glide back to the front view, in milliseconds.
const FOCUS_DURATION = 500;

/* The .glb is modelled facing 18 degrees away from +Z, so a straight-on camera
 * sees it three-quarters on. Measured from the mesh: the U's opening spans
 * 138-186 degrees around the centroid, centred at 162, so the arch's front
 * points at -18. Rotating by +18 squares it up to the camera.
 * Set to 0 if the model is ever re-exported facing forward. */
const MODEL_ALIGN_ROTATION_Y = 18 * Math.PI / 180;

/* Where the Draco decoder lives. Served from this site alongside the matching
 * three.js build — a decoder from a different release can fail to read geometry
 * written by this one, and a CDN copy would be third-party code with no
 * integrity check running on the page. */
const DRACO_DECODER_PATH = '/vendor/three/addons/libs/draco/';

export class MouthguardDesigner {
  constructor(container) {
    this.container = container;

    /* True when this browser can't give us WebGL. Every method below returns
     * early in that state, so the page keeps working without a 3D preview.
     *
     * This matters more than it looks: designing is the only route to placing
     * an order, and constructing the renderer used to throw straight out of
     * the module — taking the design tools, the Continue button and the whole
     * booking down with it. An old phone, hardware acceleration switched off,
     * or a locked-down in-app browser would lose the customer with no trace.
     * A guard designed without the preview is still a perfectly good order. */
    this.disabled = false;

    /* Resolves once the guard is on screen, or once it's certain there won't be
     * one. Created first so it exists even on the failure path. */
    this.ready = new Promise((resolve) => { this.markReady = resolve; });

    this.scene = new THREE.Scene()

    this.camera = new THREE.PerspectiveCamera(75, this.container.clientWidth / this.container.clientHeight, 0.1, 1000);
    this.camera.position.z = 1.5;

    try {
      /* preserveDrawingBuffer keeps the rendered frame readable after the
       * browser has composited it, which is what snapshot() needs. Without it
       * toDataURL() returns a blank image on most drivers. */
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
      })
    } catch (error) {
      console.error('WebGL is unavailable, continuing without the 3D preview:', error);
      this.disableWithoutWebGL();
      return;
    }

    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight)
    container.appendChild(this.renderer.domElement)

    const ambientLights = new THREE.AmbientLight(0xffffff, 0.55)
    this.scene.add(ambientLights)

    /* A DirectionalLight shines from its position toward the origin, and the
     * default position lights the guard from straight above — which leaves the
     * front face, the only one that carries artwork, almost unlit. Put the key
     * light on the camera's side and slightly above. */
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.85)
    keyLight.position.set(0.4, 1, 2)
    this.scene.add(keyLight)

    // A weaker light from below-left keeps the curves readable instead of
    // flattening into one bright face.
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.25)
    fillLight.position.set(-1.5, -0.5, 1)
    this.scene.add(fillLight)

    // Meshes that carry the guard's colour, kept apart from the artwork layer
    // so setColor() never tints the customer's design.
    this.bodyMeshes = [];
    this.artworkMeshes = [];
    this.artworkTexture = null;

    // The model loads asynchronously, so the UI may hand us a canvas before it
    // arrives. Park it here and apply it once the model is ready.
    this.pendingCanvas = null;

    /* The guard is Draco-compressed: 12 MB of raw mesh down to 1 MB. That
     * matters because designing is the only way to place an order, so this
     * download sits directly in front of every customer — it was around twenty
     * seconds on a phone connection before.
     *
     * The decoder comes from the same CDN as three.js itself, and is only
     * fetched when a compressed model is actually being read. If the .glb is
     * ever re-exported uncompressed, this keeps working unchanged. */
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);

    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);

    loader.load(
      'assets/mouthguard.glb',
      (gltf) => {
        this.model = gltf.scene;
        this.scene.add(this.model);

        this.model.traverse((child) => {
          if (child.isMesh) this.bodyMeshes.push(child);
        });

        // Square the guard up to the camera before anything measures it.
        this.model.rotation.y = MODEL_ALIGN_ROTATION_Y;

        // The .glb ships with no UVs at all, so we generate them here.
        this.projectFrontUVs();

        // The model's own origin sits at the bottom of the guard, not its middle,
        // so without this it renders off-centre and too small.
        this.frameModel();

        if (this.pendingColor) {
          this.setColor(this.pendingColor);
          this.pendingColor = null;
        }

        if (this.pendingCanvas) {
          this.applyCanvasTexture(this.pendingCanvas);
          this.pendingCanvas = null;
        }

        this.markReady();
      },
      undefined,
      (error) => {
        console.error('Failed to load model:', error);

        // Still "ready" — there is nothing further to wait for.
        this.markReady();
      }
    );
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));


    this.controls = new OrbitControls(this.camera, this.renderer.domElement)

    window.addEventListener('resize', () => this.handleResize());

    this.animate();
  }

  /* Puts the viewport into its no-WebGL state: an explanation in place of the
   * guard, and every method below turned into a no-op. The design tools, the
   * print file and the booking all carry on working. */
  disableWithoutWebGL() {
    this.disabled = true;

    const notice = document.createElement('p');
    notice.className = 'designer-no-3d';
    notice.textContent =
      'Your browser can\'t show the 3D preview, but you can still design your ' +
      'guard and place your order. Everything below works as normal.';

    this.container.appendChild(notice);

    this.markReady();
  }

  /* Walks every front-facing vertex and records how far forward the guard
   * reaches in each vertical slice — the depth of its outer shell.
   *
   * Needed because a mouthguard is two walls with a channel between them, and
   * the inner face of the back wall looks forward just like the outer face of
   * the front wall does. Facing direction alone can't tell them apart; depth
   * can. On this model the outer shell sits around z 0.48 and the inner wall
   * around z 0.30, with nothing in between.
   */
  measureFrontDepth(box, size) {
    const depths = new Array(DEPTH_SLICES).fill(-Infinity);

    const position = new THREE.Vector3();
    const normal = new THREE.Vector3();

    this.bodyMeshes.forEach((mesh) => {
      const positions = mesh.geometry.attributes.position;
      const normals = mesh.geometry.attributes.normal;
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);

      for (let i = 0; i < positions.count; i++) {
        normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();
        if (normal.z < FRONT_FACING_MIN) continue;

        position.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);

        const slice = Math.min(
          DEPTH_SLICES - 1,
          Math.floor((position.x - box.min.x) / size.x * DEPTH_SLICES)
        );
        if (position.z > depths[slice]) depths[slice] = position.z;
      }
    });

    return depths;
  }

  /* Gives every vertex a UV coordinate by projecting the model flat against its
   * own front. Think of shining a projector at the guard from +Z: a vertex's
   * left-to-right position becomes u, its bottom-to-top position becomes v.
   *
   * A vertex only receives artwork if it both faces forward AND belongs to the
   * outer shell. Everything else is pushed outside the 0–1 range on purpose:
   * combined with ClampToEdgeWrapping in applyCanvasTexture(), those vertices
   * sample the transparent edge of the canvas, so nothing appears on the back,
   * the sides, or inside the channel where the teeth go.
   */
  projectFrontUVs() {
    if (!this.model) return;

    this.model.updateMatrixWorld(true);

    // One shared box for the whole model, so multiple meshes map into the same
    // texture rather than each stretching to fill it.
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());

    const frontDepth = this.measureFrontDepth(box, size);
    const depthTolerance = size.z * FRONT_DEPTH_TOLERANCE;

    const position = new THREE.Vector3();
    const normal = new THREE.Vector3();

    this.bodyMeshes.forEach((mesh) => {
      const geometry = mesh.geometry;
      const positions = geometry.attributes.position;
      const normals = geometry.attributes.normal;

      const uvs = new Float32Array(positions.count * 2);

      // Normals need their own matrix — scaling a model would otherwise skew them.
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);

      for (let i = 0; i < positions.count; i++) {
        position.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize();

        const slice = Math.min(
          DEPTH_SLICES - 1,
          Math.floor((position.x - box.min.x) / size.x * DEPTH_SLICES)
        );

        const facesFront = normal.z >= FRONT_FACING_MIN;
        const isOuterShell = position.z >= frontDepth[slice] - depthTolerance;

        if (!facesFront || !isOuterShell) {
          // Facing away, or tucked behind the outer shell: park it off-canvas.
          uvs[i * 2] = -0.05;
          uvs[i * 2 + 1] = -0.05;
          continue;
        }

        uvs[i * 2] = (position.x - box.min.x) / size.x;
        uvs[i * 2 + 1] = (position.y - box.min.y) / size.y;
      }

      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    });
  }

  /* Points the camera at the middle of the model and backs it off far enough to
   * fit the whole thing on screen, viewed from the front (+Z). Also remembers
   * this as the "home" view so focusFront() can return to it later. */
  frameModel() {
    if (this.disabled || !this.model) return;

    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Trigonometry: how far back the camera must sit for the model to fill the
    // frame, checked against both the vertical and horizontal field of view.
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitHeight = size.y / (2 * Math.tan(verticalFov / 2));
    const fitWidth = size.x / (2 * Math.tan(verticalFov / 2) * this.camera.aspect);
    // Half the depth, because the camera must clear the front of the guard —
    // the fit distance above is measured from its middle.
    const distance = FRAMING_PADDING * Math.max(fitHeight, fitWidth) + size.z / 2;

    this.homeTarget = center.clone();
    this.homePosition = new THREE.Vector3(center.x, center.y, center.z + distance);

    // Clipping planes scaled to the model, so it never gets sliced or z-fights.
    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();

    this.camera.position.copy(this.homePosition);
    this.controls.target.copy(this.homeTarget);
    this.controls.update();
  }

  /* Glides the camera back to the straight-on front view — the angle where the
   * print zone is actually visible. Call it when a design tool opens. */
  focusFront() {
    if (this.disabled || !this.homePosition) return;

    this.focusTween = {
      startedAt: performance.now(),
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone()
    };
  }

  /* Runs one frame of the glide, if one is in progress. */
  updateFocusTween() {
    if (!this.focusTween) return;

    const elapsed = performance.now() - this.focusTween.startedAt;
    const progress = Math.min(elapsed / FOCUS_DURATION, 1);

    // Smoothstep: ease in and out rather than a mechanical linear slide.
    const eased = progress * progress * (3 - 2 * progress);

    this.camera.position.lerpVectors(this.focusTween.fromPosition, this.homePosition, eased);
    this.controls.target.lerpVectors(this.focusTween.fromTarget, this.homeTarget, eased);

    if (progress === 1) this.focusTween = null;
  }

  /* Keeps the render sharp when the window or panel changes size. */
  handleResize() {
    if (this.disabled) return;

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /* Takes the Fabric canvas element and wears it as artwork on the front face.
   * Call refreshTexture() afterwards whenever the canvas changes. */
  applyCanvasTexture(canvas) {
    if (this.disabled) return;

    if (!this.model) {
      // Model still loading — remember it and apply on arrival.
      this.pendingCanvas = canvas;
      return;
    }

    this.clearArtwork();

    const texture = new THREE.CanvasTexture(canvas);

    // Anything sampling outside 0–1 gets the canvas's outermost pixel. Those are
    // transparent, which is what hides artwork on the back and sides.
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;

    // Without this the artwork renders washed out — canvas pixels are sRGB.
    texture.colorSpace = THREE.SRGBColorSpace;

    // Keeps text readable when the guard is rotated to a steep angle.
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    this.artworkTexture = texture;

    this.bodyMeshes.forEach((mesh) => {
      // clone() reuses the same geometry rather than copying 250k vertices,
      // so this is cheap despite the model being heavy.
      const artwork = mesh.clone();

      artwork.material = new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        // Left white so the artwork keeps its own colours — the guard's colour
        // is on the body mesh underneath, showing through the transparent parts.
        color: 0xffffff,
        roughness: 0.55,
        metalness: 0,
        // Don't let the invisible parts of the layer occlude anything.
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: ARTWORK_DEPTH_OFFSET,
        polygonOffsetUnits: ARTWORK_DEPTH_OFFSET
      });

      // Sibling of the body mesh, so it inherits the same transforms.
      (mesh.parent || this.model).add(artwork);
      this.artworkMeshes.push(artwork);
    });
  }

  /* Tells three.js to re-upload the canvas to the GPU. Cheap — it only flags
   * the texture, the actual upload happens on the next render. */
  refreshTexture() {
    if (this.disabled) return;

    if (this.artworkTexture) this.artworkTexture.needsUpdate = true;
  }

  clearArtwork() {
    this.artworkMeshes.forEach((mesh) => {
      mesh.parent.remove(mesh);
      mesh.material.dispose();
    });
    this.artworkMeshes = [];

    if (this.artworkTexture) {
      this.artworkTexture.dispose();
      this.artworkTexture = null;
    }
  }

  setColor(hex){
    if (this.disabled) return;

    if (!this.model) {
      // Same async trap as the canvas: the UI can pick a colour before the
      // model exists. Remember it and apply on arrival.
      this.pendingColor = hex;
      return;
    }

    // Only the body — the artwork layer keeps its own colours.
    this.bodyMeshes.forEach((mesh) => {
      mesh.material.color.set(hex)
    })
  }

  /* A still of the guard, seen head on, as a PNG data URL.
   *
   * Always shot from the home view rather than wherever the customer happened
   * to leave the camera, so every order in the dashboard is framed the same way
   * and the list reads as a set. The camera is put back immediately, inside the
   * same frame, so nothing visible moves.
   */
  snapshot(width = 480) {
    if (this.disabled || !this.model || !this.homePosition) return null;

    const position = this.camera.position.clone();
    const target = this.controls.target.clone();

    this.camera.position.copy(this.homePosition);
    this.controls.target.copy(this.homeTarget);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    const source = this.renderer.domElement;
    const thumbnail = document.createElement('canvas');
    thumbnail.width = width;
    thumbnail.height = Math.round(width * source.height / source.width);
    thumbnail.getContext('2d').drawImage(source, 0, 0, thumbnail.width, thumbnail.height);

    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.controls.update();

    return thumbnail.toDataURL('image/png');
  }

  /* View mode: the order is already placed, so the camera still turns but the
   * guard can no longer be zoomed out to nothing or panned off screen. */
  lockToViewing() {
    if (this.disabled) return;

    this.controls.enablePan = false;
  }

  animate = () => {
    if (this.disabled) return;

    requestAnimationFrame(this.animate);
    this.updateFocusTween();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
