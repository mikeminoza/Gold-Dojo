"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, Sparkles } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { GOLD, INK, PALE_GOLD, mistTexture } from "./shared";

type Props = { active: boolean; still: boolean; small: boolean };

/** The kasagi: the top beam, a long box whose ends lift slightly upward. */
function kasagiGeometry(width: number) {
  const g = new THREE.BoxGeometry(width, 0.3, 0.5, 48, 1, 1);
  const p = g.attributes.position;
  const half = width / 2;
  for (let i = 0; i < p.count; i++) {
    const t = p.getX(i) / half; // -1..1 along the beam
    p.setY(i, p.getY(i) + 0.34 * Math.pow(Math.abs(t), 4));
  }
  g.computeVertexNormals();
  return g;
}

/** A gold bar: a trapezoid side profile pushed out to a prism, with bevelled edges. */
function ingotGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.8, 0);
  s.lineTo(0.8, 0);
  s.lineTo(0.56, 0.5);
  s.lineTo(-0.56, 0.5);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.62,
    bevelEnabled: true,
    bevelSize: 0.05,
    bevelThickness: 0.06,
    bevelSegments: 4,
    curveSegments: 1,
  });
  g.center();
  return g;
}

function Torii({ small }: { small: boolean }) {
  const kasagi = useMemo(() => kasagiGeometry(6.6), []);
  const seg = small ? 16 : 32;
  const gold = (
    <meshPhysicalMaterial color={GOLD} metalness={1} roughness={0.3} clearcoat={0.6} clearcoatRoughness={0.25} />
  );
  return (
    <group position={[0, -1.9, 0]}>
      {/* pillars, leaning in very slightly like the real gates */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 2.15, 0, 0]} rotation={[0, 0, side * 0.025]}>
          <mesh position={[0, 2.25, 0]}>
            <cylinderGeometry args={[0.2, 0.24, 4.5, seg]} />
            {gold}
          </mesh>
          {/* the dark collar at the foot */}
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.3, 0.32, 0.24, seg]} />
            <meshStandardMaterial color={INK} metalness={0.4} roughness={0.6} />
          </mesh>
        </group>
      ))}
      {/* nuki: the lower crossbeam, running through the pillars */}
      <mesh position={[0, 3.55, 0]}>
        <boxGeometry args={[5.4, 0.24, 0.2]} />
        {gold}
      </mesh>
      {/* gakuzuka: the short post between the beams */}
      <mesh position={[0, 3.95, 0]}>
        <boxGeometry args={[0.26, 0.62, 0.18]} />
        {gold}
      </mesh>
      {/* shimaki under the kasagi, then the kasagi on top */}
      <mesh position={[0, 4.36, 0]}>
        <boxGeometry args={[5.9, 0.2, 0.36]} />
        {gold}
      </mesh>
      <mesh geometry={kasagi} position={[0, 4.6, 0]}>
        <meshPhysicalMaterial color={GOLD} metalness={1} roughness={0.22} clearcoat={1} clearcoatRoughness={0.15} />
      </mesh>
    </group>
  );
}

function Ingot({ still }: { still: boolean }) {
  const geometry = useMemo(() => ingotGeometry(), []);
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const m = ref.current;
    if (!m || still) return;
    const t = state.clock.elapsedTime;
    m.rotation.y = 0.5 + t * 0.35;
    m.position.y = 0.05 + Math.sin(t * 0.9) * 0.12;
  });
  return (
    <mesh ref={ref} geometry={geometry} position={[0, 0.05, 0]} rotation={[0.18, 0.5, 0]}>
      <meshPhysicalMaterial
        color={PALE_GOLD}
        metalness={1}
        roughness={0.16}
        envMapIntensity={1.6}
        clearcoat={1}
        clearcoatRoughness={0.05}
        emissive={GOLD}
        emissiveIntensity={0.08}
      />
    </mesh>
  );
}

/** Soft sheets of mist drifting slowly across the ground. */
function Mist({ small, still }: { small: boolean; still: boolean }) {
  const texture = useMemo(() => mistTexture(), []);
  const group = useRef<THREE.Group>(null);
  const sheets = useMemo(() => {
    const n = small ? 5 : 9;
    return Array.from({ length: n }, (_, i) => ({
      x: -8 + (16 * i) / n + ((i * 37) % 5) * 0.3,
      y: -1.7 + ((i * 13) % 4) * 0.35,
      z: -3 + ((i * 29) % 7) * 0.9,
      s: 5 + ((i * 7) % 4) * 1.4,
      speed: 0.08 + ((i * 11) % 5) * 0.025,
    }));
  }, [small]);
  useFrame((state) => {
    const g = group.current;
    if (!g || still) return;
    const t = state.clock.elapsedTime;
    g.children.forEach((c, i) => {
      const s = sheets[i];
      c.position.x = ((s.x + t * s.speed + 10) % 20) - 10;
    });
  });
  return (
    <group ref={group}>
      {sheets.map((s, i) => (
        <sprite key={i} position={[s.x, s.y, s.z]} scale={[s.s * 1.8, s.s * 0.55, 1]}>
          <spriteMaterial map={texture} color="#8fa3ba" transparent opacity={0.22} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

/** The one orchestrated moment: the camera pushes in on load, then follows the pointer a little. */
function CameraRig({ still, pointer }: { still: boolean; pointer: React.RefObject<{ x: number; y: number }> }) {
  useFrame((state, delta) => {
    const cam = state.camera;
    const t = Math.min(state.clock.elapsedTime / 4, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    const z = still ? 9.5 : 14 - 4.5 * ease;
    const p = pointer.current;
    const k = 1 - Math.exp(-delta * 2.5);
    // on wide screens the gate stands right of centre, leaving the left side to the headline
    const wide = state.size.width > 900;
    const shift = wide ? -2.3 : 0;
    // on narrow screens the gate sits higher, above the headline
    const lookY = wide ? 0.6 : -1.2;
    const tx = shift + (still ? 0 : p.x * 0.7);
    const ty = still ? 0.5 : 0.5 + p.y * 0.35;
    cam.position.x += (tx - cam.position.x) * k;
    cam.position.y += (ty - cam.position.y) * k;
    cam.position.z = z;
    cam.lookAt(shift, lookY, 0);
  });
  return null;
}

export default function HeroScene({ active, still, small }: Props) {
  const pointer = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (still) return;
    const move = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / innerWidth) * 2 - 1;
      pointer.current.y = -((e.clientY / innerHeight) * 2 - 1);
    };
    addEventListener("pointermove", move, { passive: true });
    return () => removeEventListener("pointermove", move);
  }, [still]);

  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={active && !still ? "always" : "demand"}
      camera={{ position: [0, 0.5, still ? 9.5 : 14], fov: small ? 52 : 40 }}
      gl={{ antialias: !small, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <color attach="background" args={[INK]} />
      <fog attach="fog" args={[INK, 10, 30]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[4, 6, 5]} intensity={1.6} color="#fff3d6" />
      <pointLight position={[0.6, 1.2, 2.2]} intensity={8} distance={7} color={PALE_GOLD} />
      <Environment resolution={small ? 64 : 128} frames={1}>
        {/* a dim warm sky inside the reflections, so no face of the metal turns black */}
        <mesh scale={30}>
          <sphereGeometry args={[1, 16, 8]} />
          <meshBasicMaterial color="#7a5c30" side={THREE.BackSide} />
        </mesh>
        <Lightformer form="rect" intensity={3} color="#fff4dc" position={[0, 5, -4]} scale={[10, 2, 1]} />
        <Lightformer form="rect" intensity={1.6} color={PALE_GOLD} position={[-6, 1, 2]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#8fa3ba" position={[6, 0, 2]} rotation-y={-Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={2.4} color="#fff1d0" position={[0, 1, 8]} rotation-y={Math.PI} scale={[12, 5, 1]} />
        <Lightformer form="ring" intensity={4} color="#fff" position={[2, 4, 6]} rotation-y={Math.PI} scale={1.5} />
      </Environment>

      <group position={[0, 0, -1.4]}>
        <Torii small={small} />
      </group>
      <Ingot still={still} />

      {/* the ground the gate stands on, fading into the fog */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -1.9, 0]}>
        <circleGeometry args={[30, small ? 24 : 48]} />
        <meshStandardMaterial color="#0b1624" metalness={0.6} roughness={0.55} />
      </mesh>
      <Mist small={small} still={still} />
      <Sparkles
        count={small ? 60 : 180}
        scale={[14, 6, 8]}
        position={[0, 1, -1]}
        size={small ? 2.2 : 2.8}
        speed={still ? 0 : 0.25}
        opacity={0.65}
        color={PALE_GOLD}
        noise={0.6}
      />
      <CameraRig still={still} pointer={pointer} />
    </Canvas>
  );
}
