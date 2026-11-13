import * as THREE from "three";

/**
 * Rain on the far side of the pane, kept as a small texture the glass
 * shader reads: red/green say which way each drop's surface tilts (a drop
 * is a little lens), blue says how wet the glass is there (wet frosted
 * glass turns clear).
 *
 * Showers come and go by themselves while they're allowed: 15–20 seconds
 * of rain, then a long dry spell. Small droplets collect and sit. Now and
 * then a bigger one gets heavy enough to run — in fits and starts,
 * swallowing droplets in its path and leaving a thin trail that beads up
 * and dries behind it. When the shower ends everything slowly dries off.
 *
 * It costs nothing while the pane is dry: update() returns false and the
 * shader skips the lookup.
 */

const W = 1024;
const H = 600;
/** The stretch of pane the texture covers, in world units (centred). */
export const RAIN_AREA = [9.6, 5.6];

const MAX_DROPLETS = 500;

export function createRain() {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  // trails live on their own layer: it carries over between frames and
  // slowly fades, while droplets and runners are redrawn every frame
  const trailCanvas = makeCanvas();
  const trail = trailCanvas.getContext("2d");
  const drop = makeDropSprite();

  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;

  let droplets = []; // { x, y, r, dry }
  let runners = []; // { x, y, r, vx, vy, stuck, bead }
  let showerLength = 0;
  let showerLeft = 0; // seconds of rain still to fall
  let dryFor = rand(3, 6); // seconds until the next shower
  let toSpawn = 0;
  let trailAge = Infinity; // seconds since a trail was last laid
  let fadeTimer = 0;

  const addDroplet = (x, y, r) => {
    if (droplets.length < MAX_DROPLETS) {
      droplets.push({ x, y, r, dry: rand(0.06, 0.18) });
    }
  };

  /** Advance by dt seconds. Returns whether any of the pane is wet. */
  function update(dt, allowed) {
    if (!allowed) {
      showerLeft = 0;
    } else if (showerLeft > 0) {
      showerLeft -= dt;
    } else if ((dryFor -= dt) <= 0) {
      showerLength = showerLeft = rand(15, 20);
      dryFor = rand(40, 90);
    }
    const raining = showerLeft > 0;
    // builds over the first few seconds and eases off over the last few
    const intensity = raining
      ? Math.min(1, (showerLength - showerLeft) / 3, showerLeft / 3)
      : 0;

    toSpawn += 70 * intensity * dt;
    for (; toSpawn >= 1; toSpawn--) {
      addDroplet(rand(0, W), rand(0, H), 1.2 + Math.random() ** 2 * 2);
    }
    if (Math.random() < 1.1 * intensity * dt) {
      runners.push({
        x: rand(0, W),
        y: rand(-10, H * 0.5),
        r: rand(3.6, 5),
        vx: 0,
        vy: 0,
        stuck: rand(0.3, 1.5), // sits and gathers before it lets go
        bead: 0,
      });
    }

    // once the rain stops, droplets dry out
    if (!raining) {
      droplets.forEach((d) => (d.r -= d.dry * dt));
      droplets = droplets.filter((d) => d.r > 0.6);
    }

    runners.forEach((run) => {
      if (run.stuck > 0) {
        run.stuck -= dt;
        return;
      }
      // heavier drops run faster; all of them wander a little sideways
      run.vy += (run.r * 24 - run.vy) * Math.min(dt * 3, 1);
      run.vx = (run.vx + rand(-40, 40) * dt) * 0.92;
      const step = run.vy * dt;
      run.x += run.vx * dt;
      run.y += step;

      // it leaves a thin wet trail, and loses a little water doing so
      const width = run.r * 0.8;
      trail.globalAlpha = 0.5; // a film of water, thinner than a drop
      trail.drawImage(drop, run.x - width / 2, run.y - run.r, width, run.r * 1.2);
      trail.globalAlpha = 1;
      trailAge = 0;
      run.r -= step * 0.003;
      run.bead -= step;
      if (run.bead <= 0) {
        // ...which breaks up into beads behind it
        addDroplet(run.x + rand(-1, 1), run.y - run.r * 1.6, rand(0.8, 1.4));
        run.bead = rand(20, 60);
      }

      // it swallows the droplets in its way
      droplets = droplets.filter((d) => {
        const hit = Math.hypot(d.x - run.x, d.y - run.y) < run.r + d.r * 0.5;
        if (hit) run.r = Math.min(run.r + d.r * 0.08, 6);
        return !hit;
      });

      // and now and then catches on the glass and waits
      if (Math.random() < 0.5 * dt) {
        run.stuck = rand(0.2, 1.2);
        run.vy = 0;
      }
    });
    runners = runners.filter((run) => {
      if (run.r < 1.8) addDroplet(run.x, run.y, run.r); // ran dry: stays put
      return run.r >= 1.8 && run.y - run.r < H;
    });

    // trails dry: fade their layer a little, ten times a second
    trailAge += dt;
    fadeTimer += dt;
    if (fadeTimer > 0.1) {
      fadeTimer = 0;
      trail.globalCompositeOperation = "destination-out";
      trail.fillStyle = "rgba(0,0,0,0.035)";
      trail.fillRect(0, 0, W, H);
      trail.globalCompositeOperation = "source-over";
    }

    const wet = droplets.length > 0 || runners.length > 0 || trailAge < 8;
    if (!wet) return false;

    ctx.fillStyle = "rgb(128,128,0)"; // flat and dry
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(trailCanvas, 0, 0);
    droplets.forEach((d) =>
      ctx.drawImage(drop, d.x - d.r, d.y - d.r, d.r * 2, d.r * 2),
    );
    // runners are a little taller than wide, like a hanging drop
    runners.forEach((run) =>
      ctx.drawImage(drop, run.x - run.r, run.y - run.r * 1.25, run.r * 2, run.r * 2.5),
    );
    texture.needsUpdate = true;
    return true;
  }

  return { texture, update };
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function makeCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  return canvas;
}

/**
 * One drop, drawn at any size: red/green tilt outward from the centre to
 * the rim (128 = flat), blue is wetness, fading out over the outer half so
 * the drop reads as a soft blob — it's seen through frosted glass.
 */
function makeDropSprite() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const ny = ((y + 0.5) / size) * 2 - 1;
      const d = Math.hypot(nx, ny);
      const o = (y * size + x) * 4;
      img.data[o] = 127.5 + nx * 127.5;
      img.data[o + 1] = 127.5 + ny * 127.5;
      img.data[o + 2] = 255;
      img.data[o + 3] = Math.min(Math.max((1 - d) / 0.5, 0), 1) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
