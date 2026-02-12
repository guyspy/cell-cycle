/**
 * Ray-marching metaball shader for rendering cell/slime pieces
 * as merged blobby shapes with per-piece color blending, eyes,
 * fresnel rim glow, and transparent background.
 */

export const metaballVertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const metaballFragmentShader = /* glsl */ `
precision highp float;

#define MAX_PIECES 8
#define MAX_STEPS 64
#define EPSILON 0.01
#define MAX_DIST 100.0
#define SMIN_K 0.7

uniform vec3 uPiecePositions[MAX_PIECES];
uniform vec3 uPieceScales[MAX_PIECES];
uniform vec3 uPieceColors[MAX_PIECES];
uniform int uPieceCount;
uniform mat4 uInvProjectionMatrix;
uniform mat4 uInvViewMatrix;
uniform vec3 uCameraPosition;
uniform vec2 uResolution;

varying vec2 vUv;

// ─── SDF Primitives ─────────────────────────────────────────

float sdEllipsoid(vec3 p, vec3 center, vec3 radii) {
  vec3 q = (p - center) / radii;
  float len = length(q);
  // Approximate ellipsoid SDF (exact is expensive)
  return (len - 1.0) * min(min(radii.x, radii.y), radii.z);
}

float sdSphere(vec3 p, vec3 center, float radius) {
  return length(p - center) - radius;
}

// ─── Smooth Minimum ─────────────────────────────────────────

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * h * k * (1.0 / 6.0);
}

// Smooth min that also returns blend factor (0 = a, 1 = b)
vec2 sminColor(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  float m = h * h * h * 0.5;
  float s = m * k * (1.0 / 3.0);
  // blend: 0 means a dominates, 1 means b dominates
  float blend = (a < b) ? m : 1.0 - m;
  return vec2(min(a, b) - s, blend);
}

// ─── Eye SDF ────────────────────────────────────────────────

float eyesSDF(vec3 p, vec3 piecePos, vec3 pieceScale) {
  // Eyes sit on the front face of the piece, facing the camera
  vec3 toCamera = normalize(uCameraPosition - piecePos);
  // Project to XZ plane for horizontal direction
  vec3 forward = normalize(vec3(toCamera.x, 0.0, toCamera.z));
  vec3 right = vec3(-forward.z, 0.0, forward.x);
  vec3 up = vec3(0.0, 1.0, 0.0);

  float eyeRadius = 0.08;
  float eyeSeparation = 0.15;
  float eyeForward = 0.35 * pieceScale.x;
  float eyeUp = 0.08 * pieceScale.y;

  vec3 leftEyePos = piecePos + forward * eyeForward - right * eyeSeparation + up * eyeUp;
  vec3 rightEyePos = piecePos + forward * eyeForward + right * eyeSeparation + up * eyeUp;

  float leftEye = sdSphere(p, leftEyePos, eyeRadius);
  float rightEye = sdSphere(p, rightEyePos, eyeRadius);

  return min(leftEye, rightEye);
}

// ─── Scene SDF with Color Blending ──────────────────────────

struct SceneResult {
  float dist;
  vec3 color;
  bool isEye;
};

SceneResult sceneSDF(vec3 p) {
  float d = MAX_DIST;
  vec3 col = vec3(0.0);
  float totalWeight = 0.0;

  // Union of all piece ellipsoids with smooth blending
  for (int i = 0; i < MAX_PIECES; i++) {
    if (i >= uPieceCount) break;

    vec3 radii = uPieceScales[i] * 0.5;
    float di = sdEllipsoid(p, uPiecePositions[i], radii);

    // Weight for color blending based on SDF distance
    // Pieces closer to the surface contribute more color
    float w = exp(-4.0 * max(di, 0.0));
    col += uPieceColors[i] * w;
    totalWeight += w;

    d = smin(d, di, SMIN_K);
  }

  if (totalWeight > 0.0) {
    col /= totalWeight;
  }

  // Check eyes (rendered as dark regions carved into the surface)
  float eyeDist = MAX_DIST;
  for (int i = 0; i < MAX_PIECES; i++) {
    if (i >= uPieceCount) break;
    float ed = eyesSDF(p, uPiecePositions[i], uPieceScales[i]);
    eyeDist = min(eyeDist, ed);
  }

  // If inside an eye region and near the body surface, mark as eye
  bool isEye = eyeDist < EPSILON * 2.0 && d < 0.15;

  return SceneResult(d, col, isEye);
}

// Scene SDF (distance only, for normals and marching)
float sceneDistOnly(vec3 p) {
  float d = MAX_DIST;

  for (int i = 0; i < MAX_PIECES; i++) {
    if (i >= uPieceCount) break;
    vec3 radii = uPieceScales[i] * 0.5;
    float di = sdEllipsoid(p, uPiecePositions[i], radii);
    d = smin(d, di, SMIN_K);
  }

  return d;
}

// ─── Normal Estimation ──────────────────────────────────────

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(EPSILON, 0.0);
  return normalize(vec3(
    sceneDistOnly(p + e.xyy) - sceneDistOnly(p - e.xyy),
    sceneDistOnly(p + e.yxy) - sceneDistOnly(p - e.yxy),
    sceneDistOnly(p + e.yyx) - sceneDistOnly(p - e.yyx)
  ));
}

// ─── Ray March ──────────────────────────────────────────────

struct MarchResult {
  float dist;
  vec3 pos;
  bool hit;
};

MarchResult rayMarch(vec3 ro, vec3 rd) {
  float t = 0.0;

  for (int i = 0; i < MAX_STEPS; i++) {
    vec3 p = ro + rd * t;
    float d = sceneDistOnly(p);

    if (d < EPSILON) {
      return MarchResult(t, p, true);
    }

    t += d;

    if (t > MAX_DIST) break;
  }

  return MarchResult(t, ro + rd * t, false);
}

// ─── Main ───────────────────────────────────────────────────

void main() {
  // Early out if no pieces
  if (uPieceCount == 0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Reconstruct ray from screen UV
  vec2 ndc = vUv * 2.0 - 1.0;

  // Clip space -> view space (unproject near-plane point)
  vec4 clipPos = vec4(ndc, -1.0, 1.0);
  vec4 viewPos = uInvProjectionMatrix * clipPos;
  viewPos.xyz /= viewPos.w;

  // View space direction -> world space direction
  vec3 rd = normalize((uInvViewMatrix * vec4(normalize(viewPos.xyz), 0.0)).xyz);
  vec3 ro = uCameraPosition;

  // Ray march
  MarchResult march = rayMarch(ro, rd);

  if (!march.hit) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Get scene info at hit point
  SceneResult scene = sceneSDF(march.pos);
  vec3 normal = calcNormal(march.pos);

  // ── Lighting ──────────────────────────────────────────

  vec3 baseColor = scene.color;

  // Eye regions: dark color
  if (scene.isEye) {
    baseColor = vec3(0.102, 0.102, 0.18); // #1a1a2e
  }

  // Ambient light (cool purple tint matching 0x303050)
  vec3 ambientColor = vec3(0.188, 0.188, 0.314);
  vec3 ambient = ambientColor * baseColor;

  // Directional light from above (matching 0x6666aa, intensity 0.3)
  vec3 lightDir = normalize(vec3(0.0, 1.0, 0.0));
  vec3 dirColor = vec3(0.4, 0.4, 0.667) * 0.3;
  float diff = max(dot(normal, lightDir), 0.0);
  vec3 diffuse = dirColor * baseColor * diff;

  // Subsurface scattering approximation (wrap lighting)
  float wrap = max(dot(normal, lightDir) * 0.5 + 0.5, 0.0);
  vec3 subsurface = baseColor * wrap * 0.15;

  // Specular (clearcoat feel)
  vec3 viewDir = normalize(uCameraPosition - march.pos);
  vec3 halfVec = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, halfVec), 0.0), 64.0);
  vec3 specular = vec3(1.0) * spec * 0.3;

  // Fresnel rim glow (emissive edge glow for bloom)
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
  vec3 rimColor = baseColor * 1.5; // brighter than base for bloom to catch
  vec3 rim = rimColor * fresnel * 0.6;

  // Emissive glow (matching emissiveIntensity: 0.2)
  vec3 emissive = baseColor * 0.2;

  // Combine
  vec3 finalColor = ambient + diffuse + subsurface + specular + rim + emissive;

  // Override for eyes (no glow, no rim)
  if (scene.isEye) {
    finalColor = ambient + diffuse * 0.5;
  }

  // Tone mapping is handled by Three.js renderer (ACES Filmic)
  // Output linear color, let the renderer handle the rest
  gl_FragColor = vec4(finalColor, 0.85);
}
`;
