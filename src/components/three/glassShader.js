/**
 * The frosted pane. It doesn't use three's built-in transmission, because
 * that blurs everything behind the glass by the same amount. Real frosted
 * glass scatters light by an angle, so a leaf pressed against the pane is
 * nearly sharp and one a metre back dissolves — that's the depth cue.
 *
 * The plant is rendered to a texture with its depth; this shader reads
 * both and, per pixel:
 *   1. bends the lookup by the pebble normal (more for distant things),
 *   2. blurs with a disc whose radius grows with distance behind the pane,
 *   3. adds glints from the cursor light and sun on the pebbles, a faint
 *      sky reflection at grazing angles, and the wire mesh inside the glass.
 */

export const glassVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vViewZ;

  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec4 view = viewMatrix * world;
    vWorldPos = world.xyz;
    vViewZ = -view.z;
    gl_Position = projectionMatrix * view;
  }
`;

export const glassFragment = /* glsl */ `
  #include <common>
  #include <packing>

  uniform sampler2D tScene;
  uniform sampler2D tDepth;
  uniform sampler2D tBump;
  uniform vec2 uResolution;
  uniform float uSceneHeight;
  uniform vec2 uBumpRepeat;
  uniform float uNear;
  uniform float uFar;
  uniform float uTanHalfFov;
  uniform float uScatter;
  uniform vec3 uFrostTint;
  uniform vec3 uLightPos;
  uniform vec3 uLightColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uWireColor;
  uniform vec3 uFogColor;
  uniform float uFog;
  uniform sampler2D tRain;
  uniform vec2 uRainArea;
  uniform float uRain;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vViewZ;

  const int TAPS = 14;
  const float WIRE_STEP = 0.17;
  const float WIRE_HALF_WIDTH = 0.0035;
  const float WIRE_DEPTH = 0.06;

  // how heavily frosted this spot of the pane is (set once per pixel)
  float frost;

  // smooth random patches across the pane, 0..1
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float patches(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  // distance from the camera to whatever is behind the glass at this pixel
  float sceneDepth(vec2 uv) {
    return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
  }

  // Blur disc radius (as a fraction of screen height) for something at
  // camera distance z: grows with its distance behind the pane, plus a
  // small minimum so even a touching leaf is softened.
  float blurRadius(float z) {
    float behind = max(z - vViewZ, 0.0);
    return min((uScatter * frost * behind + 0.008) / (2.0 * uTanHalfFov * z), 0.11);
  }

  void main() {
    float aspect = uResolution.x / uResolution.y;
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    // no pane is frosted evenly: some patches are a little clearer, some
    // milkier
    float uneven = patches(vWorldPos.xy * 0.55) * 0.65 + patches(vWorldPos.xy * 1.7) * 0.35;
    frost = mix(0.6, 1.45, uneven) * (1.0 + uFog * 5.0);
    vec2 bump = texture2D(tBump, vUv * uBumpRepeat).xy * 2.0 - 1.0;
    // a fine frost grain riding on the pebbles (the same texture, much
    // smaller): it roughens the surface for light, not the view through it
    vec2 grain = texture2D(tBump, vUv * uBumpRepeat * 3.1 + 0.37).xy * 2.0 - 1.0;
    vec2 surface = bump + grain * 0.4;

    // rain on the far side (see rain.js): where the pane is wet the frost
    // clears, and each drop bends the view like a small lens
    float wet = 0.0;
    vec2 lens = vec2(0.0);
    if (uRain > 0.0) {
      vec3 rain = texture2D(tRain, (vWorldPos.xy + bump * 0.012) / uRainArea + 0.5).rgb;
      wet = smoothstep(0.25, 0.55, rain.b);
      lens = (rain.rg - 0.5) * vec2(2.0, -2.0) * wet;
      frost *= 1.0 - 0.9 * wet;
    }

    // 1. refraction: each pebble bends the view, more for distant things
    float r0 = blurRadius(sceneDepth(screenUv));
    vec2 bend = bump * (0.004 + r0 * 0.8) - lens * 0.022;
    vec2 uv = screenUv + vec2(bend.x / aspect, bend.y);

    // 2. depth-aware frost: gather a disc of samples around this pixel.
    // Each sample is itself a blurred disc, as wide as its own depth says:
    //   - it only counts if that disc is wide enough to reach this pixel,
    //     so a crisp near leaf doesn't smear across the soft background;
    //   - a narrower disc is more concentrated, so it counts for more —
    //     without this, leaf edges come out hard instead of feathered.
    float rc = blurRadius(sceneDepth(uv));
    float lodScale = uSceneHeight / sqrt(float(TAPS)) * 1.5;
    float spin = 6.2832 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    vec3 col = textureLod(tScene, uv, log2(max(rc * lodScale, 1.0))).rgb;
    float weight = 1.0;
    for (int i = 0; i < TAPS; i++) {
      float rad = sqrt((float(i) + 0.5) / float(TAPS)) * rc;
      float angle = float(i) * 2.39996 + spin;
      vec2 tapUv = uv + vec2(cos(angle) / aspect, sin(angle)) * rad;
      float reach = blurRadius(sceneDepth(tapUv));
      float w = clamp(1.0 + (reach - rad) / max(rad * 0.5, 1e-4), 0.0, 1.0);
      float concentration = rc / max(reach, 1e-4);
      w *= clamp(concentration * concentration, 1.0, 4.0);
      float lod = log2(max(min(rc, reach) * lodScale, 1.0));
      col += textureLod(tScene, tapUv, lod).rgb * w;
      weight += w;
    }
    col /= weight;

    // a little milkiness, and each pebble is a tiny lens: brighter on the
    // side facing the sky, darker underneath — the relief you see even
    // where there's nothing but flat light behind the pane
    col = mix(col, uFrostTint, (0.03 + 0.08 * uneven) * (1.0 - wet));
    col *= vec3(0.94, 0.985, 0.955); // the faint green of glass seen through its thickness
    // drops are dark around the rim and catch a spot of light near the top
    col *= 1.0 - 0.28 * wet * smoothstep(0.55, 1.0, length(lens));
    float catchLight = max(dot(normalize(vec3(lens, 0.8)), normalize(vec3(-0.4, 0.6, 0.7))), 0.0);
    col += uLightColor * pow(catchLight, 32.0) * wet * 1.5;
    // scrolling away fogs the pane over until nothing shows through
    col = mix(col, uFogColor, uFog);
    col *= 1.0 + dot(surface, vec2(0.3, 0.7));

    // 3. the surface: glints, sky reflection, wire
    vec3 N = normalize(vec3(surface * 0.9, 1.0));
    vec3 V = normalize(cameraPosition - vWorldPos);

    vec3 toLight = uLightPos - vWorldPos;
    float falloff = 1.0 / (1.0 + dot(toLight, toLight) * 0.12);
    float nh = max(dot(N, normalize(normalize(toLight) + V)), 0.0);
    col += uLightColor * falloff * (pow(nh, 240.0) * 5.0 + pow(nh, 24.0) * 0.3);

    float nhSun = max(dot(N, normalize(uSunDir + V)), 0.0);
    col += uSunColor * pow(nhSun, 180.0) * 2.0;

    float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    float up = smoothstep(-0.3, 0.9, reflect(-V, N).y);
    col += uSkyColor * up * fresnel * 0.7;

    // wire mesh a little way inside the glass: it shifts against the
    // surface as the view tilts, and wobbles slightly through the pebbles.
    // Real mesh is never a perfect grid, so the strands wander a little.
    vec2 wander = vec2(
      sin(vWorldPos.y * 2.1 + vWorldPos.x * 0.3),
      sin(vWorldPos.x * 1.7 - vWorldPos.y * 0.4)
    ) * 0.012;
    vec2 wirePos = vWorldPos.xy - V.xy / max(V.z, 0.2) * WIRE_DEPTH + bump * 0.006 + wander;
    vec2 cell = abs(fract(wirePos / WIRE_STEP - 0.5) - 0.5) * WIRE_STEP;
    float d = min(cell.x, cell.y);
    float px = length(fwidth(vWorldPos.xy)) * 0.7;
    col *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, WIRE_HALF_WIDTH * 5.0, d));
    float wire = 1.0 - smoothstep(WIRE_HALF_WIDTH - px, WIRE_HALF_WIDTH + px, d);
    col = mix(col, uWireColor * (0.75 + nh * 0.5), wire * 0.38);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
