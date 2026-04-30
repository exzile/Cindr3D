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
//
// Lighting: a soft Phong-ish term using two directional lights. Matches the
// look of OrcaSlicer/PrusaSlicer previews — bead reads as a rounded tube
// with a top highlight, not a flat ribbon.

const VERTEX_SHADER = /* glsl */ `
  attribute float aSide;
  attribute vec3  aLocal;
  attribute vec3  iA;
  attribute vec3  iB;
  attribute vec2  iRadius;
  attribute vec3  iColor;

  varying vec3 vWorldNormal;
  varying vec3 vColor;
  varying vec3 vViewPos;

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

    vec3 worldOffset =
        forward * (aLocal.x * radius)
      + right   * (aLocal.y * radius)
      + up      * (aLocal.z * radius);

    vec3 worldPos = anchor + worldOffset;

    // Normal: aLocal is unit-length on the capsule surface so its rotation
    // into the world frame is the surface normal. Tapered cones get a tiny
    // axial bias on the cylinder body — ignored, the visual difference is
    // sub-pixel at slicer-preview line-width ratios.
    vec3 worldNormal = normalize(
        forward * aLocal.x
      + right   * aLocal.y
      + up      * aLocal.z
    );

    vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
    vWorldNormal = normalize((modelMatrix * vec4(worldNormal, 0.0)).xyz);
    vColor = iColor;
    vViewPos = mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vColor;
  varying vec3 vViewPos;

  // Two directional lights + ambient — same character as the rest of the
  // scene's directionalLights so bead shading matches plate object shading.
  const vec3 LIGHT_KEY_DIR  = vec3(0.408, 0.408, 0.816);
  const vec3 LIGHT_FILL_DIR = vec3(-0.4,  -0.4,  0.825);
  const float AMBIENT = 0.42;
  const float KEY_INT = 0.55;
  const float FILL_INT = 0.18;
  const float SPEC_INT = 0.14;
  const float SHININESS = 14.0;

  void main() {
    vec3 n = normalize(vWorldNormal);
    float keyDiff  = max(dot(n, normalize(LIGHT_KEY_DIR)),  0.0);
    float fillDiff = max(dot(n, normalize(LIGHT_FILL_DIR)), 0.0);

    // Specular from key light only — soft top highlight.
    vec3 viewDir = normalize(-vViewPos);
    vec3 reflectDir = reflect(-normalize(LIGHT_KEY_DIR), n);
    float spec = pow(max(dot(viewDir, reflectDir), 0.0), SHININESS) * SPEC_INT;

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
