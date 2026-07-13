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

export type AvatarGarment = {
  color: string;
  chest?: number;
  waist?: number;
  hips?: number;
  length?: number;
};

export type AvatarOutfit = {
  top?: AvatarGarment;
  bottom?: AvatarGarment;
  dress?: AvatarGarment;
  outerwear?: AvatarGarment;
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

function useDebouncedAvatarInput(
  metrics: BodyMetrics,
  outfit: AvatarOutfit,
  delay: number,
) {
  const [debounced, setDebounced] = useState(() => ({ metrics, outfit }));
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced({ metrics, outfit }), delay);
    return () => window.clearTimeout(timer);
  }, [metrics, outfit, delay]);
  return debounced;
}

function measurementScale(
  garmentValue: number | undefined,
  bodyValue: number,
  expectedEase: number,
  min: number,
  max: number,
) {
  if (!garmentValue) return 1;
  return THREE.MathUtils.clamp(garmentValue / (bodyValue + expectedEase), min, max);
}

function lengthScale(
  garmentLength: number | undefined,
  referenceLength: number,
  min: number,
  max: number,
) {
  if (!garmentLength) return 1;
  return THREE.MathUtils.clamp(garmentLength / referenceLength, min, max);
}

type SceneRuntime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  avatar: THREE.Group;
  metrics: BodyMetrics;
  outfit: AvatarOutfit;
  renderFrame: (timestamp?: number) => boolean;
  resize: () => void;
  failRendering: () => void;
  disposed: boolean;
};

function disposeObject3D(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    geometries.add(child.geometry);
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    childMaterials.forEach((item) => materials.add(item));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((item) => item.dispose());
}

function buildAvatar(metrics: BodyMetrics, outfit: AvatarOutfit) {
  const avatar = new THREE.Group();
  avatar.position.y = -3.02;
  avatar.scale.y = metrics.height / 168;

  const bmi = metrics.weight / Math.pow(metrics.height / 100, 2);
  const mass = THREE.MathUtils.clamp(0.88 + (bmi - 20) * 0.018, 0.76, 1.28);
  const shoulderWidth = THREE.MathUtils.clamp(metrics.shoulder / 40, 0.78, 1.28);
  const chestWidth = THREE.MathUtils.clamp(metrics.chest / 90, 0.8, 1.28);
  const waistWidth = THREE.MathUtils.clamp(metrics.waist / 72, 0.76, 1.38);
  const hipWidth = THREE.MathUtils.clamp(metrics.hips / 94, 0.78, 1.34);
  const torsoScale = THREE.MathUtils.clamp(metrics.torso / 50, 0.84, 1.17);
  const legScale = THREE.MathUtils.clamp(metrics.legs / 82, 0.86, 1.16);

  const skin = material(metrics.skinTone, 0.82);
  const hair = material("#332b2c", 0.9);
  const eye = material("#44383b", 0.6);

  avatar.add(mesh(new THREE.SphereGeometry(0.45, 40, 32), skin, [0, 5.75, 0], [0.92, 1.06, 0.9]));
  avatar.add(mesh(new THREE.SphereGeometry(0.47, 32, 24), hair, [0, 5.88, -0.12], [1, 1.02, 0.78]));
  avatar.add(mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.42, 24), skin, [0, 5.22, 0]));
  avatar.add(mesh(new THREE.SphereGeometry(0.035, 16, 12), eye, [-0.16, 5.82, 0.41]));
  avatar.add(mesh(new THREE.SphereGeometry(0.035, 16, 12), eye, [0.16, 5.82, 0.41]));

  avatar.add(
    mesh(
      new THREE.CylinderGeometry(0.66 * waistWidth, 0.82 * hipWidth, 2.05, 40),
      skin,
      [0, 4.08, 0],
      [chestWidth * mass, torsoScale, 0.62 * mass],
    ),
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

  if (outfit.dress) {
    const dressChestScale = measurementScale(outfit.dress.chest, metrics.chest, 6, 0.86, 1.24);
    const dressWaistScale = measurementScale(outfit.dress.waist, metrics.waist, 5, 0.86, 1.28);
    const dressHipScale = measurementScale(outfit.dress.hips, metrics.hips, 8, 0.86, 1.3);
    const dressLengthScale = lengthScale(outfit.dress.length, 110, 0.72, 1.22);
    const dressMaterial = material(outfit.dress.color, 0.78);
    avatar.add(
      mesh(
        new THREE.CylinderGeometry(
          0.76 * chestWidth * dressChestScale,
          0.78 * waistWidth * dressWaistScale,
          1.45,
          40,
        ),
        dressMaterial,
        [0, 4.2, 0],
        [mass, torsoScale, 0.67 * mass],
      ),
      mesh(
        new THREE.CylinderGeometry(
          0.78 * waistWidth * dressWaistScale,
          1.12 * hipWidth * dressHipScale,
          2.12,
          40,
        ),
        dressMaterial,
        [0, 2.75 - (dressLengthScale - 1) * 0.72, 0],
        [mass, dressLengthScale, 0.69 * mass],
      ),
    );
  } else {
    if (outfit.top) {
      const topChestScale = measurementScale(outfit.top.chest, metrics.chest, 8, 0.84, 1.28);
      const topWaistScale = measurementScale(outfit.top.waist, metrics.waist, 8, 0.84, 1.32);
      const topLengthScale = lengthScale(outfit.top.length, 65, 0.68, 1.25);
      avatar.add(
        mesh(
          new THREE.CylinderGeometry(
            0.77 * chestWidth * topChestScale,
            0.78 * waistWidth * topWaistScale,
            1.64,
            40,
          ),
          material(outfit.top.color, 0.76),
          [0, 4.22 - (topLengthScale - 1) * 0.55, 0],
          [mass, torsoScale * topLengthScale, 0.68 * mass],
        ),
      );
    }
    if (outfit.bottom) {
      const bottomWaistScale = measurementScale(outfit.bottom.waist, metrics.waist, 4, 0.86, 1.3);
      const bottomHipScale = measurementScale(outfit.bottom.hips, metrics.hips, 6, 0.86, 1.3);
      const bottomLengthScale = lengthScale(outfit.bottom.length, 100, 0.58, 1.16);
      const bottomMaterial = material(outfit.bottom.color, 0.8);
      avatar.add(
        mesh(
          new THREE.CapsuleGeometry(0.28 * mass * bottomHipScale, 2.1, 8, 18),
          bottomMaterial,
          [-0.35 * hipWidth, 1.55 + (1 - bottomLengthScale) * 1.05, 0],
          [1.05, legScale * bottomLengthScale, 1.08],
        ),
        mesh(
          new THREE.CapsuleGeometry(0.28 * mass * bottomHipScale, 2.1, 8, 18),
          bottomMaterial,
          [0.35 * hipWidth, 1.55 + (1 - bottomLengthScale) * 1.05, 0],
          [1.05, legScale * bottomLengthScale, 1.08],
        ),
        mesh(
          new THREE.CylinderGeometry(
            0.76 * waistWidth * bottomWaistScale,
            0.94 * hipWidth * bottomHipScale,
            0.94,
            36,
          ),
          bottomMaterial,
          [0, 3.08, 0],
          [mass, 1, 0.7 * mass],
        ),
      );
    }
  }

  if (outfit.outerwear) {
    const coatChestScale = measurementScale(outfit.outerwear.chest, metrics.chest, 12, 0.86, 1.3);
    const coatHipScale = measurementScale(outfit.outerwear.hips, metrics.hips, 12, 0.86, 1.32);
    const coatLengthScale = lengthScale(outfit.outerwear.length, 82, 0.68, 1.28);
    const coatMaterial = new THREE.MeshStandardMaterial({
      color: outfit.outerwear.color,
      roughness: 0.74,
      transparent: true,
      opacity: 0.93,
    });
    avatar.add(
      mesh(
        new THREE.CylinderGeometry(
          0.85 * shoulderWidth * coatChestScale,
          0.98 * hipWidth * coatHipScale,
          2.92,
          40,
          1,
          true,
        ),
        coatMaterial,
        [0, 3.68 - (coatLengthScale - 1) * 0.78, -0.02],
        [mass, coatLengthScale, 0.73 * mass],
      ),
    );
  }

  return avatar;
}

export function Avatar3D({
  metrics,
  outfit,
  compact = false,
  focusOnReady = false,
}: {
  metrics: BodyMetrics;
  outfit: AvatarOutfit;
  compact?: boolean;
  focusOnReady?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SceneRuntime | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const viewSwitcherRef = useRef<HTMLDivElement>(null);
  const focusAfterRetryRef = useRef(false);
  const focusOnReadyRef = useRef(focusOnReady);
  const [cameraView, setCameraView] = useState<CameraView>("angle");
  const [renderFailed, setRenderFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const cameraViewRef = useRef<CameraView>("angle");
  const sceneInput = useDebouncedAvatarInput(metrics, outfit, 180);
  const sceneInputRef = useRef(sceneInput);
  const compactRef = useRef(compact);

  useEffect(() => {
    sceneInputRef.current = sceneInput;
  }, [sceneInput]);

  useEffect(() => {
    compactRef.current = compact;
  }, [compact]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const cleanups: Array<() => void> = [];
    let runtime: SceneRuntime | null = null;
    let tornDown = false;
    const teardown = () => {
      if (tornDown) return;
      tornDown = true;
      if (runtime) runtime.disposed = true;
      if (runtimeRef.current === runtime) runtimeRef.current = null;
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup();
        } catch {
          // A failed graphics resource must not prevent the remaining cleanup.
        }
      }
      mount.replaceChildren();
      cameraRef.current = null;
      controlsRef.current = null;
    };

    try {

    const width = Math.max(mount.clientWidth, 280);
    const height = Math.max(mount.clientHeight, compactRef.current ? 390 : 520);
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const smallScreenQuery = window.matchMedia("(max-width: 980px)");
    let reduceMotion = motionQuery.matches;
    let isSmallScreen = smallScreenQuery.matches;
    const navigatorWithHints = navigator as Navigator & {
      connection?: { saveData?: boolean };
      deviceMemory?: number;
    };
    const lowPowerDevice = Boolean(
      navigatorWithHints.connection?.saveData ||
      (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
      (navigatorWithHints.deviceMemory && navigatorWithHints.deviceMemory <= 4),
    );
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(31, width / height, 0.1, 100);
    camera.position.set(...CAMERA_POSITIONS[cameraViewRef.current]);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: !lowPowerDevice,
      alpha: true,
      powerPreference: lowPowerDevice ? "low-power" : "high-performance",
    });
    cleanups.push(() => {
      renderer.dispose();
      renderer.forceContextLoss();
    });
    cleanups.push(() => {
      disposeObject3D(scene);
      scene.clear();
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isSmallScreen || lowPowerDevice ? 1.25 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = !lowPowerDevice;
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
    keyLight.castShadow = !lowPowerDevice;
    keyLight.shadow.mapSize.set(isSmallScreen || lowPowerDevice ? 512 : 1024, isSmallScreen || lowPowerDevice ? 512 : 1024);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xdac9ff, 1.8);
    rimLight.position.set(-5, 4, -4);
    scene.add(rimLight);

    const initialInput = sceneInputRef.current;
    const avatar = buildAvatar(initialInput.metrics, initialInput.outfit);
    scene.add(avatar);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.65, 64),
      new THREE.MeshStandardMaterial({ color: 0xe9e4db, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3.02;
    floor.receiveShadow = true;
    scene.add(floor);

    const controls = new OrbitControls(camera, renderer.domElement);
    cleanups.push(() => controls.dispose());
    renderer.domElement.style.touchAction = "pan-y";
    controls.enablePan = false;
    controls.enableDamping = !reduceMotion && !lowPowerDevice;
    controls.dampingFactor = 0.06;
    controls.minDistance = 6.5;
    controls.maxDistance = 12;
    controls.target.set(0, 2.55, 0);
    controls.autoRotate = !reduceMotion && !lowPowerDevice;
    controls.autoRotateSpeed = 0.45;
    controlsRef.current = controls;

    let animationFrame = 0;
    let animationTimer = 0;
    let lastRenderTime = performance.now();
    let inViewport = true;
    let pageVisible = !document.hidden;
    let rendererFailed = false;
    let rendering = false;
    const failRendering = () => {
      if (rendererFailed) return;
      rendererFailed = true;
      setRenderFailed(true);
      teardown();
    };
    const renderFrame = (timestamp = performance.now()) => {
      if (rendererFailed || tornDown) return false;
      if (rendering) return true;
      rendering = true;
      try {
        const deltaSeconds = Math.min(0.1, Math.max(0, timestamp - lastRenderTime) / 1000);
        controls.update(deltaSeconds);
        renderer.render(scene, camera);
        lastRenderTime = timestamp;
        return true;
      } catch {
        failRendering();
        return false;
      } finally {
        rendering = false;
      }
    };
    const handleControlsChange = () => {
      if (!rendering && !controls.autoRotate && !animationFrame && !animationTimer) renderFrame();
    };
    controls.addEventListener("change", handleControlsChange);
    cleanups.push(() => controls.removeEventListener("change", handleControlsChange));
    const scheduleAnimation = () => {
      if (
        rendererFailed ||
        !controls.autoRotate ||
        !inViewport ||
        !pageVisible ||
        animationFrame ||
        animationTimer
      ) return;
      const delay = Math.max(0, 1000 / 30 - (performance.now() - lastRenderTime) - 4);
      animationTimer = window.setTimeout(() => {
        animationTimer = 0;
        if (!rendererFailed && inViewport && pageVisible) {
          animationFrame = window.requestAnimationFrame(animate);
        }
      }, delay);
    };
    const animate = (timestamp: number) => {
      animationFrame = 0;
      if (!inViewport || !pageVisible || rendererFailed) return;
      if (!renderFrame(timestamp)) return;
      scheduleAnimation();
    };
    const startAnimation = () => {
      if (rendererFailed) return;
      if (!controls.autoRotate) {
        if (inViewport && pageVisible) renderFrame();
        return;
      }
      scheduleAnimation();
    };
    const stopAnimation = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      if (animationTimer) window.clearTimeout(animationTimer);
      animationFrame = 0;
      animationTimer = 0;
    };
    cleanups.push(stopAnimation);
    const handleVisibility = () => {
      pageVisible = !document.hidden;
      if (pageVisible) startAnimation();
      else stopAnimation();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    cleanups.push(() => document.removeEventListener("visibilitychange", handleVisibility));

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      failRendering();
    };
    renderer.domElement.addEventListener("webglcontextlost", handleContextLost);
    cleanups.push(() => renderer.domElement.removeEventListener("webglcontextlost", handleContextLost));

    const listenForMediaChange = (query: MediaQueryList, handler: () => void) => {
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", handler);
        cleanups.push(() => query.removeEventListener("change", handler));
      } else {
        query.addListener(handler);
        cleanups.push(() => query.removeListener(handler));
      }
    };
    const handleMotionChange = () => {
      reduceMotion = motionQuery.matches;
      controls.enableDamping = !reduceMotion && !lowPowerDevice;
      controls.autoRotate = !reduceMotion && !lowPowerDevice;
      if (controls.autoRotate) startAnimation();
      else {
        stopAnimation();
        renderFrame();
      }
    };
    const handleScreenChange = () => {
      isSmallScreen = smallScreenQuery.matches;
      renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, isSmallScreen || lowPowerDevice ? 1.25 : 2),
      );
      keyLight.shadow.map?.dispose();
      keyLight.shadow.map = null;
      const shadowSize = isSmallScreen || lowPowerDevice ? 512 : 1024;
      keyLight.shadow.mapSize.set(shadowSize, shadowSize);
      renderer.shadowMap.needsUpdate = true;
      handleResize();
    };

    const intersectionObserver = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([entry]) => {
          inViewport = entry.isIntersecting;
          if (inViewport) startAnimation();
          else stopAnimation();
        }, { rootMargin: "120px" });
    if (intersectionObserver) {
      intersectionObserver.observe(mount);
      cleanups.push(() => intersectionObserver.disconnect());
    }
    const handleResize = () => {
      if (tornDown || rendererFailed || !mount.clientWidth || !mount.clientHeight) return;
      try {
        const nextWidth = mount.clientWidth;
        const nextHeight = mount.clientHeight;
        camera.aspect = nextWidth / nextHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(nextWidth, nextHeight);
        if (!animationFrame && !animationTimer) renderFrame();
      } catch {
        failRendering();
      }
    };
    runtime = {
      scene,
      camera,
      renderer,
      controls,
      avatar,
      metrics: initialInput.metrics,
      outfit: initialInput.outfit,
      renderFrame,
      resize: handleResize,
      failRendering,
      disposed: false,
    };
    runtimeRef.current = runtime;
    listenForMediaChange(motionQuery, handleMotionChange);
    listenForMediaChange(smallScreenQuery, handleScreenChange);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(handleResize);
    if (resizeObserver) {
      resizeObserver.observe(mount);
      cleanups.push(() => resizeObserver.disconnect());
    } else {
      window.addEventListener("resize", handleResize);
      cleanups.push(() => window.removeEventListener("resize", handleResize));
    }

    if (renderFrame()) {
      renderer.shadowMap.autoUpdate = false;
      const successTimer = window.setTimeout(() => {
        setRenderFailed(false);
        if (focusOnReadyRef.current) {
          focusOnReadyRef.current = false;
          const focusFrame = window.requestAnimationFrame(() => {
            if (document.activeElement === document.body) {
              viewSwitcherRef.current
                ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
                ?.focus();
            }
          });
          cleanups.push(() => window.cancelAnimationFrame(focusFrame));
        }
      }, 0);
      cleanups.push(() => window.clearTimeout(successTimer));
      startAnimation();
    }

    return teardown;
    } catch {
      teardown();
      const failureTimer = window.setTimeout(() => setRenderFailed(true), 0);
      return () => {
        window.clearTimeout(failureTimer);
        teardown();
      };
    }
  }, [retryVersion]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (
      !runtime ||
      runtime.disposed ||
      (runtime.metrics === sceneInput.metrics && runtime.outfit === sceneInput.outfit)
    ) return;

    let nextAvatar: THREE.Group | null = null;
    try {
      nextAvatar = buildAvatar(sceneInput.metrics, sceneInput.outfit);
      runtime.scene.add(nextAvatar);
      const previousAvatar = runtime.avatar;
      runtime.avatar = nextAvatar;
      runtime.metrics = sceneInput.metrics;
      runtime.outfit = sceneInput.outfit;
      runtime.scene.remove(previousAvatar);
      disposeObject3D(previousAvatar);
      runtime.renderer.shadowMap.needsUpdate = true;
      runtime.renderFrame();
    } catch {
      if (nextAvatar && nextAvatar !== runtime.avatar) disposeObject3D(nextAvatar);
      runtime.failRendering();
    }
  }, [sceneInput, retryVersion]);

  useEffect(() => {
    runtimeRef.current?.resize();
  }, [compact]);

  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    camera.position.set(...CAMERA_POSITIONS[cameraView]);
    controls.target.set(0, 2.55, 0);
    controls.update();
  }, [cameraView]);

  useEffect(() => {
    if (renderFailed || !focusAfterRetryRef.current) return;
    focusAfterRetryRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      if (document.activeElement === document.body) {
        viewSwitcherRef.current
          ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
          ?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [renderFailed]);

  return (
    <div className={`avatar-stage ${compact ? "avatar-stage--compact" : ""}`}>
      <div ref={mountRef} className={`avatar-canvas ${renderFailed ? "avatar-canvas--hidden" : ""}`} />
      <div className="avatar-glow" aria-hidden="true" />
      {renderFailed ? (
        <div className="avatar-unavailable" role="status">
          <span aria-hidden="true">◎</span>
          <strong>这台设备暂时无法显示 3D</strong>
          <p>衣橱、身材参数和搭配仍可继续使用。</p>
          <button
            type="button"
            className="button button--soft"
            onClick={() => {
              focusAfterRetryRef.current = true;
              setRetryVersion((current) => current + 1);
            }}
          >
            重试 3D
          </button>
        </div>
      ) : <><div ref={viewSwitcherRef} className="view-switcher" role="group" aria-label="三维分身已加载，可切换视角" tabIndex={-1}>
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
      <p className="avatar-hint">拖动旋转 · 滚轮缩放</p></>}
    </div>
  );
}
