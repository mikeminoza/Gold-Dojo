"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { GOLD, LACQUER, MIST, PALE_GOLD } from "./shared";

const R = 1;

/** Latitude/longitude in degrees to a point on the globe. */
function toVec(lat: number, lon: number, r = R) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

// Rough continents as overlapping ovals (lat, lon, lat radius, lon radius): enough to read as land
const LAND: [number, number, number, number][] = [
  [50, -100, 18, 32], [62, -110, 10, 40], [30, -100, 12, 16], [18, -95, 8, 10], [70, -45, 10, 18],
  [-12, -60, 18, 15], [-35, -65, 12, 7],
  [50, 15, 12, 25], [60, 40, 10, 40], [40, 0, 6, 10],
  [10, 20, 20, 22], [-15, 25, 16, 13], [25, 10, 10, 20],
  [50, 90, 15, 50], [30, 80, 12, 25], [25, 105, 12, 18], [62, 120, 10, 40], [15, 78, 9, 7],
  [0, 112, 6, 14], [12, 122, 5, 3], [36, 138, 5, 4],
  [-25, 134, 10, 17],
];

function isLand(lat: number, lon: number) {
  return LAND.some(([la, lo, rl, rn]) => {
    const dLon = ((lon - lo + 540) % 360) - 180;
    return ((lat - la) / rl) ** 2 + (dLon / rn) ** 2 <= 1;
  });
}

/** Evenly spread points over the sphere (a Fibonacci spiral), keeping the ones on land. */
function landDots(count: number) {
  const pts: number[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const yy = 1 - (i / (count - 1)) * 2;
    const lat = THREE.MathUtils.radToDeg(Math.asin(yy));
    const lon = ((THREE.MathUtils.radToDeg(i * golden) % 360) + 540) % 360 - 180;
    if (!isLand(lat, lon)) continue;
    const v = toVec(lat, lon, R * 1.003);
    pts.push(v.x, v.y, v.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

const MANILA: [number, number] = [14.6, 121];
const CITIES: { name: string; at: [number, number] }[] = [
  { name: "Geneva", at: [46.2, 6.1] },
  { name: "London", at: [51.5, -0.1] },
  { name: "New York", at: [40.7, -74] },
];

/** A gold arc lifted off the surface between two cities. */
function arcCurve(a: [number, number], b: [number, number]) {
  const va = toVec(...a);
  const vb = toVec(...b);
  const lift = 1 + va.angleTo(vb) * 0.14;
  const mid = va.clone().add(vb).normalize().multiplyScalar(lift);
  const c1 = va.clone().lerp(mid, 0.6).normalize().multiplyScalar(lift * 0.98);
  const c2 = vb.clone().lerp(mid, 0.6).normalize().multiplyScalar(lift * 0.98);
  return new THREE.CubicBezierCurve3(va, c1, c2, vb);
}

// The soft glow around the globe's edge: drawn on the inside of a slightly bigger sphere, fading outward
const rimShader = {
  vertexShader: `varying vec3 vN; varying vec3 vV;
    void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vN; varying vec3 vV; uniform vec3 uColor;
    void main() { float f = pow(abs(dot(vN, vV)), 1.6); gl_FragColor = vec4(uColor, f * 0.5); }`,
};

function Globe({ small, still }: { small: boolean; still: boolean }) {
  const dots = useMemo(() => landDots(small ? 5000 : 11000), [small]);
  const arcs = useMemo(() => CITIES.map((c) => arcCurve(c.at, MANILA)), []);
  const arcPoints = useMemo(() => arcs.map((a) => a.getPoints(small ? 40 : 80)), [arcs, small]);
  const rimUniforms = useMemo(() => ({ uColor: { value: new THREE.Color(GOLD) } }), []);
  const spin = useRef<THREE.Group>(null);
  const pulses = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    if (still) return;
    if (spin.current) spin.current.rotation.y += Math.min(delta, 0.1) * 0.04;
    const t = state.clock.elapsedTime;
    pulses.current?.children.forEach((m, i) => {
      const u = (t * 0.22 + i * 0.37) % 1;
      m.position.copy(arcs[i].getPoint(u));
      m.scale.setScalar(0.6 + Math.sin(u * Math.PI) * 0.6);
    });
  });

  return (
    // turned so Europe and Asia face the camera, tipped so the northern routes are in view
    <group rotation={[0.35, 0, 0]}>
      <group ref={spin} rotation={[0, -3, 0]}>
        <mesh>
          <sphereGeometry args={[R, small ? 32 : 64, small ? 24 : 48]} />
          <meshStandardMaterial color={LACQUER} metalness={0.2} roughness={0.85} />
        </mesh>
        <points geometry={dots}>
          <pointsMaterial color={MIST} size={small ? 0.016 : 0.012} sizeAttenuation transparent opacity={0.75} depthWrite={false} />
        </points>
        {arcPoints.map((pts, i) => (
          <Line key={i} points={pts} color={GOLD} lineWidth={1.4} transparent opacity={0.85} />
        ))}
        {[...CITIES.map((c) => c.at), MANILA].map((at, i) => (
          <mesh key={i} position={toVec(...at, R * 1.006)}>
            <sphereGeometry args={[0.014, 8, 8]} />
            <meshBasicMaterial color={PALE_GOLD} />
          </mesh>
        ))}
        <group ref={pulses}>
          {arcs.map((a, i) => (
            <mesh key={i} position={a.getPoint(0.5)}>
              <sphereGeometry args={[0.018, 10, 10]} />
              <meshBasicMaterial color={PALE_GOLD} toneMapped={false} />
            </mesh>
          ))}
        </group>
      </group>
      <mesh scale={1.1}>
        <sphereGeometry args={[R, 48, 32]} />
        <shaderMaterial
          args={[{ ...rimShader, uniforms: rimUniforms }]}
          transparent
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export default function GlobeScene({ active, still, small }: { active: boolean; still: boolean; small: boolean }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={active && !still ? "always" : "demand"}
      camera={{ position: [0, 0, 3.7], fov: 40 }}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[-3, 2, 4]} intensity={1.1} color="#fff3d6" />
      <Globe small={small} still={still} />
    </Canvas>
  );
}
