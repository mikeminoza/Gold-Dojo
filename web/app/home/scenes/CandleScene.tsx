"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { GOLD, INK, MIST, PALE_GOLD, VERMILION, mistTexture, seeded } from "./shared";

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

const ease = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);

function Candles({ progress, still }: { progress: RefObject<number>; still: boolean }) {
  const { candles, entry, exit } = useMemo(() => buildCandles(), []);
  const glow = useMemo(() => mistTexture(), []);
  const shown = useRef(still ? 1 : 0);
  const candleGroup = useRef<THREE.Group>(null);
  const stopGroup = useRef<THREE.Group>(null);
  const entryMark = useRef<THREE.Mesh>(null);
  const exitMark = useRef<THREE.Mesh>(null);
  const width = x(candles.length - 1);

  useFrame((state, delta) => {
    // ease toward the scroll position so the scene glides instead of jumping
    const target = still ? 1 : progress.current;
    shown.current += (target - shown.current) * (still ? 1 : 1 - Math.exp(-delta * 6));
    const p = shown.current;
    const grow = (i: number) => ease((p - revealAt(i, entry, exit)) / 0.05);

    candleGroup.current?.children.forEach((c, i) => {
      const k = grow(i);
      c.visible = k > 0.001;
      c.scale.y = Math.max(k, 0.001);
      c.position.y = (1 - k) * -1.5;
    });
    stopGroup.current?.children.forEach((s) => {
      const i = s.userData.i as number;
      s.visible = grow(i) > 0.5;
    });
    if (entryMark.current) entryMark.current.visible = grow(entry) > 0.5;
    if (exitMark.current) exitMark.current.visible = grow(exit) > 0.9;

    // the camera drifts along with the newest candle
    const cam = state.camera;
    const camX = THREE.MathUtils.lerp(x(10), width - x(8), Math.min(p / 0.92, 1));
    cam.position.set(camX + 1.4, 2.1, 9.5);
    cam.lookAt(camX - 0.6, 2.9, 0);
  });

  const upMat = <meshStandardMaterial color={GOLD} metalness={0.8} roughness={0.3} emissive={GOLD} emissiveIntensity={0.12} />;
  const downMat = <meshStandardMaterial color="#6b7f97" metalness={0.5} roughness={0.45} />;

  // the stop line: a flat step for each candle in the trade, joined where it moves up
  const steps = candles.flatMap((c, i) => {
    if (c.stop === null) return [];
    const prev = candles[i - 1]?.stop ?? null;
    const parts = [
      <mesh key={`s${i}`} position={[x(i), y(c.stop), 0]} userData={{ i }}>
        <boxGeometry args={[SPACING, 0.045, 0.06]} />
        <meshStandardMaterial color={VERMILION} emissive={VERMILION} emissiveIntensity={0.9} />
      </mesh>,
    ];
    if (prev !== null && c.stop - prev > 0.01) {
      const h = y(c.stop) - y(prev);
      parts.push(
        <mesh key={`v${i}`} position={[x(i) - SPACING / 2, y(prev) + h / 2, 0]} userData={{ i }}>
          <boxGeometry args={[0.045, h, 0.06]} />
          <meshStandardMaterial color={VERMILION} emissive={VERMILION} emissiveIntensity={0.9} />
        </mesh>,
      );
    }
    return parts;
  });

  return (
    <>
      <group ref={candleGroup}>
        {candles.map((c, i) => {
          const up = c.c >= c.o;
          const bodyH = Math.max(Math.abs(y(c.c) - y(c.o)), 0.04);
          const wickH = y(c.h) - y(c.l);
          return (
            <group key={i} position={[0, 0, 0]}>
              <mesh position={[x(i), y(Math.min(c.o, c.c)) + bodyH / 2, 0]}>
                <boxGeometry args={[0.26, bodyH, 0.26]} />
                {up ? upMat : downMat}
              </mesh>
              <mesh position={[x(i), y(c.l) + wickH / 2, 0]}>
                <boxGeometry args={[0.04, wickH, 0.04]} />
                {up ? upMat : downMat}
              </mesh>
            </group>
          );
        })}
      </group>

      {/* the 100-day high: a glowing gold line the breakout closes above */}
      <mesh position={[width / 2 - 1, y(LEVEL), 0]}>
        <boxGeometry args={[width + 4, 0.05, 0.05]} />
        <meshStandardMaterial color={PALE_GOLD} emissive={GOLD} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      <sprite position={[width / 2 - 1, y(LEVEL), -0.05]} scale={[width + 6, 0.7, 1]}>
        <spriteMaterial map={glow} color={GOLD} transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>

      <group ref={stopGroup}>{steps}</group>

      {/* the buy at the next open, and where the stop was hit */}
      <mesh ref={entryMark} position={[x(entry) - 0.24, y(candles[entry].o), 0.2]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.13, 0.03, 8, 24]} />
        <meshStandardMaterial color={PALE_GOLD} emissive={PALE_GOLD} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      <mesh ref={exitMark} position={[x(exit), y(candles[exit].stop ?? LEVEL), 0.2]} rotation-x={Math.PI / 2}>
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
      dpr={[1, 1.75]}
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
      <Candles progress={progress} still={still} />
    </Canvas>
  );
}
