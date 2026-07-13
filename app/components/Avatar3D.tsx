"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type BodyMetrics = {
  height: number;
  weight: number;
  shoulder: number;
  chest: number;
  waist: number;
  hips: number;
  torso: number;
  legs: number;
  skinTone: string;
  bodyShape: "straight" | "pear" | "hourglass" | "inverted" | "apple";
};

export type AvatarOutfit = {
  top?: string;
  bottom?: string;
  dress?: string;
  outerwear?: string;
};

type CameraView = "front" | "angle" | "side" | "back";

const CAMERA_POSITIONS: Record<CameraView, [number, number, number]> = {
  front: [0, 2.8, 9],
  angle: [6.2, 3, 6.2],
  side: [9, 2.8, 0],
  back: [0, 2.8, -9],
};

function material(color: string, roughness = 0.72) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.02,
  });
}

function mesh(
  geometry: THREE.BufferGeometry,
  meshMaterial: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
) {
  const result = new THREE.Mesh(geometry, meshMaterial);
  result.position.set(...position);
  result.scale.set(...scale);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function Avatar3D({
  metrics,
  outfit,
  compact = false,
}: {
  metrics: BodyMetrics;
  outfit: AvatarOutfit;
  compact?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [cameraView, setCameraView] = useState<CameraView>("angle");
  const cameraViewRef = useRef<CameraView>("angle");
  const sceneMetrics = useDebouncedValue(metrics, 90);
  const sceneOutfit = useDebouncedValue(outfit, 90);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = Math.max(mount.clientWidth, 280);
    const height = Math.max(mount.clientHeight, compact ? 390 : 520);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isSmallScreen = window.matchMedia("(max-width: 768px)").matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(31, width / height, 0.1, 100);
    camera.position.set(...CAMERA_POSITIONS[cameraViewRef.current]);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isSmallScreen ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute(
      "aria-label",
      "可旋转的三维数字分身。拖动可旋转，滚轮可缩放。",
    );
    renderer.domElement.setAttribute("role", "img");
    mount.replaceChildren(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xfff7ed, 0x635f7b, 2.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.6);
    keyLight.position.set(4, 8, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(isSmallScreen ? 512 : 1024, isSmallScreen ? 512 : 1024);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xdac9ff, 1.8);
    rimLight.position.set(-5, 4, -4);
    scene.add(rimLight);

    const avatar = new THREE.Group();
    avatar.position.y = -3.02;
    avatar.scale.y = sceneMetrics.height / 168;
    scene.add(avatar);

    const bmi = sceneMetrics.weight / Math.pow(sceneMetrics.height / 100, 2);
    const mass = THREE.MathUtils.clamp(0.88 + (bmi - 20) * 0.018, 0.76, 1.28);
    const shoulderWidth = THREE.MathUtils.clamp(sceneMetrics.shoulder / 40, 0.78, 1.28);
    const chestWidth = THREE.MathUtils.clamp(sceneMetrics.chest / 90, 0.8, 1.28);
    const waistWidth = THREE.MathUtils.clamp(sceneMetrics.waist / 72, 0.76, 1.38);
    const hipWidth = THREE.MathUtils.clamp(sceneMetrics.hips / 94, 0.78, 1.34);
    const torsoScale = THREE.MathUtils.clamp(sceneMetrics.torso / 50, 0.84, 1.17);
    const legScale = THREE.MathUtils.clamp(sceneMetrics.legs / 82, 0.86, 1.16);

    const skin = material(sceneMetrics.skinTone, 0.82);
    const hair = material("#332b2c", 0.9);
    const eye = material("#44383b", 0.6);

    avatar.add(mesh(new THREE.SphereGeometry(0.45, 40, 32), skin, [0, 5.75, 0], [0.92, 1.06, 0.9]));
    avatar.add(mesh(new THREE.SphereGeometry(0.47, 32, 24), hair, [0, 5.88, -0.12], [1, 1.02, 0.78]));
    avatar.add(mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.42, 24), skin, [0, 5.22, 0]));
    avatar.add(mesh(new THREE.SphereGeometry(0.035, 16, 12), eye, [-0.16, 5.82, 0.41]));
    avatar.add(mesh(new THREE.SphereGeometry(0.035, 16, 12), eye, [0.16, 5.82, 0.41]));

    const torso = mesh(
      new THREE.CylinderGeometry(0.66 * waistWidth, 0.82 * hipWidth, 2.05, 40),
      skin,
      [0, 4.08, 0],
      [chestWidth * mass, torsoScale, 0.62 * mass],
    );
    avatar.add(torso);
    avatar.add(
      mesh(
        new THREE.SphereGeometry(0.83, 40, 28),
        skin,
        [0, 3.14, 0],
        [hipWidth * mass, 0.62, 0.68 * mass],
      ),
    );

    const armGeo = new THREE.CapsuleGeometry(0.17 * mass, 1.65, 8, 18);
    const leftArm = mesh(armGeo, skin, [-0.92 * shoulderWidth * mass, 4.04, 0], [1, 1.04 * torsoScale, 1]);
    leftArm.rotation.z = -0.08;
    const rightArm = mesh(armGeo.clone(), skin, [0.92 * shoulderWidth * mass, 4.04, 0], [1, 1.04 * torsoScale, 1]);
    rightArm.rotation.z = 0.08;
    avatar.add(leftArm, rightArm);

    const legGeo = new THREE.CapsuleGeometry(0.25 * mass, 2.42, 10, 22);
    avatar.add(
      mesh(legGeo, skin, [-0.35 * hipWidth, 1.35, 0], [1, legScale, 1]),
      mesh(legGeo.clone(), skin, [0.35 * hipWidth, 1.35, 0], [1, legScale, 1]),
    );
    const shoeMaterial = material("#4c4548", 0.68);
    avatar.add(
      mesh(new THREE.SphereGeometry(0.31, 24, 16), shoeMaterial, [-0.35 * hipWidth, 0.05, 0.17], [1, 0.56, 1.55]),
      mesh(new THREE.SphereGeometry(0.31, 24, 16), shoeMaterial, [0.35 * hipWidth, 0.05, 0.17], [1, 0.56, 1.55]),
    );

    if (sceneOutfit.dress) {
      const dressMaterial = material(sceneOutfit.dress, 0.78);
      avatar.add(
        mesh(
          new THREE.CylinderGeometry(0.76 * chestWidth, 0.78 * waistWidth, 1.45, 40),
          dressMaterial,
          [0, 4.2, 0],
          [mass, torsoScale, 0.67 * mass],
        ),
        mesh(
          new THREE.CylinderGeometry(0.78 * waistWidth, 1.12 * hipWidth, 2.12, 40),
          dressMaterial,
          [0, 2.75, 0],
          [mass, 1, 0.69 * mass],
        ),
      );
    } else {
      if (sceneOutfit.top) {
        avatar.add(
          mesh(
            new THREE.CylinderGeometry(0.77 * chestWidth, 0.78 * waistWidth, 1.64, 40),
            material(sceneOutfit.top, 0.76),
            [0, 4.22, 0],
            [mass, torsoScale, 0.68 * mass],
          ),
        );
      }
      if (sceneOutfit.bottom) {
        const bottomMaterial = material(sceneOutfit.bottom, 0.8);
        avatar.add(
          mesh(new THREE.CapsuleGeometry(0.28 * mass, 2.1, 8, 18), bottomMaterial, [-0.35 * hipWidth, 1.55, 0], [1.05, legScale, 1.08]),
          mesh(new THREE.CapsuleGeometry(0.28 * mass, 2.1, 8, 18), bottomMaterial, [0.35 * hipWidth, 1.55, 0], [1.05, legScale, 1.08]),
          mesh(new THREE.CylinderGeometry(0.76 * waistWidth, 0.94 * hipWidth, 0.94, 36), bottomMaterial, [0, 3.08, 0], [mass, 1, 0.7 * mass]),
        );
      }
    }

    if (sceneOutfit.outerwear) {
      const coatMaterial = new THREE.MeshStandardMaterial({
        color: sceneOutfit.outerwear,
        roughness: 0.74,
        transparent: true,
        opacity: 0.93,
      });
      avatar.add(
        mesh(
          new THREE.CylinderGeometry(0.85 * shoulderWidth, 0.98 * hipWidth, 2.92, 40, 1, true),
          coatMaterial,
          [0, 3.68, -0.02],
          [mass, 1, 0.73 * mass],
        ),
      );
    }

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.65, 64),
      new THREE.MeshStandardMaterial({ color: 0xe9e4db, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3.02;
    floor.receiveShadow = true;
    scene.add(floor);

    const controls = new OrbitControls(camera, renderer.domElement);
    renderer.domElement.style.touchAction = "pan-y";
    controls.enablePan = false;
    controls.enableDamping = !reduceMotion;
    controls.dampingFactor = 0.06;
    controls.minDistance = 6.5;
    controls.maxDistance = 12;
    controls.target.set(0, 2.55, 0);
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.45;
    controlsRef.current = controls;

    let animationFrame = 0;
    let inViewport = true;
    let pageVisible = !document.hidden;
    const continuousAnimation = controls.autoRotate;
    const renderFrame = () => {
      controls.update();
      renderer.render(scene, camera);
    };
    const handleControlsChange = () => renderer.render(scene, camera);
    if (!continuousAnimation) controls.addEventListener("change", handleControlsChange);
    const animate = () => {
      animationFrame = 0;
      if (!inViewport || !pageVisible) return;
      renderFrame();
      animationFrame = window.requestAnimationFrame(animate);
    };
    const startAnimation = () => {
      if (!continuousAnimation) {
        if (inViewport && pageVisible) renderFrame();
        return;
      }
      if (!animationFrame && inViewport && pageVisible) {
        animationFrame = window.requestAnimationFrame(animate);
      }
    };
    const stopAnimation = () => {
      if (!animationFrame) return;
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };
    const handleVisibility = () => {
      pageVisible = !document.hidden;
      if (pageVisible) startAnimation();
      else stopAnimation();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const intersectionObserver = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          inViewport = entry.isIntersecting;
          if (inViewport) startAnimation();
          else stopAnimation();
        }, { rootMargin: "120px" });
    intersectionObserver?.observe(mount);
    renderFrame();
    startAnimation();

    const resizeObserver = new ResizeObserver(() => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      const nextWidth = mount.clientWidth;
      const nextHeight = mount.clientHeight;
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight);
      if (!animationFrame) renderFrame();
    });
    resizeObserver.observe(mount);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("visibilitychange", handleVisibility);
      intersectionObserver?.disconnect();
      resizeObserver.disconnect();
      controls.removeEventListener("change", handleControlsChange);
      controls.dispose();
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((item) => item.dispose());
        }
      });
      mount.replaceChildren();
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, [sceneMetrics, sceneOutfit, compact]);

  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    camera.position.set(...CAMERA_POSITIONS[cameraView]);
    controls.target.set(0, 2.55, 0);
    controls.update();
  }, [cameraView]);

  return (
    <div className={`avatar-stage ${compact ? "avatar-stage--compact" : ""}`}>
      <div ref={mountRef} className="avatar-canvas" />
      <div className="avatar-glow" aria-hidden="true" />
      <div className="view-switcher" aria-label="切换分身视角">
        {(
          [
            ["front", "正面"],
            ["angle", "45°"],
            ["side", "侧面"],
            ["back", "背面"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={cameraView === value ? "is-active" : ""}
            onClick={() => {
              cameraViewRef.current = value;
              setCameraView(value);
            }}
            aria-pressed={cameraView === value}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="avatar-hint">拖动旋转 · 滚轮缩放</p>
    </div>
  );
}
