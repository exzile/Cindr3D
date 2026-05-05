import * as THREE from 'three';

// Shared shader material for the instanced extrusion preview.
//
// Per-instance attributes (uploaded by ExtrusionInstancedMesh):
//   iA:        vec3   start endpoint in world space
//   iB:        vec3   end endpoint in world space
//   iRadius:   vec2   (start radius, end radius) — half the extrusion width
//   iColor:    vec3   bead color (already gamma-correct, used directly)
//
// The vertex shader builds an orthonormal frame from `iB - iA`, then places
// each template vertex by combining its local-frame position (`aLocal`) with
// the per-side endpoint and radius (`aSide` selects which end). Hemisphere
// caps overlap into adjacent segments which is what makes joints look
// seamless without any CPU stitching — the depth buffer handles the rest.
// Lighting deliberately uses very low specular: the previous setting
// produced a visible bright spot at every internal junction (sphere-vs-
// cylinder Blinn-Phong difference), reading as a string of bumps along
// the tube. With matte-looking shading, paired with the radius averaging
// in `extrusionInstances.ts`, the bead reads as one continuous tube.
//
// Lighting: world-space Blinn-Phong with two directional lights + ambient.
// Matches the look of OrcaSlicer/PrusaSlicer previews — bead reads as a
// rounded tube with a soft top highlight, not a flat ribbon.

const VERTEX_SHADER = /* glsl */ `
  attribute float aSide;
  attribute vec3  aLocal;
  attribute vec3  iA;
  attribute vec3  iB;
  attribute vec2  iRadius;
  attribute vec2  iHeight;
  attribute vec3  iColor;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying vec3 vColor;

  void main() {
    vec3 axis = iB - iA;
    float axisLen = length(axis);
    vec3 forward = axisLen > 1e-6 ? axis / axisLen : vec3(1.0, 0.0, 0.0);

    // Orthonormal frame. Prefer world +Z as the up reference so the ellipse
    // axes line up with layer height vs. line width — this is what makes a
    // 0.45 mm wide × 0.20 mm tall bead read correctly when the print is
    // flat-on-bed (the default view). When the segment is nearly vertical
    // (Z-seam staircase, supports), fall back to world +X.
    vec3 upRef = abs(forward.z) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
    vec3 right = normalize(cross(forward, upRef));
    vec3 up    = cross(right, forward);

    vec3 anchor = mix(iA, iB, aSide);
    float radius = mix(iRadius.x, iRadius.y, aSide);
    float halfHeight = mix(iHeight.x, iHeight.y, aSide);

    vec3 worldOffset =
        forward * (aLocal.x * radius)
      + right   * (aLocal.y * radius)
      + up      * (aLocal.z * halfHeight);

    // Instance positions are baked in world space, so transform by the
    // mesh's modelMatrix (typically identity in our scene tree) to allow
    // for any future repositioning of the preview group.
    vec4 worldPos4 = modelMatrix * vec4(anchor + worldOffset, 1.0);

    // Undo radius/height scaling before rotating the normalized surface
    // direction into world space.
    // axial bias on the cylinder body — ignored, the visual difference is
    vec3 scaledNormal = normalize(vec3(
      aLocal.x / max(radius, 1e-5),
      aLocal.y / max(radius, 1e-5),
      aLocal.z / max(halfHeight, 1e-5)
    ));
    vec3 localNormal = normalize(
        forward * scaledNormal.x
      + right   * scaledNormal.y
      + up      * scaledNormal.z
    );
    vWorldNormal = normalize((modelMatrix * vec4(localNormal, 0.0)).xyz);
    vWorldPos = worldPos4.xyz;
    vColor = iColor;
    gl_Position = projectionMatrix * viewMatrix * worldPos4;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vWorldPos;
  varying vec3 vColor;

  // Two directional lights + ambient — same character as the rest of the
  // scene's directionalLights so bead shading matches plate object shading.
  // All three vectors here live in world space and so do n / viewDir below;
  // any cross-space mix would produce flickery highlights as the camera
  // rotates, so the entire lighting eval is kept in world coordinates.
  const vec3 LIGHT_KEY_DIR  = vec3(0.408, 0.408, 0.816);
  const vec3 LIGHT_FILL_DIR = vec3(-0.4,  -0.4,  0.825);
  const float AMBIENT = 0.42;
  const float KEY_INT = 0.55;
  const float FILL_INT = 0.18;
  // Keep specular *very* low. Hemisphere caps overlap at every internal
  // junction; any noticeable spec produces a bright spot at the joint that
  // reads as a "bump" along the tube. With matte-ish shading the join
  // disappears into the cylinder body's diffuse term.
  const float SPEC_INT = 0.0;
  const float SHININESS = 14.0;

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 keyDir  = normalize(LIGHT_KEY_DIR);
    vec3 fillDir = normalize(LIGHT_FILL_DIR);
    float keyDiff  = max(dot(n, keyDir),  0.0);
    float fillDiff = max(dot(n, fillDir), 0.0);

    // Blinn-Phong specular from the key light, all in world space.
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 halfDir = normalize(keyDir + viewDir);
    float spec = pow(max(dot(n, halfDir), 0.0), SHININESS) * SPEC_INT;

    float light = AMBIENT + keyDiff * KEY_INT + fillDiff * FILL_INT;
    vec3 color = vColor * light + vec3(spec);
    gl_FragColor = vec4(color, 1.0);
  }
`;

let cached: THREE.ShaderMaterial | null = null;

export function getExtrusionMaterial(): THREE.ShaderMaterial {
  if (cached) return cached;
  cached = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.FrontSide,
    transparent: false,
  });
  cached.userData.shared = true;
  return cached;
}
