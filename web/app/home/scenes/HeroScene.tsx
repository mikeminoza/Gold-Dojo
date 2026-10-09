"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, Sparkles } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { SEGMENTS, walkAt } from "../shrinePath";
import {
  GOLD,
  INK,
  MIST,
  PALE_GOLD,
  brushedTexture,
  easeInOut,
  ingotStampTextures,
  mistTexture,
  stonePathTexture,
} from "./shared";

type Props = { progress: RefObject<number>; active: boolean; still: boolean; small: boolean };

const GROUND_Y = -1.9;
// Mist, glow and sparkles live on their own layer: the main camera sees it, the contact shadow doesn't
const FX_LAYER = 1;

// The path, in scene units along -z: five gates, a lantern pair before each, the shrine hall at the end
const GATE_Z = [0, 1, 2, 3, 4].map((i) => -1.4 - i * 9);
const HALL_Z = -54;
const LANTERN_X = 3.3;
const LANTERN_Z = [...GATE_Z.map((z) => z + 3.5), HALL_Z + 8];
// Where the camera stands at each stop: the opening view, just past each gate, then into the light
const STOP_Z = [10.5, ...GATE_Z.map((z) => z - 1.2), HALL_Z + 9.5];

// The torii's measurements, gate base at y = 0
const PILLAR_X = 2.1;
const PILLAR_H = 4.4;
const NUKI_Y = 3.3;
const SHIMAKI_Y = 4.12;
const KASAGI_Y = 4.4;
const KASAGI_HALF = 3.45;

// Colours the scene shifts between as the walker reaches the light
const NIGHT = new THREE.Color(INK);
const WARM_MIST = new THREE.Color("#6e4c24");

/** A beam whose ends sweep up, flat in the middle; the shimaki, the kasagi and the hall roof use it. */
function curvedBeam(width: number, height: number, depth: number, lift = 0.42) {
  const half = width / 2;
  const g = new THREE.BoxGeometry(width, height, depth, 64, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const a = Math.min(Math.abs(x) / Math.max(half, KASAGI_HALF), 1);
    // the very tips also grow a little taller, like the cut ends of a real kasagi
    const tip = Math.max(0, Math.abs(x) / half - 0.9) * 10;
    const y = p.getY(i);
    p.setY(i, y + lift * Math.pow(a, 2.6) + (y > 0 ? tip * 0.06 : 0));
  }
  g.computeVertexNormals();
  return g;
}

/** Gold, dark lacquer and a polished gold for the top beam, plus the stone, shared by the whole scene. */
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
    // the lanterns are a paler granite, so they read against the dark ground
    const granite = new THREE.MeshStandardMaterial({ color: "#3b4554", roughness: 0.92 });
    const paper = new THREE.MeshStandardMaterial({
      color: "#2a1f12",
      emissive: "#ffbf66",
      emissiveIntensity: 1.7,
      roughness: 1,
    });
    const timber = new THREE.MeshStandardMaterial({ color: "#121821", roughness: 0.85, envMapIntensity: 0.25 });
    return { gold, polished, lacquer, stone, granite, paper, timber };
  }, []);
}

type Materials = ReturnType<typeof useMaterials>;

/** Every gate is built from the same handful of shapes, made once. */
function useToriiShapes(small: boolean) {
  return useMemo(() => {
    const seg = small ? 16 : 32;
    return {
      pillar: new THREE.CylinderGeometry(0.17, 0.215, PILLAR_H, seg),
      sleeve: new THREE.CylinderGeometry(0.245, 0.26, 0.6, seg),
      band: new THREE.TorusGeometry(0.235, 0.022, 8, seg),
      base: new THREE.CylinderGeometry(0.36, 0.4, 0.12, seg),
      nuki: new THREE.BoxGeometry(5.5, 0.26, 0.18),
      strut: new THREE.BoxGeometry(0.5, 0.62, 0.12),
      plaque: new THREE.BoxGeometry(0.38, 0.5, 0.1),
      mark: new THREE.BoxGeometry(0.07, 0.3, 0.01),
      kasagi: curvedBeam(KASAGI_HALF * 2, 0.26, 0.52),
      shimaki: curvedBeam(6.1, 0.2, 0.36),
    };
  }, [small]);
}

type Shapes = ReturnType<typeof useToriiShapes>;

/** One torii. The gates further down the path skip the smallest details nobody would see. */
function Torii({ m, g, z, detail }: { m: Materials; g: Shapes; z: number; detail: boolean }) {
  const mid = (NUKI_Y + SHIMAKI_Y) / 2;
  return (
    <group position={[0, 0, z]}>
      {[-1, 1].map((side) => (
        // pillars lean in very slightly, like the real gates
        <group key={side} position={[side * PILLAR_X, 0, 0]} rotation={[0, 0, side * 0.022]}>
          {/* hashira: the pillar, a little narrower at the top */}
          <mesh position={[0, PILLAR_H / 2, 0]} geometry={g.pillar} material={m.gold} />
          {/* kamaki: the dark lacquer sleeve at the foot, with a thin gold band on top */}
          <mesh position={[0, 0.42, 0]} geometry={g.sleeve} material={m.lacquer} />
          {detail && <mesh position={[0, 0.73, 0]} rotation-x={Math.PI / 2} geometry={g.band} material={m.polished} />}
          {/* the stone the pillar stands on */}
          <mesh position={[0, 0.06, 0]} geometry={g.base} material={m.stone} />
        </group>
      ))}
      {/* nuki: the lower tie beam, running through both pillars and out past them */}
      <mesh position={[0, NUKI_Y, 0]} geometry={g.nuki} material={m.gold} />
      {/* gakuzuka: the short strut between the beams, holding a dark plaque in a gold frame */}
      <mesh position={[0, mid, 0]} geometry={g.strut} material={m.gold} />
      <mesh position={[0, mid, 0.035]} geometry={g.plaque} material={m.lacquer} />
      {detail && <mesh position={[0, mid, 0.088]} geometry={g.mark} material={m.polished} />}
      {/* shimaki (dark) under kasagi (polished gold), both sweeping up at the ends */}
      <mesh geometry={g.shimaki} position={[0, SHIMAKI_Y, 0]} material={m.lacquer} />
      <mesh geometry={g.kasagi} position={[0, KASAGI_Y, 0]} material={m.polished} />
    </group>
  );
}

/** The five gates. Only the ones near enough to matter are drawn: behind the walker, or lost in the mist, they're skipped. */
function Gates({ m, small }: { m: Materials; small: boolean }) {
  const g = useToriiShapes(small);
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    const camZ = state.camera.position.z;
    const reach = small ? 22 : 34;
    group.current?.children.forEach((c, i) => {
      const z = GATE_Z[i];
      c.visible = z < camZ + 1 && z > camZ - reach;
    });
  });
  return (
    <group ref={group}>
      {GATE_Z.map((z, i) => (
        <Torii key={z} m={m} g={g} z={z} detail={i < 2} />
      ))}
    </group>
  );
}

/** A Kasuga-style stone lantern, as stacked parts: [geometry, height of its centre, uses the glowing paper]. */
function lanternParts() {
  return [
    [new THREE.CylinderGeometry(0.3, 0.34, 0.18, 6), 0.09, false],
    [new THREE.CylinderGeometry(0.09, 0.11, 1, 8), 0.68, false],
    [new THREE.CylinderGeometry(0.3, 0.26, 0.14, 6), 1.25, false],
    [new THREE.CylinderGeometry(0.2, 0.2, 0.38, 6), 1.51, true],
    [new THREE.ConeGeometry(0.5, 0.32, 6), 1.86, false],
    [new THREE.SphereGeometry(0.08, 10, 8), 2.08, false],
  ] as const;
}

/** Stone lanterns (tōrō) along both sides of the path, all drawn as one set of instances, each with a soft glow. */
function Lanterns({ m, small }: { m: Materials; small: boolean }) {
  const parts = useMemo(() => lanternParts(), []);
  const glow = useMemo(() => mistTexture(), []);
  const spots = useMemo(() => LANTERN_Z.flatMap((z) => [-LANTERN_X, LANTERN_X].map((x) => [x, z] as const)), []);
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  useLayoutEffect(() => {
    const mat = new THREE.Matrix4();
    parts.forEach(([, y], pi) => {
      const mesh = meshes.current[pi];
      if (!mesh) return;
      spots.forEach(([x, z], i) => mesh.setMatrixAt(i, mat.makeTranslation(x, y, z)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [parts, spots]);
  return (
    <group>
      {parts.map(([geometry, , lit], pi) => (
        <instancedMesh
          key={pi}
          ref={(el) => {
            meshes.current[pi] = el;
          }}
          args={[geometry, lit ? m.paper : m.granite, spots.length]}
        />
      ))}
      {spots.map(([x, z]) => (
        <sprite key={`${x},${z}`} position={[x, 1.55, z]} scale={small ? [1.5, 1.5, 1] : [1.9, 1.9, 1]} layers={FX_LAYER}>
          <spriteMaterial map={glow} color="#ffb85c" transparent opacity={0.5} depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
    </group>
  );
}

/** The stone path, and the dark gravel either side of it. */
function Ground() {
  const stone = useMemo(() => {
    const t = stonePathTexture();
    t.repeat.set(1, 8);
    return t;
  }, []);
  const length = 78;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, -length / 2 + 14]}>
        <planeGeometry args={[4.4, length]} />
        <meshStandardMaterial map={stone} color="#c9d2de" roughness={0.88} metalness={0.05} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, -24]}>
        <planeGeometry args={[90, 100]} />
        <meshStandardMaterial color="#09131f" metalness={0.3} roughness={0.75} />
      </mesh>
    </group>
  );
}

/** The shrine hall at the end of the path: a dark hall, a gold roof edge and a warm open doorway. */
function ShrineHall({ m }: { m: Materials }) {
  const roof = useMemo(() => curvedBeam(12.5, 0.32, 5.6, 0.7), []);
  const glow = useMemo(() => mistTexture(), []);
  const halo = useRef<THREE.SpriteMaterial>(null);
  useFrame((state) => {
    const s = (state.scene.userData.s as number | undefined) ?? 0;
    // a far-off warm point at first, growing as the walker gets close
    if (halo.current) halo.current.opacity = 0.2 + 0.3 * easeInOut((s - 3.2) / 1.8) + 0.35 * easeInOut(s - 5);
  });
  return (
    <group position={[0, 0, HALL_Z]}>
      <mesh position={[0, 0.25, 0]} material={m.stone}>
        <boxGeometry args={[12, 0.5, 7]} />
      </mesh>
      {/* the hall: matte dark timber, so the doorway's light is the brightest thing in it */}
      <mesh position={[0, 2.1, -0.5]} material={m.timber}>
        <boxGeometry args={[9, 3.2, 4]} />
      </mesh>
      {/* gold posts across the front, the middle pair framing the doorway */}
      {[-4.2, -2.05, 2.05, 4.2].map((x) => (
        <mesh key={x} position={[x, 2.1, 1.62]} material={m.gold}>
          <cylinderGeometry args={[0.15, 0.17, 3.2, 16]} />
        </mesh>
      ))}
      {/* the open doorway, lit from inside; from far off only its halo shows through the mist */}
      <mesh position={[0, 1.85, 1.52]}>
        <planeGeometry args={[3.4, 2.6]} />
        <meshBasicMaterial color="#ffd48a" toneMapped={false} />
      </mesh>
      <mesh position={[0, 3.95, -0.5]} material={m.timber}>
        <boxGeometry args={[10.6, 0.6, 5]} />
      </mesh>
      <mesh geometry={roof} position={[0, 4.4, -0.5]} material={m.polished} />
      <sprite position={[0, 1.9, 2]} scale={[16, 9, 1]} layers={FX_LAYER}>
        <spriteMaterial
          ref={halo}
          map={glow}
          color="#ffc978"
          transparent
          opacity={0.2}
          depthWrite={false}
          fog={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
      {/* light spilling out of the doorway onto the path */}
      <pointLight position={[0, 1.2, 5.5]} intensity={14} distance={16} color="#ffcf87" />
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

const INGOT_Z = -0.6;

/** The gold bar, floating under the first gate. As the walk begins it rises, turns and drifts off down the path. */
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
    const s = (state.scene.userData.s as number | undefined) ?? 0;
    const lift = easeInOut(s / 0.9);
    // it flies off down the path and is lost in the mist well before the first stop
    g.visible = s < 1;
    g.position.set(0, 0.05 + Math.sin(t * 0.9) * 0.1 * (1 - lift) + lift * 3.4, INGOT_Z - lift * 30);
    b.rotation.set(0.2 + lift * 0.4, 0.55 + t * 0.3 + lift * Math.PI * 1.4, 0);
  });
  return (
    <group ref={group} position={[0, 0.05, INGOT_Z]}>
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

type Sheet = { x: number; y: number; z: number; w: number; h: number; speed: number; opacity: number };

/** Low mist lying along the whole path; sheets slide aside and fade as the walker reaches them. */
function Mist({ small, still }: { small: boolean; still: boolean }) {
  const texture = useMemo(() => mistTexture(), []);
  const group = useRef<THREE.Group>(null);
  const sheets = useMemo(() => {
    const n = small ? 12 : 28;
    return Array.from({ length: n }, (_, i): Sheet => {
      const f = (k: number) => ((i * 37 + k * 13) % 17) / 17; // a fixed scatter, same for everyone
      const s = 5 + 5 * f(1);
      return {
        x: (i % 2 ? 1 : -1) * (1 + 7 * f(2)),
        y: -1.7 + 1.6 * f(3),
        z: 7 - (64 * (i + f(4))) / n,
        w: s * 1.9,
        h: s * 0.5,
        speed: 0.05 + f(5) * 0.07,
        opacity: 0.14 + 0.12 * f(6),
      };
    });
  }, [small]);

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    const t = still ? 0 : state.clock.elapsedTime;
    const camZ = state.camera.position.z;
    g.children.forEach((c, i) => {
      const s = sheets[i];
      const drift = ((s.x + t * s.speed + 11) % 22) - 11;
      const ahead = camZ - s.z;
      // the near sheets part to the sides, and fade so the lens never fills with fog
      const part = THREE.MathUtils.clamp(1 - ahead / 7, 0, 1) * 3;
      c.position.x = drift + Math.sign(drift || 1) * part;
      ((c as THREE.Sprite).material as THREE.SpriteMaterial).opacity = s.opacity * THREE.MathUtils.clamp((ahead - 0.8) / 3.5, 0, 1);
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

/** Where the camera is along the path for a walk position in stops (0..6). */
function pathZ(s: number) {
  const i = Math.min(Math.floor(s), SEGMENTS - 1);
  return THREE.MathUtils.lerp(STOP_Z[i], STOP_Z[i + 1], s - i);
}

/**
 * The camera: a short push-in on load, then the scroll walks it down the path. Progress is smoothed
 * here once and shared with the rest of the scene through scene.userData.s (the walk, in stops).
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
  // time since the scene started, kept here: the canvas clock restarts whenever drawing resumes
  const age = useRef(0);
  const lamp = useRef<THREE.PointLight>(null);
  useFrame((state, delta) => {
    const target = still ? 0 : progress.current;
    shown.current += (target - shown.current) * (1 - Math.exp(-delta * 6));
    const s = walkAt(shown.current);
    state.scene.userData.s = s;

    const cam = state.camera;
    age.current += Math.min(delta, 0.1);
    const intro = still ? 1 : 1 - Math.pow(1 - Math.min(age.current / 4, 1), 3);
    const start = easeInOut(s / 0.75);
    // on wide screens the gate starts right of centre beside the headline, then the walker steps onto the path
    const wide = state.size.width > 900;
    const shift = (wide ? -4.1 : 0) * (1 - start);
    // on phones the eye looks a little down, which lifts the gates into the top of the screen, above the words
    const lookY = wide ? THREE.MathUtils.lerp(1.9, 1.1, start) : THREE.MathUtils.lerp(-2.7, -1.5, start);
    const sway = still ? 0 : 1 - start * 0.7;
    const k = still ? 1 : 1 - Math.exp(-delta * 2.5);
    const ptr = pointer.current;
    // portrait screens stand a few steps further back at the start, so the whole first gate fits across
    const back = state.size.width < state.size.height ? 4 * (1 - start) : 0;
    const z = pathZ(s) + 4.5 * (1 - intro) + back;
    cam.position.x += (shift + ptr.x * 0.6 * sway - cam.position.x) * k;
    cam.position.y += (0.5 + ptr.y * 0.3 * sway - cam.position.y) * k;
    cam.position.z = z;
    cam.lookAt(shift, lookY, z - 10);

    // a warm light walks a few steps ahead, as if from the lanterns, so the nearest gate always catches some
    if (lamp.current) lamp.current.position.set(0, 1.6, z - 5);

    // at the end the mist turns warm and closes in: the walker steps into the hall's light
    const end = easeInOut(s - 5);
    const fog = state.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.lerpColors(NIGHT, WARM_MIST, end);
      fog.near = THREE.MathUtils.lerp(8, 0, end);
      fog.far = THREE.MathUtils.lerp(30, 7, end);
    }
    const bg = state.scene.background;
    if (bg instanceof THREE.Color) bg.lerpColors(NIGHT, WARM_MIST, end);
  });
  return <pointLight ref={lamp} intensity={9} distance={11} color="#ffcf87" />;
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
      camera={{ position: [small ? 0 : -4.1, 0.5, still ? STOP_Z[0] : 15], fov: small ? 66 : 42, near: 0.1, far: 80 }}
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
      <fog attach="fog" args={[INK, 8, 30]} />
      <ambientLight intensity={0.2} />
      <directionalLight position={[4, 6, 5]} intensity={1.3} color="#fff3d6" />
      <directionalLight position={[-5, 3, -6]} intensity={0.5} color={MIST} />
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
        <Ground />
        <Gates m={m} small={small} />
        <Lanterns m={m} small={small} />
        <ShrineHall m={m} />
      </group>
      <Ingot still={still} />

      {/* a soft shadow at the feet of the first gate and its lanterns, drawn once: nothing there moves */}
      <ContactShadows
        position={[0, GROUND_Y + 0.02, GATE_Z[0] + 0.8]}
        scale={[11, 8]}
        far={1.2}
        blur={2.4}
        opacity={0.75}
        resolution={small ? 256 : 512}
        frames={1}
        color="#000000"
      />
      <Mist small={small} still={still} />
      <Sparkles
        count={small ? 50 : 170}
        scale={[11, 5, 64]}
        position={[0, 1, -24]}
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
