import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/**
 * A full-page Three.js background: a pane of hammered, wired glass with a
 * plant climbing behind it.
 *
 * The glass is a MeshPhysicalMaterial with full transmission. Roughness
 * blurs whatever is behind it (the frost), a generated normal map dimples
 * the surface so the leaves wobble through it, and a glossy clearcoat on
 * the same dimples catches a light in front of the pane as a sparkly
 * glare. A thin wire grid sits on the front face.
 *
 * In the hero you can drag to tilt the view (mouse only — on touch the
 * page just scrolls), which slides the glare and the leaves against each
 * other. Scrolling past the hero thickens the frost and turns the glass
 * milkier so the content sections sit on a calmer pane, and the sun moves
 * from morning to dusk across the whole page.
 */

const GLASS_W = 30;
const GLASS_H = 20;

export default function SceneBackground({ isDark = false }) {
  const mountRef = useRef(null);
  const scrollRef = useRef({ page: 0, hero: 0 });
  const isDarkRef = useRef(isDark);

  useEffect(() => {
    isDarkRef.current = isDark;
  }, [isDark]);

  // Track scroll in a ref (not state) so we don't trigger React re-renders
  // on every scroll tick — the animate loop reads it.
  //   page: 0–1 across the whole document (drives time of day)
  //   hero: 0–1 over the first screen (drives how much the frost thickens)
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      scrollRef.current.page = max > 0 ? clamp01(window.scrollY / max) : 0;
      scrollRef.current.hero = clamp01(window.scrollY / window.innerHeight);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let width = window.innerWidth;
    let height = window.innerHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    // transmission renders the scene behind the glass a second time, so
    // keep the pixel count in check on high-density screens
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    mount.appendChild(renderer.domElement);

    // ---- environment: three's built-in studio room, for reflections ----
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment(renderer);
    const envTexture = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    scene.environment = envTexture;

    // ---- lights ----
    const hemi = new THREE.HemisphereLight(0xf4f8ec, 0x2c3a20, 1);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1d6, 2);
    scene.add(sun);

    // sits in front of the pane — its reflection off the dimpled clearcoat
    // is the bright glare patch, and it moves as you tilt the view
    const glare = new THREE.PointLight(0xfff4e0, 20, 0, 2);
    scene.add(glare);

    // ---- backdrop: bright sky on the left, deep foliage shade on the right ----
    const backdropTex = makeBackdropTexture();
    const backdropMat = new THREE.MeshBasicMaterial({ map: backdropTex });
    const backdropGeo = new THREE.PlaneGeometry(40, 26);
    const backdrop = new THREE.Mesh(backdropGeo, backdropMat);
    backdrop.position.z = -7;
    backdrop.renderOrder = -2;
    scene.add(backdrop);

    // the sun (or moon) behind the plant: a soft, over-bright glow that the
    // frost spreads into the big hotspot, with leaves silhouetted against it.
    // Additive but not `transparent`, so it stays in the opaque pass that
    // the glass blurs; drawn after the backdrop, before the leaves.
    const sunTex = makeRadialTexture(128, [
      [0, "rgba(255,255,255,1)"],
      [0.25, "rgba(255,255,255,0.8)"],
      [0.6, "rgba(255,255,255,0.18)"],
      [1, "rgba(255,255,255,0)"],
    ]);
    const sunGlowGeo = new THREE.PlaneGeometry(9, 9);
    const sunGlowMat = new THREE.MeshBasicMaterial({
      map: sunTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sunGlow = new THREE.Mesh(sunGlowGeo, sunGlowMat);
    sunGlow.renderOrder = -1;
    scene.add(sunGlow);

    // ---- the plant: instanced leaves along a few climbing vines ----
    const leafData = makeLeafLayout();
    const leafTex = makeLeafTexture();
    const leafGeo = new THREE.PlaneGeometry(1, 1, 4, 4);
    leafGeo.translate(0, 0.5, 0); // pivot at the stem end
    const leafPos = leafGeo.attributes.position;
    for (let i = 0; i < leafPos.count; i++) {
      // cup the leaf slightly so light shades across it
      const x = leafPos.getX(i);
      leafPos.setZ(i, -x * x * 0.6);
    }
    leafGeo.computeVertexNormals();
    const leafMat = new THREE.MeshStandardMaterial({
      map: leafTex,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.55,
      envMapIntensity: 0.3,
    });
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, leafData.length);
    leafData.forEach((leaf, i) => leaves.setColorAt(i, leaf.color));
    scene.add(leaves);

    // ---- the glass pane ----
    const bumpTex = makeHammeredNormalMap(512);
    bumpTex.repeat.set(GLASS_W / 2.4, GLASS_H / 2.4);
    const frostTex = makeFrostMap(256);
    frostTex.repeat.set(4, 3);

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 1,
      thickness: 0.8,
      ior: 1.5,
      roughness: 0.5,
      roughnessMap: frostTex,
      normalMap: bumpTex,
      normalScale: new THREE.Vector2(0.5, 0.5),
      clearcoat: 1,
      clearcoatRoughness: 0.2,
      clearcoatNormalMap: bumpTex,
      clearcoatNormalScale: new THREE.Vector2(0.8, 0.8),
    });
    const glassGeo = new THREE.PlaneGeometry(GLASS_W, GLASS_H);
    scene.add(new THREE.Mesh(glassGeo, glassMat));

    // ---- wire grid on the front face ----
    const gridGeo = makeGridGeometry(GLASS_W, GLASS_H, 0.17);
    const gridMat = new THREE.LineBasicMaterial({
      color: 0xe8eee4,
      transparent: true,
      opacity: 0.35,
    });
    const grid = new THREE.LineSegments(gridGeo, gridMat);
    grid.position.z = 0.01;
    scene.add(grid);

    // ---- drag to tilt, in the hero only, mouse only ----
    // The canvas sits under the page content, so it never gets pointer
    // events itself; Hero renders a #glass-drag layer for this instead.
    const dragEl = document.getElementById("glass-drag");
    let controls = null;
    if (dragEl && window.matchMedia("(pointer: fine)").matches) {
      controls = new OrbitControls(camera, dragEl);
      controls.enableZoom = false;
      controls.enablePan = false;
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.rotateSpeed = 0.35;
      controls.minAzimuthAngle = -0.45;
      controls.maxAzimuthAngle = 0.45;
      controls.minPolarAngle = Math.PI / 2 - 0.3;
      controls.maxPolarAngle = Math.PI / 2 + 0.3;
      // OrbitControls blocks touch scrolling on its element; laptops with
      // touchscreens still need to swipe the page up past the hero
      dragEl.style.touchAction = "pan-y";
    }

    // ---- day / night ----
    // `night` eases toward 0 (light theme) or 1 (dark theme) each frame
    // and every themed value lerps on it, so toggling fades, not snaps.
    let night = isDarkRef.current ? 1 : 0;
    const NIGHT_BACKDROP = new THREE.Color(0.09, 0.12, 0.17);
    const WHITE = new THREE.Color(1, 1, 1);
    const GRID_DAY = new THREE.Color(0xe8eee4);
    const GRID_NIGHT = new THREE.Color(0x8a96a8);
    const MOON = new THREE.Color(0xa9c1ff);
    const colorMorning = new THREE.Color(0xdfe9ff);
    const colorMidday = new THREE.Color(0xfff1d6);
    const colorDusk = new THREE.Color(0xffb27a);
    const timeColor = new THREE.Color();

    const dummy = new THREE.Object3D();
    let frameId;
    let t = 0;
    const speed = prefersReduced ? 0.12 : 1;

    const animate = () => {
      t += 0.006 * speed;
      const { page: p, hero: h } = scrollRef.current;
      night += ((isDarkRef.current ? 1 : 0) - night) * 0.04;
      const mix = (day, dark) => day + (dark - day) * night;

      // time of day across the page: cool morning → warm midday → dusk
      if (p < 0.5) timeColor.copy(colorMorning).lerp(colorMidday, p / 0.5);
      else timeColor.copy(colorMidday).lerp(colorDusk, (p - 0.5) / 0.5);

      const arc = -0.9 + p * 1.8;
      sun.position.set(Math.sin(arc) * 8, Math.cos(arc) * 7, 5);
      sun.color.copy(timeColor).lerp(MOON, night);
      sun.intensity = mix(1.4, 0.3);
      hemi.intensity = mix(0.7, 0.12);

      // the sun crosses the sky behind the plant; the moon is smaller
      // (in daylight the frost is already bright, so the sun only lifts it
      // a little — any more and it clips to flat white, losing the pebbles)
      sunGlow.position.set(-1.2 + p * 3.5, 2.5 - Math.abs(p - 0.5) * 1.2, -6.9);
      sunGlow.scale.setScalar(mix(0.9, 0.45));
      sunGlowMat.color
        .copy(timeColor)
        .lerp(MOON, night)
        .multiplyScalar(mix(0.35, 1) * (1 - h * 0.4));
      glassMat.envMapIntensity = mix(0.2, 0.06);

      glare.position.set(
        -1.2 + p * 2.8 + Math.sin(t * 0.3) * 0.3,
        1.6 + Math.cos(t * 0.23) * 0.2,
        2.2,
      );
      glare.color.copy(timeColor).lerp(MOON, night);
      // dim the glare behind the content sections so text stays readable
      glare.intensity = mix(40, 8) * (1 - h * 0.6);

      backdropMat.color.copy(WHITE).lerp(NIGHT_BACKDROP, night);

      // past the hero: denser frost, milkier glass, fainter wire
      glassMat.roughness = 0.5 + h * 0.4;
      glassMat.transmission = 1 - h * 0.2;
      gridMat.color.copy(GRID_DAY).lerp(GRID_NIGHT, night);
      gridMat.opacity = mix(0.35, 0.2) * (1 - h * 0.6);

      // leaves sway in a breeze that gusts now and then
      const gust = 0.08 + Math.sin(t * 0.3) * 0.05;
      for (let i = 0; i < leafData.length; i++) {
        const leaf = leafData[i];
        const sway = Math.sin(t * leaf.speed + leaf.phase + leaf.x * 0.3) * gust;
        dummy.position.set(leaf.x, leaf.y, leaf.z);
        dummy.rotation.set(leaf.rx + sway * 0.5, leaf.ry, leaf.rz + sway);
        dummy.scale.setScalar(leaf.scale);
        dummy.updateMatrix();
        leaves.setMatrixAt(i, dummy.matrix);
      }
      leaves.instanceMatrix.needsUpdate = true;

      if (controls) controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };
    animate();

    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      if (controls) controls.dispose();

      [backdropGeo, sunGlowGeo, leafGeo, glassGeo, gridGeo].forEach((g) =>
        g.dispose(),
      );
      [backdropMat, sunGlowMat, leafMat, glassMat, gridMat].forEach((m) =>
        m.dispose(),
      );
      [backdropTex, sunTex, leafTex, bumpTex, frostTex, envTexture].forEach(
        (tex) => tex.dispose(),
      );
      leaves.dispose();
      pmrem.dispose();

      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="scene-bg">
      <div ref={mountRef} className="absolute inset-0" />
    </div>
  );
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Leaf positions: vines climb from below the frame, mostly on the right,
 * with a few short ones on the left and some stray leaves close to the
 * glass — so the left side stays bright and the right is dense.
 */
function makeLeafLayout() {
  const leaves = [];
  const addLeaf = (x, y, z, side) => {
    const yellow = Math.random() < 0.08;
    // deeper leaves are a touch darker
    const depthShade = 1 + z * 0.08;
    leaves.push({
      x,
      y,
      z,
      rx: rand(-0.6, 0.2),
      ry: rand(-0.5, 0.5),
      rz: side * rand(0.5, 1.3),
      scale: rand(0.35, 0.62),
      speed: rand(0.8, 1.6),
      phase: rand(0, Math.PI * 2),
      color: new THREE.Color().setHSL(
        yellow ? rand(0.14, 0.17) : rand(0.25, 0.31),
        yellow ? 0.55 : rand(0.4, 0.6),
        (yellow ? 0.45 : rand(0.2, 0.34)) * depthShade,
      ),
    });
  };

  for (let v = 0; v < 22; v++) {
    let x = rand(-2.5, 7);
    let y = -5;
    const z = rand(-0.5, -3.5);
    const drift = rand(-0.1, 0.04);
    const steps = x < 1 ? rand(4, 10) : rand(14, 30);
    for (let s = 0; s < steps; s++) {
      x += drift + rand(-0.12, 0.12);
      y += rand(0.22, 0.34);
      addLeaf(x + rand(-0.25, 0.25), y, z + rand(-0.2, 0.2), s % 2 ? 1 : -1);
    }
  }
  for (let i = 0; i < 8; i++) {
    addLeaf(rand(-5, -1), rand(-3, 3), rand(-0.8, -0.3), Math.random() < 0.5 ? 1 : -1);
  }
  return leaves;
}

/** A radial-gradient canvas texture; `stops` are [offset, css color]. */
function makeRadialTexture(size, stops) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  stops.forEach(([offset, color]) => grad.addColorStop(offset, color));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A white leaf silhouette with a faint midrib; tinted per instance. */
function makeLeafTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.beginPath();
  ctx.moveTo(64, 124);
  ctx.bezierCurveTo(8, 100, 8, 30, 64, 4);
  ctx.bezierCurveTo(120, 30, 120, 100, 64, 124);
  const fill = ctx.createRadialGradient(64, 60, 4, 64, 64, 64);
  fill.addColorStop(0, "#ffffff");
  fill.addColorStop(1, "#cdd6c2");
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(64, 124);
  ctx.lineTo(64, 12);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The world behind the plant. The plane spans x -20..20, so the middle of
 * the texture is what the camera sees: light sky left of centre, fading
 * into deep foliage shade on the right and toward the bottom.
 */
function makeBackdropTexture() {
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  const across = ctx.createLinearGradient(0, 0, w, 0);
  across.addColorStop(0, "#e4e8db");
  across.addColorStop(0.42, "#d9e0cc");
  across.addColorStop(0.5, "#b9c9a0");
  across.addColorStop(0.58, "#5d7e40");
  across.addColorStop(0.7, "#2a4219");
  across.addColorStop(1, "#16240e");
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, w, h);

  const sky = ctx.createRadialGradient(w * 0.42, h * 0.38, 0, w * 0.42, h * 0.38, 120);
  sky.addColorStop(0, "rgba(255,252,240,0.5)");
  sky.addColorStop(1, "rgba(255,252,240,0)");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const ground = ctx.createLinearGradient(0, 0, 0, h);
  ground.addColorStop(0.55, "rgba(10,20,6,0)");
  ground.addColorStop(1, "rgba(10,20,6,0.5)");
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * A tiling height field: `count` soft round bumps of random size, wrapped
 * at the edges so the texture repeats without seams.
 */
function bumpField(size, count, rMin, rMax) {
  const field = new Float32Array(size * size);
  for (let k = 0; k < count; k++) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    const r = rand(rMin, rMax);
    const a = rand(0.5, 1);
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        const d = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
        if (d >= 1) continue;
        const i = ((y + size) % size) * size + ((x + size) % size);
        field[i] += a * (1 - d) * (1 - d);
      }
    }
  }
  return field;
}

/** Hammered-glass normal map: thousands of small overlapping dimples. */
function makeHammeredNormalMap(size) {
  const field = bumpField(size, (size * size) / 28, 3, 8);
  // halve the slopes: steep dimple edges sparkle as noisy specks
  const at = (x, y) =>
    field[((y + size) % size) * size + ((x + size) % size)] * 0.5;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = at(x + 1, y) - at(x - 1, y);
      const dy = at(x, y + 1) - at(x, y - 1);
      const len = Math.hypot(dx, dy, 1);
      const o = (y * size + x) * 4;
      img.data[o] = (-dx / len) * 127.5 + 127.5;
      img.data[o + 1] = (-dy / len) * 127.5 + 127.5;
      img.data[o + 2] = (1 / len) * 127.5 + 127.5;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Large, soft patches (0.6–1) so the frost is a little uneven across the pane. */
function makeFrostMap(size) {
  const field = bumpField(size, 40, 25, 70);
  let min = Infinity;
  let max = -Infinity;
  field.forEach((v) => {
    min = Math.min(min, v);
    max = Math.max(max, v);
  });

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < field.length; i++) {
    const v = (0.6 + 0.4 * ((field[i] - min) / (max - min || 1))) * 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Square wire mesh covering a w×h pane, one line every `step` units. */
function makeGridGeometry(w, h, step) {
  const points = [];
  for (let x = -w / 2; x <= w / 2; x += step) {
    points.push(x, -h / 2, 0, x, h / 2, 0);
  }
  for (let y = -h / 2; y <= h / 2; y += step) {
    points.push(-w / 2, y, 0, w / 2, y, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  return geo;
}
