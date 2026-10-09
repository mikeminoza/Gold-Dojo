"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { GOLD, INK, MIST, PALE_GOLD, VERMILION, easeOut, mistTexture, seeded } from "./shared";

type Candle = { o: number; h: number; l: number; c: number; stop: number | null };

const LEVEL = 100; // the 100-day high in this made-up example
const STOP_GAP = 2.4; // 2 × ATR, with an ATR of 1.2
const BREAKOUT = 22; // the candle that closes above the level
const SPACING = 0.42;
const BASE = 95;
const SCALE = 0.34;
const y = (price: number) => (price - BASE) * SCALE;
const x = (i: number) => i * SPACING;

/**
 * A made-up but rule-true example: a range under the 100-day high, the close above it, the buy at
 * the next open with its stop 2 × ATR below, the stop trailing up under the highest price, and the
 * dip that finally hits it. Seeded, so it's the same every time.
 */
function buildCandles(): { candles: Candle[]; entry: number; exit: number } {
  const rand = seeded(7);
  const candles: Candle[] = [];
  let close = 97;
  for (let i = 0; i < BREAKOUT; i++) {
    const o = close;
    close = 97.4 + 1.5 * Math.sin(i * 0.9) + (rand() - 0.5) * 1.1;
    const h = Math.min(Math.max(o, close) + rand() * 0.6, 99.6);
    const l = Math.min(o, close) - rand() * 0.6;
    candles.push({ o, h: i === 9 ? LEVEL : h, l, c: close, stop: null });
  }
  // the breakout day
  const bo = close;
  close = 101.4;
  candles.push({ o: bo, h: 101.8, l: bo - 0.3, c: close, stop: null });

  // in the trade from the next open: the stop starts 2 × ATR under the entry and only ever moves up
  const entry = BREAKOUT + 1;
  let stop = close - STOP_GAP;
  let highest = close;
  let exit = -1;
  for (let i = entry; i < entry + 40; i++) {
    const o = close;
    const rising = i < entry + 16;
    close = rising ? o + 0.42 + Math.sin(i * 1.3) * 0.6 : o - 0.85 + (rand() - 0.5) * 0.4;
    const h = Math.max(o, close) + rand() * 0.5;
    const l = Math.min(o, close) - rand() * 0.5;
    if (l <= stop) {
      // the dip reaches the stop: the trade ends here, at the stop
      candles.push({ o, h, l, c: close, stop });
      exit = i;
      break;
    }
    candles.push({ o, h, l, c: close, stop });
    highest = Math.max(highest, h);
    stop = Math.max(stop, highest - STOP_GAP);
  }
  if (exit < 0) exit = candles.length - 1;
  return { candles, entry, exit };
}

/** When (0..1 of the scroll) each candle rises: the range first, then the trade. */
function revealAt(i: number, entry: number, exit: number) {
  if (i < entry) return 0.02 + 0.3 * (i / (entry - 1));
  return 0.4 + 0.52 * ((i - entry) / Math.max(1, exit - entry));
}

function Candles({ progress, still, small }: { progress: RefObject<number>; still: boolean; small: boolean }) {
  const { candles, entry, exit } = useMemo(() => buildCandles(), []);
  const glow = useMemo(() => mistTexture(), []);
  // one box and one thin cylinder, scaled per candle: far fewer GPU buffers than a shape each
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const stick = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, small ? 6 : 10), [small]);
  const mats = useMemo(
    () => ({
      up: new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.6, roughness: 0.3, emissive: GOLD, emissiveIntensity: 0.22 }),
      down: new THREE.MeshStandardMaterial({ color: "#8597ad", metalness: 0.25, roughness: 0.5, emissive: "#3a4b60", emissiveIntensity: 0.4 }),
      breakout: new THREE.MeshStandardMaterial({
        color: PALE_GOLD,
        metalness: 0.7,
        roughness: 0.2,
        emissive: GOLD,
        emissiveIntensity: 0.65,
      }),
      stop: new THREE.MeshStandardMaterial({ color: VERMILION, emissive: VERMILION, emissiveIntensity: 0.9 }),
      mark: new THREE.MeshStandardMaterial({ color: PALE_GOLD, emissive: PALE_GOLD, emissiveIntensity: 1.2, toneMapped: false }),
    }),
    [],
  );
  const shown = useRef(still ? 1 : 0);
  const camX = useRef(x(10));
  const camY = useRef(y(LEVEL));
  const candleGroup = useRef<THREE.Group>(null);
  const stopGroup = useRef<THREE.Group>(null);
  const entryMark = useRef<THREE.Group>(null);
  const exitMark = useRef<THREE.Mesh>(null);
  const breakoutGlow = useRef<THREE.Sprite>(null);
  const width = x(candles.length - 1);

  useFrame((state, delta) => {
    // ease toward the scroll position so the scene glides instead of jumping
    const goal = still ? 1 : progress.current;
    shown.current += (goal - shown.current) * (still ? 1 : 1 - Math.exp(-delta * 6));
    const p = shown.current;
    const grow = (i: number) => easeOut((p - revealAt(i, entry, exit)) / 0.05);

    candleGroup.current?.children.forEach((c, i) => {
      const k = grow(i);
      c.visible = k > 0.001;
      c.scale.y = Math.max(k, 0.001);
      c.position.y = (1 - k) * -1.5;
    });
    stopGroup.current?.children.forEach((s) => {
      s.visible = grow(s.userData.i as number) > 0.5;
    });
    if (entryMark.current) entryMark.current.visible = grow(entry) > 0.5;
    if (exitMark.current) exitMark.current.visible = grow(exit) > 0.9;
    if (breakoutGlow.current) {
      // the breakout candle's halo swells as it closes above the line, then settles
      const b = grow(BREAKOUT);
      const flare = Math.max(0, 1 - Math.max(0, p - revealAt(BREAKOUT, entry, exit)) * 8);
      (breakoutGlow.current.material as THREE.SpriteMaterial).opacity = b * (0.3 + 0.3 * flare);
    }

    // a raised three-quarter view that keeps the newest candle in frame
    let newest = 0;
    while (newest < candles.length - 1 && revealAt(newest + 1, entry, exit) <= p) newest++;
    const target = THREE.MathUtils.clamp(x(newest) - 1.2, x(10), width - x(6));
    const follow = 1 - Math.exp(-delta * 3);
    camX.current += (target - camX.current) * follow;
    // and rises with the trend, never dropping below the 100-day line
    camY.current += (Math.max(y(candles[newest].c), y(LEVEL)) - camY.current) * follow;
    const cam = state.camera;
    if (still) {
      // without motion, step back far enough to show the whole trade at once
      cam.position.set(x(BREAKOUT) + 4, 6.5, 19);
      cam.lookAt(x(BREAKOUT) + 3, 2.6, 0);
      return;
    }
    // phones are narrow, so the camera comes a little closer
    cam.position.set(camX.current + (small ? 1.6 : 2.4), camY.current + 2.6, small ? 7.6 : 9.2);
    cam.lookAt(camX.current - 0.6, camY.current - 0.2, 0);
  });

  // the stop line: a flat step for each candle in the trade, joined where it moves up
  const steps = candles.flatMap((c, i) => {
    if (c.stop === null) return [];
    const prev = candles[i - 1]?.stop ?? null;
    const parts = [
      <mesh
        key={`s${i}`}
        geometry={box}
        material={mats.stop}
        position={[x(i), y(c.stop), 0]}
        scale={[SPACING, 0.045, 0.06]}
        userData={{ i }}
      />,
    ];
    if (prev !== null && c.stop - prev > 0.01) {
      const h = y(c.stop) - y(prev);
      parts.push(
        <mesh
          key={`v${i}`}
          geometry={box}
          material={mats.stop}
          position={[x(i) - SPACING / 2, y(prev) + h / 2, 0]}
          scale={[0.045, h + 0.045, 0.06]}
          userData={{ i }}
        />,
      );
    }
    return parts;
  });

  const bo = candles[BREAKOUT];
  return (
    <>
      <group ref={candleGroup}>
        {candles.map((c, i) => {
          const mat = i === BREAKOUT ? mats.breakout : c.c >= c.o ? mats.up : mats.down;
          const bodyH = Math.max(Math.abs(y(c.c) - y(c.o)), 0.04);
          const wickH = y(c.h) - y(c.l);
          const w = i === BREAKOUT ? 0.3 : 0.24;
          return (
            <group key={i}>
              <mesh geometry={box} material={mat} position={[x(i), y(Math.min(c.o, c.c)) + bodyH / 2, 0]} scale={[w, bodyH, w]} />
              <mesh geometry={stick} material={mat} position={[x(i), y(c.l) + wickH / 2, 0]} scale={[0.018, wickH, 0.018]} />
            </group>
          );
        })}
      </group>

      {/* the 100-day high: a thin gold line with a soft glow, the level the breakout closes above */}
      <mesh position={[width / 2 - 1, y(LEVEL), 0]}>
        <boxGeometry args={[width + 4, 0.035, 0.035]} />
        <meshStandardMaterial color={PALE_GOLD} emissive={GOLD} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      <sprite position={[width / 2 - 1, y(LEVEL), -0.05]} scale={[width + 6, 0.55, 1]}>
        <spriteMaterial map={glow} color={GOLD} transparent opacity={0.4} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite ref={breakoutGlow} position={[x(BREAKOUT), y((bo.o + bo.c) / 2), -0.1]} scale={[1.6, 2.2, 1]}>
        <spriteMaterial map={glow} color={PALE_GOLD} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>

      <group ref={stopGroup}>{steps}</group>

      {/* the buy: a small pointer under the entry candle and a tick at the opening price */}
      <group ref={entryMark}>
        <mesh position={[x(entry), y(candles[entry].l) - 0.3, 0]} material={mats.mark}>
          <coneGeometry args={[0.09, 0.2, 12]} />
        </mesh>
        <mesh geometry={box} material={mats.mark} position={[x(entry) - 0.22, y(candles[entry].o), 0]} scale={[0.2, 0.04, 0.04]} />
      </group>
      {/* where the trailing stop was hit */}
      <mesh ref={exitMark} position={[x(exit), y(candles[exit].stop ?? LEVEL), 0.2]}>
        <torusGeometry args={[0.15, 0.035, 8, 24]} />
        <meshStandardMaterial color={VERMILION} emissive={VERMILION} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>

      {/* the floor the candles rise from */}
      <mesh rotation-x={-Math.PI / 2} position={[width / 2, -0.02, 0]}>
        <planeGeometry args={[width + 30, 30]} />
        <meshStandardMaterial color="#0b1624" metalness={0.3} roughness={0.8} />
      </mesh>
      <gridHelper args={[60, 60, MIST, MIST]} position={[width / 2, 0, 0]}>
        <lineBasicMaterial attach="material" color={MIST} transparent opacity={0.08} />
      </gridHelper>
    </>
  );
}

export default function CandleScene({
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
      camera={{ position: [6, 4.4, 11.5], fov: small ? 50 : 38 }}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={[INK]} />
      <fog attach="fog" args={[INK, 14, 34]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 8, 6]} intensity={1.4} color="#fff3d6" />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={2.5} color="#fff4dc" position={[0, 6, 4]} scale={[12, 3, 1]} />
        <Lightformer form="rect" intensity={1} color={MIST} position={[-8, 2, 0]} rotation-y={Math.PI / 2} scale={[10, 4, 1]} />
      </Environment>
      <Candles progress={progress} still={still} small={small} />
    </Canvas>
  );
}
