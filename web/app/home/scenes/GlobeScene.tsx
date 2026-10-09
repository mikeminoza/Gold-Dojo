"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { GOLD, LACQUER, PALE_GOLD, clamp01, dotTexture, easeOut } from "./shared";

const R = 1;

/** Latitude/longitude in degrees to a point on the globe. */
function toVec(lat: number, lon: number, r = R) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

// Rough coastlines as [lat, lon] outlines: coarse, but enough for every continent to read at a glance
const LAND: [number, number][][] = [
  // North America
  [[71, -157], [70, -143], [69, -133], [68, -115], [68, -100], [66, -87], [62, -93], [58, -94], [55, -82], [51, -79],
   [55, -77], [60, -78], [62, -75], [60, -65], [54, -57], [47, -53], [45, -62], [44, -66], [41, -70], [39, -74],
   [35, -76], [31, -81], [27, -80], [25, -80.5], [29, -83], [30, -88], [29, -94], [26, -97], [22, -98], [19, -96],
   [18, -94], [21, -87], [18, -88], [15, -84], [11, -84], [9, -79], [8, -77], [7, -80], [9, -85], [13, -88],
   [15, -93], [16, -96], [19, -105], [23, -106], [28, -112], [31, -113], [23, -110], [28, -115], [32, -117],
   [35, -121], [40, -124], [46, -124], [49, -125], [54, -130], [58, -136], [60, -142], [60, -147], [59, -152],
   [57, -157], [55, -163], [58, -158], [60, -162], [63, -165], [66, -164], [68, -166]],
  // Greenland, Baffin Island and the Arctic islands
  [[83, -35], [82, -20], [77, -18], [70, -22], [65, -38], [60, -43], [65, -52], [70, -54], [76, -67], [78, -72], [82, -60]],
  [[62, -66], [66, -62], [70, -68], [73, -78], [70, -88], [66, -80], [63, -75]],
  [[73, -80], [76, -80], [80, -70], [83, -75], [80, -95], [76, -105], [73, -115], [71, -120], [69, -110], [70, -90]],
  // Cuba
  [[23, -83], [22, -78], [20, -74], [20, -77], [22, -80]],
  // South America
  [[12, -72], [11, -64], [10, -61], [7, -58], [5, -52], [2, -50], [-1, -48], [-3, -40], [-5, -35], [-8, -35],
   [-13, -38], [-18, -39], [-23, -42], [-25, -47], [-29, -49], [-33, -52], [-35, -56], [-37, -57], [-39, -62],
   [-42, -64], [-46, -67], [-50, -69], [-53, -69], [-55, -67], [-55, -71], [-52, -75], [-46, -75], [-40, -74],
   [-33, -72], [-27, -71], [-18, -70], [-15, -76], [-6, -81], [-2, -80], [1, -79], [4, -77], [8, -77], [9, -76], [11, -75]],
  // Europe and Asia, with Arabia
  [[36, -6], [37, -9], [43, -9], [43.5, -2], [46, -1], [48, -4.5], [49, 0], [51, 2], [53, 5], [54, 8.5], [57, 8],
   [57.5, 10.5], [55.5, 12.5], [54, 11], [54.5, 14], [54.5, 19], [57, 21], [59, 23], [60, 29], [61, 22], [64, 21],
   [66, 24], [65.5, 22], [63, 18], [60, 18], [56, 16], [56, 13], [59, 11], [58, 6], [62, 5], [65, 12], [68, 14],
   [70, 19], [71, 26], [70, 31], [69, 36], [66, 41], [68, 44], [68, 54], [69, 60], [73, 70], [71, 73], [73, 80],
   [76, 88], [77, 104], [76, 112], [73, 118], [72, 130], [71, 140], [71, 152], [70, 160], [69, 170], [66, 180],
   [64, 178], [62, 173], [60, 165], [57, 163], [52, 156], [56, 156], [60, 160], [62, 163], [59, 150], [59, 142],
   [54, 140], [51, 141], [47, 139], [43, 135], [40, 129], [35, 129], [35, 126], [38, 126], [39, 125], [40, 122],
   [39, 118], [37, 119], [37, 122], [35, 119], [31, 122], [28, 121], [25, 119], [22, 114], [21, 110], [19, 106],
   [16, 108], [12, 109], [10, 106], [9, 105], [10, 104], [13, 100], [10, 99], [7, 100], [1, 104], [3, 101], [7, 98],
   [12, 98], [16, 97], [17, 94], [21, 92], [22, 89], [21, 87], [16, 82], [13, 80], [8, 77], [10, 76], [15, 74],
   [20, 73], [22, 70], [24, 67], [25, 62], [25, 57], [27, 56], [24, 56], [22, 60], [17, 55], [13, 45], [17, 43],
   [21, 39], [28, 34], [30, 32.5], [31, 32], [33, 35], [36, 36], [37, 30], [36.5, 27], [39, 26.5], [41, 29], [41, 28],
   [40.5, 26], [40, 23], [37, 22], [38, 21], [40, 19.5], [42, 19], [45, 13.5], [44, 12.5], [41, 16], [40, 18.5],
   [38, 16], [38, 15.5], [41, 13], [44, 9], [43.5, 7], [43, 3], [41.5, 3], [40, 0], [38, 0], [36, -2]],
  // Britain, Ireland, Iceland, Svalbard, Novaya Zemlya
  [[50, -5], [51, 1], [53, 0], [55, -1.5], [57.5, -2], [58.5, -3], [58.5, -5], [57, -6], [55, -5], [54, -3], [53, -4.5], [51.5, -5]],
  [[52, -10], [54, -10], [55, -7], [54, -6], [52, -6]],
  [[64, -22], [66, -22], [66, -15], [64.5, -14], [63.5, -19]],
  [[80, 10], [80, 27], [77, 22], [77, 15]],
  [[76, 68], [72, 56], [71, 52], [73, 54], [75, 60]],
  // Africa and Madagascar
  [[36, -6], [35, -2], [37, 10], [33, 11], [30.5, 19], [32, 25], [31, 32], [28, 34], [22, 37], [15, 39.5], [12, 43],
   [11, 51], [2, 46], [-4, 40], [-10, 40], [-15, 40.5], [-20, 35], [-25, 35], [-29, 32], [-34, 26], [-34.5, 20],
   [-30, 17], [-22, 14], [-17, 11.5], [-12, 13.5], [-6, 12], [-1, 9], [4, 8], [4.5, 6], [6, 1], [5, -4], [4.5, -8],
   [7.5, -13], [11, -16], [15, -17.5], [21, -17], [27, -13], [31, -10], [34, -7]],
  [[-12, 49], [-16, 50], [-25, 47], [-25, 44], [-21, 43.5], [-16, 44.5]],
  // Japan, Sakhalin, Taiwan, Sri Lanka
  [[45, 142], [43, 145], [41, 141], [38, 141], [35, 140], [34, 136], [33, 131], [31, 131], [34, 130], [35, 133], [37, 137], [40, 140], [42, 140]],
  [[54, 142], [46, 143], [46, 142]],
  [[25, 121.5], [22, 121], [23, 120]],
  [[9.8, 80], [6, 81.8], [6, 80], [8, 79.8]],
  // The Philippines: Luzon, the Visayas, Mindanao
  [[18.5, 121], [16, 122], [14, 124], [13, 121], [16, 120]],
  [[12, 124], [10, 126], [9, 123], [11, 122]],
  [[9.5, 126], [6, 126], [6, 122], [8, 122], [9, 124]],
  // Indonesia and New Guinea
  [[5.5, 95], [2, 99], [-3, 104], [-6, 106], [-4, 102], [0, 99]],
  [[7, 117], [1, 119], [-4, 116], [-3, 111], [1, 109], [4, 113]],
  [[-6, 106], [-7, 114], [-8, 114], [-8, 106]],
  [[1, 125], [-5, 122], [-5, 120], [1, 120]],
  [[-1, 131], [-3, 141], [-6, 148], [-10, 150], [-8, 143], [-9, 140], [-4, 135]],
  // Australia and New Zealand
  [[-11, 142], [-17, 141], [-12, 136], [-12, 131], [-14, 127], [-20, 119], [-22, 114], [-26, 113], [-32, 115],
   [-35, 117], [-34, 123], [-32, 128], [-32, 133], [-35, 136], [-35, 139], [-38, 140], [-39, 146], [-37, 150],
   [-33, 152], [-28, 153.5], [-24, 152], [-19, 147], [-15, 145]],
  [[-35, 173], [-41, 176], [-41, 174]],
  [[-41, 173], [-46, 170], [-46, 167], [-44, 169]],
];

/** Even-odd point-in-outline test in plain latitude/longitude. */
function inside(lat: number, lon: number, poly: [number, number][]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ai, oi] = poly[i];
    const [aj, oj] = poly[j];
    if (ai > lat !== aj > lat && lon < ((oj - oi) * (lat - ai)) / (aj - ai) + oi) hit = !hit;
  }
  return hit;
}

const isLand = (lat: number, lon: number) => lat < -71 || LAND.some((p) => inside(lat, lon, p));

/** Evenly spread points over the sphere (a Fibonacci spiral), keeping the ones on land. */
function landDots(count: number) {
  const pts: number[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const yy = 1 - (i / (count - 1)) * 2;
    const lat = THREE.MathUtils.radToDeg(Math.asin(yy));
    const lon = ((((THREE.MathUtils.radToDeg(i * golden) % 360) + 540) % 360) - 180);
    if (!isLand(lat, lon)) continue;
    const v = toVec(lat, lon, R * 1.004);
    pts.push(v.x, v.y, v.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

const MANILA: [number, number] = [14.6, 121];
const CITIES: [number, number][] = [
  [46.2, 6.1], // Geneva
  [51.5, -0.1], // London
  [40.7, -74], // New York
  [1.3, 103.8], // Singapore
  [35.7, 139.7], // Tokyo
];

/** A gold arc lifted off the surface between two places. */
function arcCurve(a: [number, number], b: [number, number]) {
  const va = toVec(...a);
  const vb = toVec(...b);
  const lift = 1 + va.angleTo(vb) * 0.16;
  const mid = va.clone().add(vb).normalize().multiplyScalar(lift);
  const c1 = va.clone().lerp(mid, 0.6).normalize().multiplyScalar(lift * 0.98);
  const c2 = vb.clone().lerp(mid, 0.6).normalize().multiplyScalar(lift * 0.98);
  return new THREE.CubicBezierCurve3(va, c1, c2, vb);
}

// Edge glow: brightest where the surface turns away from the viewer. Used twice: a thin rim on the
// globe itself, and a wider halo on the back of a bigger sphere around it.
const glowShader = {
  vertexShader: `varying vec3 vN; varying vec3 vV;
    void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vN; varying vec3 vV; uniform vec3 uColor; uniform float uPower; uniform float uStrength; uniform float uRim;
    void main() {
      float d = abs(dot(vN, vV));
      float f = uRim > 0.5 ? pow(1.0 - d, uPower) : pow(d, uPower);
      gl_FragColor = vec4(uColor, f * uStrength);
    }`,
};

const TUBE_SEGMENTS = 96;
const TUBE_SIDES = 6;
const TRAIL = 6; // dots in each travelling pulse

function Globe({ progress, small, still }: { progress: RefObject<number>; small: boolean; still: boolean }) {
  const dots = useMemo(() => landDots(small ? 9000 : 20000), [small]);
  const dot = useMemo(() => dotTexture(), []);
  const arcs = useMemo(() => CITIES.map((c) => arcCurve(c, MANILA)), []);
  const tubes = useMemo(() => arcs.map((a) => new THREE.TubeGeometry(a, TUBE_SEGMENTS, 0.0045, TUBE_SIDES)), [arcs]);
  const rim = useMemo(
    () => ({ uColor: { value: new THREE.Color(PALE_GOLD) }, uPower: { value: 3 }, uStrength: { value: 0.55 }, uRim: { value: 1 } }),
    [],
  );
  const halo = useMemo(
    () => ({ uColor: { value: new THREE.Color(GOLD) }, uPower: { value: 3.2 }, uStrength: { value: 0.75 }, uRim: { value: 0 } }),
    [],
  );
  const manila = useMemo(() => {
    const at = toVec(...MANILA, R * 1.006);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), at.clone().normalize());
    return { at, q };
  }, []);
  const spin = useRef<THREE.Group>(null);
  const pulses = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const shown = useRef(still ? 1 : 0);
  const idle = useRef(0);

  useFrame((state, delta) => {
    const target = still ? 1 : progress.current;
    shown.current += (target - shown.current) * (still ? 1 : 1 - Math.exp(-delta * 5));
    const p = shown.current;
    if (!still) idle.current += Math.min(delta, 0.1) * 0.035;
    // turned so Europe and Asia face the camera mid-section; scrolling past turns it east to west
    if (spin.current) spin.current.rotation.y = -3.3 + (p - 0.5) * 1.1 + idle.current;

    // each route draws itself from its city toward Manila as the section comes in, one after another
    tubes.forEach((g, i) => {
      const k = easeOut((p - 0.12 - i * 0.05) / 0.22);
      g.setDrawRange(0, Math.floor(k * TUBE_SEGMENTS) * TUBE_SIDES * 6);
    });

    const t = state.clock.elapsedTime;
    pulses.current?.children.forEach((trail, i) => {
      const drawn = clamp01((p - 0.12 - i * 0.05) / 0.22) >= 1;
      trail.visible = drawn && !still;
      if (!trail.visible) return;
      const u = (t * 0.2 + i * 0.29) % 1;
      trail.children.forEach((m, j) => {
        const uj = u - j * 0.012;
        m.visible = uj > 0;
        if (uj > 0) m.position.copy(arcs[i].getPoint(uj));
        m.scale.setScalar((1 - j / TRAIL) * (0.6 + Math.sin(uj * Math.PI) * 0.7));
      });
    });

    if (ring.current) {
      const r = still ? 0.5 : (t * 0.6) % 1;
      ring.current.scale.setScalar(1 + r * 2.4);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - r);
    }
  });

  return (
    // tipped so the northern routes are in view
    <group rotation={[0.35, 0, 0]}>
      <group ref={spin} rotation={[0, -3.3, 0]}>
        <mesh>
          <sphereGeometry args={[R, small ? 40 : 64, small ? 28 : 48]} />
          <meshStandardMaterial color={LACQUER} metalness={0.2} roughness={0.8} />
        </mesh>
        <points geometry={dots}>
          <pointsMaterial
            color="#b9c8d8"
            map={dot}
            alphaTest={0.5}
            size={small ? 0.024 : 0.019}
            sizeAttenuation
            transparent
            opacity={0.95}
            depthWrite={false}
          />
        </points>
        {tubes.map((g, i) => (
          <mesh key={i} geometry={g}>
            <meshBasicMaterial color={GOLD} transparent opacity={0.9} toneMapped={false} />
          </mesh>
        ))}
        {CITIES.map((at, i) => (
          <mesh key={i} position={toVec(...at, R * 1.006)}>
            <sphereGeometry args={[0.012, 8, 8]} />
            <meshBasicMaterial color={PALE_GOLD} />
          </mesh>
        ))}
        {/* Manila: a brighter point with a ring that keeps spreading out from it */}
        <mesh position={manila.at}>
          <sphereGeometry args={[0.022, 12, 12]} />
          <meshBasicMaterial color={PALE_GOLD} toneMapped={false} />
        </mesh>
        <mesh ref={ring} position={manila.at} quaternion={manila.q}>
          <ringGeometry args={[0.026, 0.032, 32]} />
          <meshBasicMaterial color={PALE_GOLD} transparent depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
        <group ref={pulses}>
          {arcs.map((a, i) => (
            <group key={i}>
              {Array.from({ length: TRAIL }, (_, j) => (
                <mesh key={j} position={a.getPoint(0)}>
                  <sphereGeometry args={[0.016, 8, 8]} />
                  <meshBasicMaterial
                    color={PALE_GOLD}
                    transparent
                    opacity={1 - j / TRAIL}
                    blending={THREE.AdditiveBlending}
                    depthWrite={false}
                    toneMapped={false}
                  />
                </mesh>
              ))}
            </group>
          ))}
        </group>
      </group>
      <mesh scale={1.002}>
        <sphereGeometry args={[R, 48, 32]} />
        <shaderMaterial args={[{ ...glowShader, uniforms: rim }]} transparent blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh scale={1.16}>
        <sphereGeometry args={[R, 48, 32]} />
        <shaderMaterial
          args={[{ ...glowShader, uniforms: halo }]}
          transparent
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export default function GlobeScene({
  progress,
  active,
  still,
  small,
}: {
  progress: RefObject<number>;
  active: boolean;
  still: boolean;
  small: boolean;
}) {
  return (
    <Canvas
      dpr={[1, small ? 1.5 : 1.75]}
      frameloop={active && !still ? "always" : "demand"}
      camera={{ position: [0, 0, 3.7], fov: 40 }}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[-3, 2, 4]} intensity={1.4} color="#fff3d6" />
      <Globe progress={progress} small={small} still={still} />
    </Canvas>
  );
}
