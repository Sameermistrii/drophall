import * as THREE from 'three';

/**
 * First-person walker, ported from the engine's `src/fps-controller.ts` and cut
 * down to what a heightfield world needs.
 *
 * There is nothing to collide with in this lab — no boxes, no ceilings, no
 * doorways — so the box resolver, the step-up gate and the ceiling resolver all
 * went. What survives is the part that decides how walking *feels*: the slope
 * rules, the split between "snap to ground" and "fall under gravity", and the
 * smoothed eye. That is exactly the part the old two-line mover had nothing of.
 *
 * The bug it replaces is worth recording. The old code rotated the input vector
 * by +yaw while the camera basis (`Euler(pitch, yaw, 0, 'YXZ')`) is built from
 * -yaw, so the movement frame was mirrored about Z. At yaw 0 it happened to
 * agree, which is why it looked fine from the spawn point; at yaw 90° W walked
 * you backwards.
 */

export const WALKER_DEFAULTS = {
  eyeHeight: 1.62,
  /** Used for the substep length and the gradient sample width, not collision. */
  radius: 0.35,
  walkSpeed: 4,
  runSpeed: 7,
  lookSensitivity: 0.0022,
  pitchClampDeg: 85,
  /** Steepest ground still climbable head-on. Above it you slide along instead. */
  maxSlopeDeg: 55,
  /** Largest drop the feet may follow without letting go and falling. */
  stepHeight: 0.45,
  gravity: 9.81,
  /** 4.14 m/s against 9.81 gives the same 0.87 m jump the engine has. */
  jumpSpeed: 4.14,
  crouchHeight: 0.95
};

/* ------------------------------------------------------------------ pure -- */

/**
 * Largest downward step the feet may follow rather than fall.
 *
 * The slope term keeps the walker off the side of a cliff; stepHeight is the
 * hard ceiling so a real drop always becomes a fall. The 25 mm skin absorbs
 * heightfield sampling noise.
 */
export function walkableGroundDrop(horizontalDistance, stepHeight) {
  const maxSlope = Math.tan((55 * Math.PI) / 180);
  return Math.min(
    Math.max(0, stepHeight),
    Math.max(0, horizontalDistance) * maxSlope + 0.025
  );
}

/**
 * Throws away the part of a step that climbs too steeply and KEEPS the part
 * that runs along the slope.
 *
 * Rejecting the step outright pins you to the hillside as if there were an
 * invisible wall. Only the climbing component breaks the rule; the sideways
 * component climbs nothing and there is no reason to hold it back.
 *
 * Below the limit nothing is touched. Above it the whole climbing component
 * goes, leaving motion along the contour — so walking straight at a steep face
 * still stops (there is no sideways component to slide on), but angling even
 * slightly makes you slide instead of freeze. Letting some of the climb through
 * would look tidier on paper and would also mean an 80° face can be beaten by
 * walking at it diagonally.
 */
export function slideAlongSlope(stepX, stepZ, gradientX, gradientZ, maxSlopeDeg, out) {
  out.x = stepX;
  out.z = stepZ;
  const gradient = Math.hypot(gradientX, gradientZ);
  const limit = Math.tan(Math.max(0, Math.min(89, maxSlopeDeg)) * Math.PI / 180);
  if (gradient <= limit || Math.hypot(stepX, stepZ) < 1e-9) return;
  const upX = gradientX / gradient;
  const upZ = gradientZ / gradient;
  const climb = stepX * upX + stepZ * upZ;
  if (climb <= 0) return;                    // descending, or already along it
  out.x = stepX - climb * upX;
  out.z = stepZ - climb * upZ;
}

/** Is this much rise over this much ground still inside the climb angle? */
export function slopeRiseWalkable(rise, horizontalDistance, maxSlopeDeg) {
  if (rise <= 0) return true;
  const distance = Math.max(0, horizontalDistance);
  const angle = Math.max(0, Math.min(89, maxSlopeDeg)) * Math.PI / 180;
  return rise <= Math.tan(angle) * distance + 1e-4;
}

export function verticalLookDelta(movementY, sensitivity, invertY) {
  return -movementY * sensitivity * (invertY ? -1 : 1);
}

/* ----------------------------------------------------------------- class -- */

export class Walker {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} domElement   the element that holds pointer lock
   * @param {(x:number,z:number)=>number} ground  world height, in metres
   * @param {Partial<typeof WALKER_DEFAULTS>} [opts]
   */
  constructor(camera, domElement, ground, opts = {}) {
    this.camera = camera;
    this.domElement = domElement;
    this.ground = ground;
    this.opts = { ...WALKER_DEFAULTS, ...opts };

    this.feet = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.invertY = false;

    this.velocityY = 0;
    this.grounded = true;
    this.crouching = false;
    /** Eye height above the feet; eases between standing and crouching. */
    this.stance = this.opts.eyeHeight;
    /**
     * Smoothed eye height, kept separate from the feet.
     *
     * Going up and coming down are different mechanisms: falling is gravity,
     * which is already smooth per frame, while climbing is an instant snap to
     * the ground under you. On a rolling field at run speed that snap lands
     * several times a second. The feet must keep snapping — anything else makes
     * the ground test wrong — so it is only the camera that gets smoothed.
     */
    this.eyeY = 0;

    this.enabled = false;
    this.keys = new Set();
    this.jumpPressed = false;

    this._step = { x: 0, z: 0 };
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._velocity = new THREE.Vector3();

    this._onKeyDown = (e) => {
      if (e.code === 'Space' && !this.keys.has('Space')) this.jumpPressed = true;
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (document.pointerLockElement !== this.domElement) return;
      this.look(e.movementX, e.movementY);
    };
  }

  /* --------------------------------------------------------------- setup -- */

  /** Adopts whatever the camera is currently doing, then takes over. */
  enable() {
    if (this.enabled) return;
    this.enabled = true;

    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    this._clampPitch();

    this.feet.set(
      this.camera.position.x,
      this.ground(this.camera.position.x, this.camera.position.z),
      this.camera.position.z
    );
    this.eyeY = this.feet.y;
    this.velocityY = 0;
    this.grounded = true;
    this.crouching = false;
    this.stance = this.opts.eyeHeight;

    // Guarded so the controller can be driven headless — see setKey(), and
    // tools/walker-check.mjs, which proves the movement basis without a DOM.
    if (typeof addEventListener === 'function') {
      addEventListener('keydown', this._onKeyDown);
      addEventListener('keyup', this._onKeyUp);
      addEventListener('mousemove', this._onMouseMove);
    }
    this._writeCamera();
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    if (typeof removeEventListener === 'function') {
      removeEventListener('keydown', this._onKeyDown);
      removeEventListener('keyup', this._onKeyUp);
      removeEventListener('mousemove', this._onMouseMove);
    }
    this.keys.clear();
    this.jumpPressed = false;
  }

  /** Synthetic key press, for headless proofs. */
  setKey(code, pressed) {
    if (!pressed) { this.keys.delete(code); return; }
    if (code === 'Space' && !this.keys.has('Space')) this.jumpPressed = true;
    this.keys.add(code);
  }

  look(dx, dy) {
    const s = this.opts.lookSensitivity;
    this.yaw -= dx * s;
    this.pitch += verticalLookDelta(dy, s, this.invertY);
    this._clampPitch();
  }

  _clampPitch() {
    const c = (this.opts.pitchClampDeg * Math.PI) / 180;
    this.pitch = Math.max(-c, Math.min(c, this.pitch));
  }

  /* -------------------------------------------------------------- update -- */

  update(dt) {
    if (!this.enabled) return;

    this._updateStance(dt);

    // The press is consumed whether or not it is served. Holding it means a
    // Space pressed mid-air is banked and fires on landing, which reads as an
    // unasked-for bounce.
    const jumpRequested = this.jumpPressed;
    this.jumpPressed = false;
    // Jump resolves BEFORE horizontal motion. After it, the per-substep ground
    // snap would put the feet straight back down and swallow the jump in the
    // same frame.
    if (this.opts.jumpSpeed > 0 && jumpRequested && this.grounded) {
      this.velocityY = this.opts.jumpSpeed;
      this.grounded = false;
    }

    const running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = (running && !this.crouching ? this.opts.runSpeed : this.opts.walkSpeed)
      * (this.crouching ? 0.45 : 1);

    // Input is gathered in BODY axes — forward and right — and only then
    // rotated into the world. Writing it this way is what makes the basis
    // impossible to mirror by accident: forward is (-sin, -cos) because that is
    // literally what `Euler(pitch, yaw, 0, 'YXZ')` points the camera at.
    let forward = 0;
    let right = 0;
    if (this.keys.has('KeyW')) forward += 1;
    if (this.keys.has('KeyS')) forward -= 1;
    if (this.keys.has('KeyD')) right += 1;
    if (this.keys.has('KeyA')) right -= 1;

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    let fx = -sinY * forward + cosY * right;
    let fz = -cosY * forward - sinY * right;

    const len = Math.hypot(fx, fz);
    if (len > 1e-6) {
      // Full press and keyboard diagonal both clamp to one, so W+D is not
      // faster than W.
      const scale = (speed * Math.min(1, len) * dt) / len;
      fx *= scale;
      fz *= scale;
    }

    const maxStep = this.opts.radius * 0.5;
    const dist = Math.hypot(fx, fz);
    const steps = Math.max(1, Math.ceil(dist / maxStep));
    const stepX = fx / steps;
    const stepZ = fz / steps;

    const beforeX = this.feet.x;
    const beforeZ = this.feet.z;

    // If the frame starts on the ground and is not a jump, the feet may follow
    // ground that falls away, within reason. Without this, gravity has to chase
    // every lower heightfield sample and you get a repeating airborne pulse all
    // the way across a gentle rise.
    const stick = this.grounded && this.velocityY <= 0;
    const groundDrop = stick
      ? walkableGroundDrop(Math.hypot(stepX, stepZ), this.opts.stepHeight)
      : 0;

    for (let s = 0; s < steps; s++) {
      this._step.x = stepX;
      this._step.z = stepZ;
      if (stick) {
        this._slideDownSlope(stepX, stepZ);
        // The gradient is sampled at radius scale, which smooths thin ridges
        // away; the real step test below catches whatever slips through.
        if (!this._terrainStepWalkable(this._step.x, this._step.z)) {
          this._step.x = 0;
          this._step.z = 0;
        }
      }
      this.feet.x += this._step.x;
      this.feet.z += this._step.z;
      // Height resolves EVERY substep, not once at the end: the feet have to be
      // up on this rise before the next one is measured, or the next one reads
      // too tall and you stall on the first.
      this._resolveGround(groundDrop);
    }

    this._velocity.set(
      (this.feet.x - beforeX) / Math.max(dt, 1e-4),
      0,
      (this.feet.z - beforeZ) / Math.max(dt, 1e-4)
    );

    this._applyGravity(dt);

    // 70 ms: long enough to melt the ground snaps, short enough that falling
    // does not feel like floating.
    const k = 1 - Math.exp(-dt / 0.07);
    this.eyeY += (this.feet.y - this.eyeY) * k;
    if (Math.abs(this.feet.y - this.eyeY) < 1e-4) this.eyeY = this.feet.y;

    this._writeCamera();
  }

  /* ------------------------------------------------------------ internals -- */

  /**
   * Stand↔crouch easing. There are no ceilings here, so standing is never
   * refused — the engine's headroom test has nothing to test against.
   */
  _updateStance(dt) {
    this.crouching = this.keys.has('ControlLeft') || this.keys.has('KeyC');
    const target = this.crouching ? this.opts.crouchHeight : this.opts.eyeHeight;
    const k = 1 - Math.exp(-dt / 0.09);
    this.stance += (target - this.stance) * k;
    if (Math.abs(target - this.stance) < 1e-3) this.stance = target;
  }

  _slideDownSlope(stepX, stepZ) {
    const { x, z } = this.feet;
    const d = Math.max(0.2, this.opts.radius);
    slideAlongSlope(
      stepX,
      stepZ,
      (this.ground(x + d, z) - this.ground(x - d, z)) / (2 * d),
      (this.ground(x, z + d) - this.ground(x, z - d)) / (2 * d),
      this.opts.maxSlopeDeg,
      this._step
    );
  }

  /**
   * Is one whole horizontal step still inside the climb angle? Descending is
   * always allowed, so you never get locked on a slope you can still slither
   * down; only over-steep climbing is held back.
   */
  _terrainStepWalkable(dx, dz) {
    const distance = Math.hypot(dx, dz);
    if (distance <= 1e-8) return true;
    const rise = this.ground(this.feet.x + dx, this.feet.z + dz)
      - this.ground(this.feet.x, this.feet.z);
    return slopeRiseWalkable(rise, distance, this.opts.maxSlopeDeg);
  }

  /**
   * Snap up onto ground instantly; follow small drops while they stay inside
   * the walkable limit. Bigger drops are left to gravity, so a lip does not
   * feel magnetic.
   *
   * While moving UP the snap is skipped entirely. Without that exception a jump
   * never happens: the feet are still touching on the frame Space is pressed,
   * so they are pinned back down and the jump velocity is zeroed.
   */
  _resolveGround(maxDrop = 0) {
    if (this.velocityY > 0) return;
    const support = this.ground(this.feet.x, this.feet.z);
    if (support >= this.feet.y - maxDrop - 1e-4) {
      this.feet.y = support;
      this.velocityY = 0;
      this.grounded = true;
    }
  }

  _applyGravity(dt) {
    const support = this.ground(this.feet.x, this.feet.z);
    if (this.velocityY <= 0 && this.feet.y <= support + 1e-4) {
      this.feet.y = support;
      this.velocityY = 0;
      this.grounded = true;
      return;
    }
    this.grounded = false;
    this.velocityY -= this.opts.gravity * dt;
    this.feet.y += this.velocityY * dt;
    if (this.feet.y < support) {
      this.feet.y = support;
      this.velocityY = 0;
      this.grounded = true;
    }
  }

  _writeCamera() {
    this.camera.position.set(this.feet.x, this.eyeY + this.stance, this.feet.z);
    this._euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this._euler);
  }

  /* --------------------------------------------------------------- query -- */

  /** Ground speed actually achieved this frame, m/s. */
  get speed() {
    return Math.hypot(this._velocity.x, this._velocity.z);
  }

  dispose() {
    this.disable();
  }
}
