import { useEffect, useRef } from "react";
import * as THREE from "three";
import { glassVertex, glassFragment } from "./glassShader";
import { createRain, RAIN_AREA } from "./rain";

/**
 * The hero's backdrop: a pane of hammered, wired glass with a plant
 * climbing behind it, filling whatever element it's placed in.
 *
 * Two passes per frame. The plant (leaves, stems, sky, sun) renders to an
 * off-screen texture along with its depth. Then the pane — a single plane
 * with the shader in glassShader.js — reads that texture and frosts it by
 * depth, so leaves near the glass stay crisp and far ones melt away.
 *
 * It follows the cursor: the camera leans toward it, so the pebbles, the
 * wire and the plant slide against each other, and a light travels with
 * it, glinting off the pebbles and brightening the leaves behind.
 */

const GLASS_W = 30;
const GLASS_H = 20;
const CAMERA_DISTANCE = 6;
const FOV = 40;

export default function GlassScene({ isDark = false }) {
  const mountRef = useRef(null);
  const isDarkRef = useRef(isDark);

  useEffect(() => {
    isDarkRef.current = isDark;
  }, [isDark]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const prefersReduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const renderer = new THREE.WebGLRenderer();
    let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(pixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false; // refreshed every few frames below
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 40);

    // ------------------------------------------------------------------
    // Pass 1: everything behind the glass
    // ------------------------------------------------------------------
    const plant = new THREE.Scene();
    // far leaves sink into the shade — a second depth cue under the frost
    plant.fog = new THREE.Fog(0x22351a, 7, 15);

    const hemi = new THREE.HemisphereLight(0xf2f7e6, 0x2a3a1c, 1);
    plant.add(hemi);

    // The sun is behind the plant, shining toward the pane. Leaves that
    // catch it glow from the back; ones in front of them sit in their shade.
    const sun = new THREE.DirectionalLight(0xfff0d2, 1);
    sun.position.set(-4, 7, -9);
    sun.target.position.set(2, 0, -2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -11;
    sun.shadow.camera.right = 11;
    sun.shadow.camera.top = 9;
    sun.shadow.camera.bottom = -9;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 30;
    sun.shadow.bias = -0.003;
    plant.add(sun, sun.target);

    // travels with the cursor, just in front of the pane
    const cursorLight = new THREE.PointLight(0xfff4e0, 1, 9, 2);
    plant.add(cursorLight);

    const backdropTex = makeBackdropTexture();
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(44, 28),
      new THREE.MeshBasicMaterial({ map: backdropTex, fog: false }),
    );
    backdrop.position.z = -7;
    plant.add(backdrop);

    // the sun (or moon) low behind the leaves; over-bright, so the frost
    // spreads it into a glare with the leaves silhouetted against it
    const glowTex = makeRadialTexture(128, [
      [0, "rgba(255,255,255,1)"],
      [0.25, "rgba(255,255,255,0.7)"],
      [0.6, "rgba(255,255,255,0.15)"],
      [1, "rgba(255,255,255,0)"],
    ]);
    const sunGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    sunGlow.position.set(-0.3, 1.2, -6.8);
    plant.add(sunGlow);

    const { leafData, vines } = makePlantLayout();

    const stemMat = new THREE.MeshStandardMaterial({
      color: 0x46562a,
      roughness: 0.8,
    });
    const stems = vines.map((vine) => {
      const stem = new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(vine.points),
          vine.points.length * 3,
          0.02,
          5,
        ),
        stemMat,
      );
      stem.position.copy(vine.root); // so it can swing about its root
      stem.castShadow = true;
      plant.add(stem);
      return stem;
    });

    const leafTex = makeLeafTexture();
    const leafMat = new THREE.MeshStandardMaterial({
      map: leafTex,
      side: THREE.DoubleSide,
      roughness: 0.42, // slightly waxy, so the cursor light glances off
    });
    // Leaves are thin: light hitting the far side comes through, tinted
    // yellow-green. Standard materials only light the facing side, so add
    // that term to three's direct-lighting function (shadows still apply).
    leafMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <lights_physical_pars_fragment>",
        THREE.ShaderChunk.lights_physical_pars_fragment.replace(
          "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );",
          `reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
          float through = saturate( dot( -geometryNormal, directLight.direction ) );
          reflectedLight.directDiffuse += through * directLight.color * vec3( 1.5, 1.3, 0.45 ) * BRDF_Lambert( material.diffuseColor );`,
        ),
      );
    };
    const leaves = new THREE.InstancedMesh(
      makeLeafGeometry(),
      leafMat,
      leafData.length,
    );
    leafData.forEach((leaf, i) => leaves.setColorAt(i, leaf.color));
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    leaves.frustumCulled = false; // instances move; skip the stale bounds
    plant.add(leaves);

    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, // keeps the over-bright sun for the frost
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      depthTexture: new THREE.DepthTexture(1, 1),
    });

    // ------------------------------------------------------------------
    // Pass 2: the pane
    // ------------------------------------------------------------------
    const front = new THREE.Scene();
    const bumpTex = makeHammeredNormalMap(512);
    const rain = createRain();
    const uniforms = {
      tScene: { value: target.texture },
      tDepth: { value: target.depthTexture },
      tBump: { value: bumpTex },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uSceneHeight: { value: 1 },
      uBumpRepeat: { value: new THREE.Vector2(GLASS_W / 2.4, GLASS_H / 2.4) },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uTanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(FOV / 2)) },
      uScatter: { value: 0.09 },
      uFrostTint: { value: new THREE.Color() },
      uLightPos: { value: new THREE.Vector3(0, 0, 1.4) },
      uLightColor: { value: new THREE.Color() },
      // a fixed light on the room side of the pane, for glints on the pebbles
      uSunDir: { value: new THREE.Vector3(-6, 9, 7).normalize() },
      uSunColor: { value: new THREE.Color() },
      uSkyColor: { value: new THREE.Color() },
      uWireColor: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uFog: { value: 0 },
      tRain: { value: rain.texture },
      uRainArea: { value: new THREE.Vector2(...RAIN_AREA) },
      uRain: { value: 0 },
    };
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(GLASS_W, GLASS_H),
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: glassVertex,
        fragmentShader: glassFragment,
      }),
    );
    front.add(glass);

    // ------------------------------------------------------------------
    // Sizing, visibility, pointer
    // ------------------------------------------------------------------
    const bufferSize = new THREE.Vector2();
    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.getDrawingBufferSize(bufferSize);
      uniforms.uResolution.value.copy(bufferSize);
      // the plant is only ever seen through frost, so half resolution is
      // plenty — a quarter of the pixels to draw and to blur
      target.setSize(Math.ceil(bufferSize.x / 2), Math.ceil(bufferSize.y / 2));
      uniforms.uSceneHeight.value = target.height;
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    // don't burn the GPU once the hero has scrolled away
    let onScreen = true;
    const viewObserver = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
    });
    viewObserver.observe(mount);

    const pointer = { x: 0, y: 0 }; // -1..1 across the hero
    const onPointerMove = (e) => {
      const rect = mount.getBoundingClientRect();
      pointer.x = clampUnit(((e.clientX - rect.left) / rect.width) * 2 - 1);
      pointer.y = clampUnit(1 - ((e.clientY - rect.top) / rect.height) * 2);
    };
    window.addEventListener("pointermove", onPointerMove);

    // how far the hero has scrolled away, 0..1 — fogs the pane over
    let scrolled = 0;
    const onScroll = () => {
      scrolled = Math.min(window.scrollY / mount.clientHeight, 1);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    // ------------------------------------------------------------------
    // Day / night: `night` eases toward 0 or 1 and every themed value
    // lerps on it, so toggling the theme fades rather than snaps.
    // ------------------------------------------------------------------
    const pair = (day, dark) => ({
      day: new THREE.Color().setRGB(...day),
      dark: new THREE.Color().setRGB(...dark),
    });
    const THEME = {
      backdrop: pair([0.95, 0.95, 0.92], [0.06, 0.09, 0.14]),
      glow: pair([2.6, 2.4, 2.0], [0.55, 0.7, 1.3]),
      fog: pair([0.016, 0.036, 0.01], [0.003, 0.008, 0.008]),
      sun: pair([1, 0.87, 0.64], [0.4, 0.54, 1]),
      light: pair([1, 0.94, 0.82], [0.6, 0.74, 1]),
      frost: pair([0.8, 0.84, 0.76], [0.03, 0.045, 0.07]),
      sky: pair([0.85, 0.92, 1], [0.07, 0.1, 0.18]),
      wire: pair([0.8, 0.84, 0.78], [0.08, 0.1, 0.13]),
      page: pair([1.5, 1.36, 1.1], [0.014, 0.012, 0.01]),
    };
    let night = isDarkRef.current ? 1 : 0;

    const look = { x: 0, y: 0 }; // eased camera lean
    const lightAt = { x: 0, y: 0 }; // eased light position (quicker)
    const halfH = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAMERA_DISTANCE;
    const dummy = new THREE.Object3D();
    const speed = prefersReduced ? 0.15 : 1;
    let t = 0;
    let frame = 0;
    const slowCheck = { time: 0, frames: 0 };
    let last = performance.now();
    let frameId;

    const animate = (now) => {
      frameId = requestAnimationFrame(animate);
      const elapsed = (now - last) / 1000;
      const dt = Math.min(elapsed, 0.05);
      last = now;
      if (!onScreen) return;
      t += dt * speed;

      // If frames are running slow, draw fewer pixels and let the browser
      // scale the canvas up. It only ever steps down — a slow GPU doesn't
      // get faster. Skips start-up and pauses (tab switches, scrolled away).
      if (frame > 60 && elapsed < 0.5) {
        slowCheck.time += elapsed;
        if (++slowCheck.frames === 45) {
          if (slowCheck.time / 45 > 1 / 40 && pixelRatio > 0.6) {
            pixelRatio = Math.max(pixelRatio * 0.8, 0.6);
            renderer.setPixelRatio(pixelRatio);
            resize();
          }
          slowCheck.time = 0;
          slowCheck.frames = 0;
        }
      }

      night += ((isDarkRef.current ? 1 : 0) - night) * 0.05;
      const mix = (day, dark) => day + (dark - day) * night;
      const themed = (out, key) => out.copy(THEME[key].day).lerp(THEME[key].dark, night);

      themed(backdrop.material.color, "backdrop");
      themed(sunGlow.material.color, "glow");
      themed(plant.fog.color, "fog");
      themed(sun.color, "sun");
      themed(cursorLight.color, "light");
      themed(uniforms.uFrostTint.value, "frost");
      themed(uniforms.uSkyColor.value, "sky");
      themed(uniforms.uWireColor.value, "wire");
      themed(uniforms.uFogColor.value, "page");
      uniforms.uFog.value = THREE.MathUtils.smoothstep(scrolled, 0.1, 0.9);
      themed(uniforms.uLightColor.value, "light");
      themed(uniforms.uSunColor.value, "sun").multiplyScalar(mix(1, 0.5));
      hemi.intensity = mix(0.5, 0.15);
      sun.intensity = mix(3.6, 0.9);
      cursorLight.intensity = mix(7, 4);
      sunGlow.scale.setScalar(mix(9, 5));

      // camera leans toward the cursor, with a slow idle drift on top
      look.x += (pointer.x - look.x) * 0.06;
      look.y += (pointer.y - look.y) * 0.06;
      const azimuth = look.x * 0.32 + Math.sin(t * 0.35) * 0.05;
      const polar = look.y * 0.18 + Math.cos(t * 0.27) * 0.03;
      camera.position.set(
        Math.sin(azimuth) * Math.cos(polar) * CAMERA_DISTANCE,
        Math.sin(polar) * CAMERA_DISTANCE,
        Math.cos(azimuth) * Math.cos(polar) * CAMERA_DISTANCE,
      );
      camera.lookAt(0, 0, 0);

      // the light sits under the cursor, just off the glass
      lightAt.x += (pointer.x - lightAt.x) * 0.14;
      lightAt.y += (pointer.y - lightAt.y) * 0.14;
      uniforms.uLightPos.value.set(
        lightAt.x * halfH * camera.aspect,
        lightAt.y * halfH,
        1.4,
      );
      cursorLight.position.copy(uniforms.uLightPos.value);

      // A breeze that gusts now and then. Each vine swings as a whole from
      // its root — the hanging ones like pendulums — and every leaf rides
      // along with its vine and flutters a little on top.
      const gust = 0.75 + Math.sin(t * 0.5) * 0.25;
      vines.forEach((vine, v) => {
        vine.angle =
          vine.amp *
          gust *
          (Math.sin(t * vine.speed + vine.phase) +
            0.4 * Math.sin(t * vine.speed * 2.3 + vine.phase));
        stems[v].rotation.z = vine.angle;
      });
      for (let i = 0; i < leafData.length; i++) {
        const leaf = leafData[i];
        const vine = vines[leaf.vine];
        const cos = Math.cos(vine.angle);
        const sin = Math.sin(vine.angle);
        const flutter = Math.sin(t * leaf.speed + leaf.phase) * 0.1 * gust;
        dummy.position.set(
          vine.root.x + leaf.x * cos - leaf.y * sin,
          vine.root.y + leaf.x * sin + leaf.y * cos,
          vine.root.z + leaf.z,
        );
        dummy.rotation.set(
          leaf.rx + flutter * 0.6,
          leaf.ry,
          leaf.rz + vine.angle + flutter,
        );
        dummy.scale.set(leaf.scale * leaf.width, leaf.scale, leaf.scale);
        dummy.updateMatrix();
        leaves.setMatrixAt(i, dummy.matrix);
      }
      leaves.instanceMatrix.needsUpdate = true;

      // showers pass now and then at night (not with reduced motion)
      const wet = rain.update(dt, night > 0.5 && !prefersReduced);
      uniforms.uRain.value = wet ? 1 : 0;

      // the leaves move slowly; their shadows don't need redrawing each frame
      if (frame++ % 3 === 0) renderer.shadowMap.needsUpdate = true;
      renderer.setRenderTarget(target);
      renderer.render(plant, camera);
      renderer.setRenderTarget(null);
      renderer.render(front, camera);
    };
    frameId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
      viewObserver.disconnect();

      [plant, front].forEach((scene) =>
        scene.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        }),
      );
      [backdropTex, glowTex, leafTex, bumpTex, rain.texture].forEach((tex) =>
        tex.dispose(),
      );
      target.depthTexture.dispose();
      target.dispose();

      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} className="hero-glass" />;
}

function clampUnit(v) {
  return Math.min(1, Math.max(-1, v));
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Where the plant grows. The main mass climbs from below the frame on the
 * right, at every depth from just behind the pane to far back. A few thin
 * vines hang from the top on the left, close to the glass, so that side
 * stays bright but still has crisp leaves near the surface.
 *
 * Returns the leaves and the vines they sit on (root, stem points, sway).
 */
function makePlantLayout() {
  const leafData = [];
  const vines = [];

  const addVine = ({ x, y, z, rise, steps, drift, minX = -Infinity }) => {
    // stem points and leaf positions are stored relative to the root
    const root = new THREE.Vector3(x, y - rise, z);
    const points = [new THREE.Vector3()];
    const wave = rand(0, Math.PI * 2);
    for (let s = 0; s < steps; s++) {
      x = Math.max(x + drift + rand(-0.12, 0.12), minX);
      y += rise * rand(0.22, 0.32);
      const pz = Math.min(z + Math.sin(s * 0.45 + wave) * 0.22, -0.08);
      points.push(new THREE.Vector3(x, y, pz).sub(root));

      const side = s % 2 ? 1 : -1;
      // 0 at the root, 1 at the growing tip: leaves start small, pale and
      // fresh, and get bigger and darker with age; old ones may yellow
      const youth = Math.pow(s / steps, 1.4);
      const yellow = Math.random() < 0.12 * (1 - youth);
      leafData.push({
        vine: vines.length,
        x: x - root.x,
        y: y - root.y,
        z: pz - root.z,
        rx: rand(-0.7, 0.2),
        ry: rand(-0.6, 0.6),
        // rising vines hold leaves up and out; hanging ones let them droop
        rz: (rise > 0 ? 0 : Math.PI) + side * rand(0.5, 1.3),
        scale: (0.78 - youth * 0.5) * rand(0.85, 1.15),
        width: rand(0.8, 1.15),
        speed: rand(0.8, 1.7),
        phase: rand(0, Math.PI * 2),
        color: new THREE.Color().setHSL(
          yellow ? rand(0.14, 0.17) : 0.31 - youth * 0.07 + rand(-0.015, 0.015),
          yellow ? 0.6 : rand(0.5, 0.7),
          yellow ? 0.5 : 0.25 + youth * 0.17 + rand(-0.03, 0.03),
        ),
      });
    }
    vines.push({
      root,
      points,
      // hanging vines swing freely; rooted ones only lean
      amp: rise < 0 ? rand(0.04, 0.08) : rand(0.008, 0.02),
      speed: rise < 0 ? rand(1.5, 2.1) : rand(0.5, 0.9),
      phase: rand(0, Math.PI * 2),
      angle: 0,
    });
  };

  for (let v = 0; v < 20; v++) {
    addVine({
      x: rand(1.8, 8.5),
      y: -5.2,
      // biased toward the pane, so plenty of leaves are close enough to read
      z: -(0.1 + Math.pow(Math.random(), 2.4) * 4.7),
      rise: 1,
      steps: rand(16, 34),
      drift: rand(-0.05, 0.05),
      minX: 1.7, // keep the mass off the hero text
    });
  }
  // (kept between the logo and the nav links, and short enough to stop
  // above the hero text)
  for (let v = 0; v < 4; v++) {
    addVine({
      x: rand(-1.95, -1.5),
      y: 3,
      z: -rand(0.1, 0.5),
      rise: -1,
      steps: rand(5, 8),
      drift: rand(-0.04, 0.04),
    });
  }
  return { leafData, vines };
}

/**
 * One leaf: a grid pinched into a rounded, pointed outline (widest a third
 * of the way up from the stem), cupped across the midrib and curled along
 * its length so light and shadow fall across it.
 */
function makeLeafGeometry() {
  const geo = new THREE.PlaneGeometry(1, 1, 6, 10);
  geo.translate(0, 0.5, 0); // pivot at the stem end
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = pos.getY(i);
    const width = Math.pow(Math.sin(Math.PI * Math.pow(v, 0.62)), 0.75);
    const x = pos.getX(i) * width * 0.92;
    pos.setX(i, x);
    pos.setZ(i, -x * x * 0.9 - (v - 0.45) * (v - 0.45) * 0.3);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Pale leaf surface, tinted per instance: darker toward the edges, a few
 * soft blotches so it isn't one flat colour, and faint veins — each a thin
 * light line with a thinner shadow beside it, like a shallow crease.
 */
function makeLeafTexture() {
  const size = 256;
  const mid = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  const fill = ctx.createLinearGradient(0, 0, size, 0);
  fill.addColorStop(0, "#aab894");
  fill.addColorStop(0.5, "#eef2e0");
  fill.addColorStop(1, "#aab894");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 26; i++) {
    const x = rand(0, size);
    const y = rand(0, size);
    const r = rand(14, 44);
    const blotch = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = Math.random() < 0.5 ? "255,255,240" : "40,70,20";
    blotch.addColorStop(0, `rgba(${tone},0.1)`);
    blotch.addColorStop(1, `rgba(${tone},0)`);
    ctx.fillStyle = blotch;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const veins = (offset, style, width) => {
    ctx.strokeStyle = style;
    ctx.lineCap = "round";
    ctx.lineWidth = width * 1.8;
    ctx.beginPath();
    ctx.moveTo(mid + offset, size);
    ctx.lineTo(mid + offset, 0);
    ctx.stroke();
    ctx.lineWidth = width;
    for (let y = size - 24; y > 30; y -= 30) {
      ctx.beginPath();
      ctx.moveTo(mid, y + offset);
      ctx.quadraticCurveTo(size * 0.3, y - 22 + offset, 4, y - 58 + offset);
      ctx.moveTo(mid, y + offset);
      ctx.quadraticCurveTo(size * 0.7, y - 22 + offset, size - 4, y - 58 + offset);
      ctx.stroke();
    }
  };
  veins(2, "rgba(30,60,15,0.16)", 1.5);
  veins(0, "rgba(255,255,235,0.3)", 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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

/**
 * The world behind the plant. The plane is far wider than the view, so
 * the middle of the texture is what the camera sees: bright sky left of
 * centre, fading into deep foliage shade on the right and at the bottom.
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
  across.addColorStop(0.5, "#a9bb8e");
  across.addColorStop(0.58, "#3f5a2a");
  across.addColorStop(0.7, "#182a0f");
  across.addColorStop(1, "#0c1707");
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, w, h);

  const ground = ctx.createLinearGradient(0, 0, 0, h);
  ground.addColorStop(0.5, "rgba(8,16,5,0)");
  ground.addColorStop(1, "rgba(8,16,5,0.55)");
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
