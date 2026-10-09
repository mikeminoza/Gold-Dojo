"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, Sparkles } from "@react-three/drei";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import {
  GOLD,
  INK,
  MIST,
  PALE_GOLD,
  brushedTexture,
  easeInOut,
  easeOut,
  ingotStampTextures,
  mistTexture,
} from "./shared";

type Props = { progress: RefObject<number>; active: boolean; still: boolean; small: boolean };

// The fly-through, in scene units: the camera starts in front of the gate and ends just past it
const CAM_START_Z = 10.5;
const CAM_TRAVEL = 14;
const GATE_Z = -1.4;
const GROUND_Y = -1.9;
// Mist, glow and sparkles live on their own layer: the main camera sees it, the contact shadow doesn't
const FX_LAYER = 1;

// The torii's measurements, gate base at y = 0
const PILLAR_X = 2.1;
const PILLAR_H = 4.4;
const NUKI_Y = 3.3;
const SHIMAKI_Y = 4.12;
const KASAGI_Y = 4.4;
const KASAGI_HALF = 3.45;

/** The kasagi's sweep: flat in the middle, lifting more and more toward the ends. */
const sweep = (x: number) => 0.42 * Math.pow(Math.min(Math.abs(x) / KASAGI_HALF, 1), 2.6);

/** A beam that follows the sweep; the shimaki uses the same curve so it sits flush under the kasagi. */
function curvedBeam(width: number, height: number, depth: number) {
  const g = new THREE.BoxGeometry(width, height, depth, 64, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    // the very tips also grow a little taller, like the cut ends of a real kasagi
    const tip = Math.max(0, Math.abs(x) / (width / 2) - 0.9) * 10;
    const y = p.getY(i);
    p.setY(i, y + sweep(x) + (y > 0 ? tip * 0.06 : 0));
  }
  g.computeVertexNormals();
  return g;
}

/** Gold, dark lacquer and a polished gold for the top beam, shared by every gate in the scene. */
function useMaterials() {
  return useMemo(() => {
    const brushed = brushedTexture();
    brushed.repeat.set(1, 3);
    const gold = new THREE.MeshPhysicalMaterial({
      color: GOLD,
      metalness: 1,
      roughness: 0.62,
      roughnessMap: brushed,
      clearcoat: 0.45,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.15,
    });
    const polished = gold.clone();
    polished.roughness = 0.42;
    polished.clearcoat = 0.9;
    polished.clearcoatRoughness = 0.12;
    const lacquer = new THREE.MeshPhysicalMaterial({
      color: "#0d1219",
      metalness: 0.15,
      roughness: 0.38,
      clearcoat: 1,
      clearcoatRoughness: 0.2,
      envMapIntensity: 0.45,
    });
    const stone = new THREE.MeshStandardMaterial({ color: "#1b2533", roughness: 0.9 });
    return { gold, polished, lacquer, stone };
  }, []);
}

type Materials = ReturnType<typeof useMaterials>;

function Torii({ m, small, position }: { m: Materials; small: boolean; position: [number, number, number] }) {
  const kasagi = useMemo(() => curvedBeam(KASAGI_HALF * 2, 0.26, 0.52), []);
  const shimaki = useMemo(() => curvedBeam(6.1, 0.2, 0.36), []);
  const seg = small ? 16 : 32;
  return (
    <group position={position}>
      {[-1, 1].map((side) => (
        // pillars lean in very slightly, like the real gates
        <group key={side} position={[side * PILLAR_X, 0, 0]} rotation={[0, 0, side * 0.022]}>
          {/* hashira: the pillar, a little narrower at the top */}
          <mesh position={[0, PILLAR_H / 2, 0]} material={m.gold}>
            <cylinderGeometry args={[0.17, 0.215, PILLAR_H, seg]} />
          </mesh>
          {/* kamaki: the dark lacquer sleeve at the foot, with a thin gold band on top */}
          <mesh position={[0, 0.42, 0]} material={m.lacquer}>
            <cylinderGeometry args={[0.245, 0.26, 0.6, seg]} />
          </mesh>
          <mesh position={[0, 0.73, 0]} rotation-x={Math.PI / 2} material={m.polished}>
            <torusGeometry args={[0.235, 0.022, 8, seg]} />
          </mesh>
          {/* the stone the pillar stands on */}
          <mesh position={[0, 0.06, 0]} material={m.stone}>
            <cylinderGeometry args={[0.36, 0.4, 0.12, seg]} />
          </mesh>
        </group>
      ))}
      {/* nuki: the lower tie beam, running through both pillars and out past them */}
      <mesh position={[0, NUKI_Y, 0]} material={m.gold}>
        <boxGeometry args={[5.5, 0.26, 0.18]} />
      </mesh>
      {/* gakuzuka: the short strut between the beams, holding a dark plaque in a gold frame */}
      <mesh position={[0, (NUKI_Y + SHIMAKI_Y) / 2, 0]} material={m.gold}>
        <boxGeometry args={[0.5, 0.62, 0.12]} />
      </mesh>
      <mesh position={[0, (NUKI_Y + SHIMAKI_Y) / 2, 0.035]} material={m.lacquer}>
        <boxGeometry args={[0.38, 0.5, 0.1]} />
      </mesh>
      <mesh position={[0, (NUKI_Y + SHIMAKI_Y) / 2, 0.088]} material={m.polished}>
        <boxGeometry args={[0.07, 0.3, 0.01]} />
      </mesh>
      {/* shimaki (dark) under kasagi (polished gold), both sweeping up at the ends */}
      <mesh geometry={shimaki} position={[0, SHIMAKI_Y, 0]} material={m.lacquer} />
      <mesh geometry={kasagi} position={[0, KASAGI_Y, 0]} material={m.polished} />
    </group>
  );
}

/** A classic cast bar: wider at the base, rounded edges, and the stamp on top. */
function ingotGeometry() {
  const L = 1.7;
  const H = 0.44;
  const D = 0.82;
  const box = new RoundedBoxGeometry(L, H, D, 4, 0.07);
  // taper the sides inward toward the top
  const p = box.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + H / 2) / H;
    p.setX(i, p.getX(i) * (1 - 0.2 * t));
    p.setZ(i, p.getZ(i) * (1 - 0.16 * t));
  }
  // weld the separate faces so the bevels shade smoothly, then rebuild the normals
  box.deleteAttribute("normal");
  box.deleteAttribute("uv");
  const g = mergeVertices(box, 1e-4);
  g.computeVertexNormals();
  // the stamp is projected straight down onto the top face; everything else lands on its blank margin
  const topL = L * 0.8;
  const topD = D * 0.84;
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / topL + 0.5;
    uv[i * 2 + 1] = 0.5 - pos.getZ(i) / topD;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}

function Ingot({ still }: { still: boolean }) {
  const geometry = useMemo(() => ingotGeometry(), []);
  const stamp = useMemo(() => ingotStampTextures(), []);
  const glow = useMemo(() => mistTexture(), []);
  const group = useRef<THREE.Group>(null);
  const bar = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const g = group.current;
    const b = bar.current;
    if (!g || !b) return;
    const t = still ? 0 : state.clock.elapsedTime;
    const p = (state.scene.userData.p as number | undefined) ?? 0;
    const lift = easeInOut(p);
    // it rises and drifts back through the gate as the camera follows
    g.position.set(0, 0.05 + Math.sin(t * 0.9) * 0.1 + lift * 0.95, -lift * 7);
    b.rotation.set(0.2 + lift * 0.35, 0.55 + t * 0.3 + p * Math.PI * 1.1, 0);
  });
  return (
    <group ref={group} position={[0, 0.05, 0]}>
      <mesh ref={bar} geometry={geometry} rotation={[0.2, 0.55, 0]}>
        <meshPhysicalMaterial
          color="#E9C068"
          metalness={1}
          roughness={0.5}
          roughnessMap={stamp.rough}
          bumpMap={stamp.bump}
          bumpScale={1.6}
          clearcoat={0.7}
          clearcoatRoughness={0.08}
          envMapIntensity={1.5}
        />
      </mesh>
      {/* a soft warm glow behind the bar, drawn without any post-processing */}
      <sprite position={[0, 0, -0.6]} scale={[4.2, 2.6, 1]} layers={FX_LAYER}>
        <spriteMaterial map={glow} color={GOLD} transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <pointLight position={[0.4, 1.1, 1.8]} intensity={7} distance={6} color={PALE_GOLD} />
    </group>
  );
}

type Sheet = { x: number; y: number; z: number; w: number; h: number; speed: number; opacity: number; part: number };

/** Mist in three layers at different depths; the near sheets part to the sides as the camera moves in. */
function Mist({ small, still }: { small: boolean; still: boolean }) {
  const texture = useMemo(() => mistTexture(), []);
  const group = useRef<THREE.Group>(null);
  const sheets = useMemo(() => {
    const layers = [
      { n: small ? 3 : 5, z: [3, 6.5], y: [-1.7, -1.1], s: [4, 6], opacity: 0.16, part: 5 },
      { n: small ? 4 : 7, z: [-3.2, 1], y: [-1.7, -0.6], s: [5, 7.5], opacity: 0.2, part: 3 },
      { n: small ? 3 : 6, z: [-16, -6], y: [-1.6, 0.4], s: [7, 11], opacity: 0.26, part: 1 },
    ];
    const out: Sheet[] = [];
    layers.forEach((l, li) =>
      Array.from({ length: l.n }, (_, i) => {
        const f = (k: number) => ((i * 37 + li * 11 + k * 13) % 17) / 17; // a fixed scatter, same for everyone
        const s = l.s[0] + (l.s[1] - l.s[0]) * f(1);
        out.push({
          x: -9 + (18 * (i + f(2) * 0.6)) / l.n,
          y: l.y[0] + (l.y[1] - l.y[0]) * f(3),
          z: l.z[0] + (l.z[1] - l.z[0]) * f(4),
          w: s * 1.9,
          h: s * 0.5,
          speed: (0.06 + f(5) * 0.08) * (li === 2 ? 0.6 : 1),
          opacity: l.opacity,
          part: l.part,
        });
      }),
    );
    return out;
  }, [small]);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const t = still ? 0 : state.clock.elapsedTime;
    const p = (state.scene.userData.p as number | undefined) ?? 0;
    const camZ = state.camera.position.z;
    g.children.forEach((c, i) => {
      const s = sheets[i];
      const drift = ((s.x + t * s.speed + 11) % 22) - 11;
      // parting: each sheet slides away from the centre line, the near ones furthest
      c.position.x = drift + Math.sign(drift || 1) * easeOut(p * 1.4) * s.part;
      // sheets fade as the camera gets close to them, so the lens never fills with fog
      const near = THREE.MathUtils.clamp((camZ - s.z - 0.8) / 3.5, 0, 1);
      ((c as THREE.Sprite).material as THREE.SpriteMaterial).opacity = s.opacity * near;
    });
  });

  return (
    <group ref={group}>
      {sheets.map((s, i) => (
        <sprite key={i} position={[s.x, s.y, s.z]} scale={[s.w, s.h, 1]} layers={FX_LAYER}>
          <spriteMaterial map={texture} color={MIST} transparent opacity={s.opacity} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

/**
 * The camera: a short push-in on load, then the scroll flies it through the gate. Progress is
 * smoothed here once and shared with the ingot and mist through scene.userData.
 */
function CameraRig({
  progress,
  still,
  pointer,
}: {
  progress: RefObject<number>;
  still: boolean;
  pointer: RefObject<{ x: number; y: number }>;
}) {
  const shown = useRef(0);
  useFrame((state, delta) => {
    const target = still ? 0 : progress.current;
    shown.current += (target - shown.current) * (1 - Math.exp(-delta * 7));
    const p = shown.current;
    state.scene.userData.p = p;

    const cam = state.camera;
    const intro = still ? 1 : easeOut(state.clock.elapsedTime / 4);
    const fly = easeInOut(p);
    // on wide screens the gate starts right of centre beside the headline, then centres as we approach
    const wide = state.size.width > 900;
    const shift = (wide ? -4.1 : 0) * (1 - easeInOut((p - 0.08) / 0.6));
    const lookY = THREE.MathUtils.lerp(wide ? 1.9 : -0.6, 0.9, fly);
    const sway = still ? 0 : 1 - fly;
    const k = still ? 1 : 1 - Math.exp(-delta * 2.5);
    const ptr = pointer.current;
    cam.position.x += (shift + ptr.x * 0.7 * sway - cam.position.x) * k;
    cam.position.y += (0.5 + ptr.y * 0.35 * sway - cam.position.y) * k;
    cam.position.z = CAM_START_Z + 4.5 * (1 - intro) - CAM_TRAVEL * fly;
    cam.lookAt(shift, lookY, cam.position.z - CAM_START_Z);
  });
  return null;
}

export default function HeroScene({ progress, active, still, small }: Props) {
  const pointer = useRef({ x: 0, y: 0 });
  const m = useMaterials();
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
      dpr={[1, small ? 1.5 : 1.75]}
      frameloop={active && !still ? "always" : "demand"}
      camera={{ position: [small ? 0 : -4.1, 0.5, still ? CAM_START_Z : 14], fov: small ? 52 : 40, near: 0.1, far: 60 }}
      gl={{ antialias: !small, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl, camera }) => {
        camera.layers.enable(FX_LAYER);
        // the canvas is opaque, but the contact shadow's own render target must start transparent
        gl.setClearAlpha(0);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <color attach="background" args={[INK]} />
      <fog attach="fog" args={[INK, 8, 25]} />
      <ambientLight intensity={0.22} />
      <directionalLight position={[4, 6, 5]} intensity={1.5} color="#fff3d6" />
      <directionalLight position={[-5, 3, -6]} intensity={0.6} color={MIST} />
      <Environment resolution={small ? 64 : 128} frames={1}>
        {/* a dim warm sky inside the reflections, so no face of the metal turns black */}
        <mesh scale={30}>
          <sphereGeometry args={[1, 16, 8]} />
          <meshBasicMaterial color="#5e4526" side={THREE.BackSide} />
        </mesh>
        <Lightformer form="rect" intensity={3} color="#fff4dc" position={[0, 5, -4]} scale={[10, 2, 1]} />
        <Lightformer form="rect" intensity={1.6} color={PALE_GOLD} position={[-6, 1, 2]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={1.2} color={MIST} position={[6, 0, 2]} rotation-y={-Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={2.4} color="#fff1d0" position={[0, 1, 8]} rotation-y={Math.PI} scale={[12, 5, 1]} />
        <Lightformer form="rect" intensity={1.6} color="#ffe7b8" position={[0, 9, 2]} rotation-x={Math.PI / 2} scale={[6, 1.2, 1]} />
        <Lightformer form="ring" intensity={4} color="#fff" position={[2, 4, 6]} rotation-y={Math.PI} scale={1.5} />
      </Environment>

      <group position={[0, GROUND_Y, 0]}>
        <Torii m={m} small={small} position={[0, 0, GATE_Z]} />
        {/* more gates further down the path, fading into the night */}
        <Torii m={m} small={small} position={[0, 0, GATE_Z - 8]} />
        {!small && <Torii m={m} small={small} position={[0, 0, GATE_Z - 16]} />}
      </group>
      <Ingot still={still} />

      {/* the ground the gate stands on, with a soft shadow under the gate and the bar */}
      <mesh rotation-x={-Math.PI / 2} position={[0, GROUND_Y, -6]}>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#0c1725" metalness={0.5} roughness={0.6} />
      </mesh>
      <ContactShadows
        position={[0, GROUND_Y + 0.01, GATE_Z + 0.6]}
        scale={[11, 7]}
        far={4.5}
        blur={2.6}
        opacity={0.8}
        resolution={small ? 256 : 512}
        frames={still ? 1 : Infinity}
        color="#000000"
      />
      <Mist small={small} still={still} />
      <Sparkles
        count={small ? 50 : 160}
        scale={[14, 6, 18]}
        position={[0, 1, -4]}
        size={small ? 2.2 : 2.8}
        speed={still ? 0 : 0.25}
        opacity={0.6}
        color={PALE_GOLD}
        noise={0.6}
        layers={FX_LAYER}
      />
      <CameraRig progress={progress} still={still} pointer={pointer} />
    </Canvas>
  );
}
