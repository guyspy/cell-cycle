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

// Double-bubble parameters
#define ATTRACT_RANGE 3.0
#define ATTRACT_STRENGTH 0.25
#define MEMBRANE_HALF 0.06
#define REPULSION_STRENGTH 0.35

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
  return (length(q) - 1.0) * min(min(radii.x, radii.y), radii.z);
}

float sdSphere(vec3 p, vec3 center, float radius) {
  return length(p - center) - radius;
}

// ─── Eye SDF ────────────────────────────────────────────────

float eyesSDF(vec3 p, vec3 piecePos, vec3 pieceScale) {
  vec3 toCamera = normalize(uCameraPosition - piecePos);
  vec3 forward = normalize(vec3(toCamera.x, 0.0, toCamera.z));
  vec3 right = vec3(-forward.z, 0.0, forward.x);
  vec3 up = vec3(0.0, 1.0, 0.0);

  float eyeRadius = 0.08;
  float eyeSeparation = 0.15;
  float eyeForward = 0.35 * pieceScale.x;
  float eyeUp = 0.08 * pieceScale.y;

  vec3 leftEyePos = piecePos + forward * eyeForward - right * eyeSeparation + up * eyeUp;
  vec3 rightEyePos = piecePos + forward * eyeForward + right * eyeSeparation + up * eyeUp;

  return min(sdSphere(p, leftEyePos, eyeRadius),
             sdSphere(p, rightEyePos, eyeRadius));
}

// ─── Attraction helper ──────────────────────────────────────
// Computes how much piece i's SDF should shrink (bulge) toward
// nearby neighbours at world point p.

float attractionOffset(vec3 p, int idx, float rawDist) {
  float offset = 0.0;
  for (int j = 0; j < MAX_PIECES; j++) {
    if (j >= uPieceCount) break;
    if (j == idx) continue;

    float pairDist = length(uPiecePositions[idx] - uPiecePositions[j]);
    if (pairDist >= ATTRACT_RANGE) continue;

    float proximity = 1.0 - pairDist / ATTRACT_RANGE;
    float strength = proximity * proximity * ATTRACT_STRENGTH;

    // Only bulge on the side facing the neighbour
    vec3 axis = normalize(uPiecePositions[j] - uPiecePositions[idx]);
    vec3 toP  = normalize(p - uPiecePositions[idx] + vec3(0.0001));
    float facing = max(dot(toP, axis), 0.0);

    // Fade out away from the surface — gentler falloff so the bulge
    // extends further and is more visible at touching distance
    float falloff = exp(-1.8 * max(rawDist, 0.0));
    offset += strength * facing * falloff;
  }
  return offset;
}

// ─── Repulsion helper ──────────────────────────────────────
// When two pieces overlap (both SDFs negative at p), push the
// combined surface outward to prevent visual interpenetration.
// Returns a positive offset to add to the scene distance.

float repulsionOffset(vec3 p) {
  // Find the two most-negative (deepest overlap) raw SDF values
  float neg1 = 0.0;  // most negative
  float neg2 = 0.0;  // second most negative
  for (int i = 0; i < MAX_PIECES; i++) {
    if (i >= uPieceCount) break;
    vec3 radii = uPieceScales[i] * 0.5;
    float d = sdEllipsoid(p, uPiecePositions[i], radii);
    if (d < neg1) {
      neg2 = neg1;
      neg1 = d;
    } else if (d < neg2) {
      neg2 = d;
    }
  }

  // Both must be inside (negative) for there to be overlap
  if (neg2 >= 0.0) return 0.0;

  // The deeper both are negative, the stronger the repulsion
  float overlap = min(-neg2, 0.5);  // clamp for stability
  return overlap * REPULSION_STRENGTH;
}

// ─── Scene SDF (distance only — for marching & normals) ─────

float sceneDistOnly(vec3 p) {
  float d = MAX_DIST;

  for (int i = 0; i < MAX_PIECES; i++) {
    if (i >= uPieceCount) break;

    vec3 radii  = uPieceScales[i] * 0.5;
    float rawDi = sdEllipsoid(p, uPiecePositions[i], radii);
    float di    = rawDi - attractionOffset(p, i, rawDi);

    d = min(d, di);
  }

  // Push overlapping regions outward so pieces don't interpenetrate
  d += repulsionOffset(p);

  return d;
}

// ─── Scene SDF with colour + membrane info ──────────────────

struct SceneResult {
  float dist;
  vec3  color;
  bool  isEye;
  bool  isMembrane;
};

SceneResult sceneSDF(vec3 p) {
  // Compute attracted distances for every piece
  float dists[MAX_PIECES];
  for (int i = 0; i < MAX_PIECES; i++) {
    if (i >= uPieceCount) { dists[i] = MAX_DIST; continue; }
    vec3 radii  = uPieceScales[i] * 0.5;
    float rawDi = sdEllipsoid(p, uPiecePositions[i], radii);
    dists[i]    = rawDi - attractionOffset(p, i, rawDi);
  }

  // Find closest and second-closest
  float d1 = MAX_DIST;
  float d2 = MAX_DIST;
  int   idx1 = 0;
  int   idx2 = 0;
  for (int i = 0; i < MAX_PIECES; i++) {
    if (i >= uPieceCount) break;
    if (dists[i] < d1) {
      d2 = d1; idx2 = idx1;
      d1 = dists[i]; idx1 = i;
    } else if (dists[i] < d2) {
      d2 = dists[i]; idx2 = i;
    }
  }

  // Apply repulsion offset to the combined distance
  float repulsion = repulsionOffset(p);
  d1 += repulsion;
  d2 += repulsion;

  vec3 col = uPieceColors[idx1];

  // ── Membrane detection ──
  // Where two pieces are nearly equidistant and we are near/inside the surface.
  // Use raw (pre-repulsion) difference for the equidistant test, but check
  // that the point is close to the final surface.
  bool isMembrane = false;
  float rawDiff = abs(dists[idx1] - dists[idx2]);
  if (d1 < 0.2 && d2 < 0.4 && rawDiff < MEMBRANE_HALF) {
    isMembrane = true;
  }

  // ── Eyes ──
  float eyeDist = MAX_DIST;
  for (int i = 0; i < MAX_PIECES; i++) {
    if (i >= uPieceCount) break;
    eyeDist = min(eyeDist, eyesSDF(p, uPiecePositions[i], uPieceScales[i]));
  }
  bool isEye = eyeDist < EPSILON * 2.0 && d1 < 0.15;

  return SceneResult(d1, col, isEye, isMembrane);
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
  vec3  pos;
  bool  hit;
};

MarchResult rayMarch(vec3 ro, vec3 rd) {
  float t = 0.0;
  for (int i = 0; i < MAX_STEPS; i++) {
    vec3 p  = ro + rd * t;
    float d = sceneDistOnly(p);
    if (d < EPSILON) return MarchResult(t, p, true);
    t += d;
    if (t > MAX_DIST) break;
  }
  return MarchResult(t, ro + rd * t, false);
}

// ─── Main ───────────────────────────────────────────────────

void main() {
  if (uPieceCount == 0) { gl_FragColor = vec4(0.0); return; }

  // Reconstruct camera ray
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 clipPos = vec4(ndc, -1.0, 1.0);
  vec4 viewPos = uInvProjectionMatrix * clipPos;
  viewPos.xyz /= viewPos.w;
  vec3 rd = normalize((uInvViewMatrix * vec4(normalize(viewPos.xyz), 0.0)).xyz);
  vec3 ro = uCameraPosition;

  MarchResult march = rayMarch(ro, rd);
  if (!march.hit) { gl_FragColor = vec4(0.0); return; }

  SceneResult scene = sceneSDF(march.pos);
  vec3 normal = calcNormal(march.pos);

  // ── Base colour ───────────────────────────────────────
  vec3 baseColor = scene.color;

  if (scene.isEye) {
    baseColor = vec3(0.102, 0.102, 0.18); // #1a1a2e
  }

  // ── Membrane visual treatment ─────────────────────────
  // Slightly darken + add white specular sheen (soap-film look)
  float membraneSpec = 0.0;
  if (scene.isMembrane && !scene.isEye) {
    baseColor *= 0.6;
    membraneSpec = 0.5;
  }

  // ── Lighting ──────────────────────────────────────────
  vec3 ambientColor = vec3(0.188, 0.188, 0.314);
  vec3 ambient = ambientColor * baseColor;

  vec3 lightDir = normalize(vec3(0.0, 1.0, 0.0));
  vec3 dirColor = vec3(0.4, 0.4, 0.667) * 0.3;
  float diff = max(dot(normal, lightDir), 0.0);
  vec3 diffuse = dirColor * baseColor * diff;

  float wrapVal = max(dot(normal, lightDir) * 0.5 + 0.5, 0.0);
  vec3 subsurface = baseColor * wrapVal * 0.15;

  vec3 viewDir = normalize(uCameraPosition - march.pos);
  vec3 halfVec = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, halfVec), 0.0), 64.0);
  vec3 specular = vec3(1.0) * spec * (0.3 + membraneSpec);

  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
  vec3 rim = baseColor * 1.5 * fresnel * 0.6;

  vec3 emissive = baseColor * 0.2;

  vec3 finalColor = ambient + diffuse + subsurface + specular + rim + emissive;

  if (scene.isEye) {
    finalColor = ambient + diffuse * 0.5;
  }

  float alpha = scene.isMembrane ? 0.6 : 0.85;

  gl_FragColor = vec4(finalColor, alpha);
}
`;
