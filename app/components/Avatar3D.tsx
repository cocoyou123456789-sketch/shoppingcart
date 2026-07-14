"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACESFilmicToneMapping,
  Box3,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  AVATAR_AUTO_ROTATE_MS,
  avatarAriaDescription,
  avatarGeometryDetail,
  avatarPixelRatio,
  avatarZoomPercent,
  cancelVisibleTimeBudget,
  createVisibleTimeBudget,
  disposeUniqueResources,
  isActiveAvatarRuntime,
  pauseVisibleTimeBudget,
  replaceRuntimeAvatar,
  resumeVisibleTimeBudget,
} from "../lib/avatar-runtime.mjs";
import {
  avatarBodyProfile,
  avatarCameraFit,
} from "../lib/avatar-geometry.mjs";

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
  name?: string;
  style?: string;
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

const CAMERA_DIRECTIONS: Record<CameraView, [number, number, number]> = {
  front: [0, 0.025, 1],
  angle: [0.74, 0.025, 0.74],
  side: [1, 0.025, 0],
  back: [0, 0.025, -1],
};
const CAMERA_SAFE_FRAME = { top: 0.2, right: 0.075, bottom: 0.065, left: 0.075 };
// OrbitControls expects a factor below 1 for both public dolly methods.
const AVATAR_ZOOM_SCALE = 1 / 1.15;
const AVATAR_ZOOM_ANNOUNCE_DELAY_MS = 200;

type AvatarResources = {
  geometries: Map<string, BufferGeometry>;
  materials: Map<string, Material>;
};

function retainedGeometry(
  resources: AvatarResources,
  key: string,
  create: () => BufferGeometry,
) {
  const existing = resources.geometries.get(key);
  if (existing) return existing;
  const geometry = create();
  resources.geometries.set(key, geometry);
  return geometry;
}

function material(
  resources: AvatarResources,
  key: string,
  color: string,
  roughness = 0.72,
  options: {
    metalness?: number;
    transparent?: boolean;
    opacity?: number;
    emissive?: string;
    emissiveIntensity?: number;
  } = {},
) {
  const metalness = options.metalness ?? 0.02;
  const transparent = options.transparent ?? false;
  const opacity = options.opacity ?? 1;
  const existing = resources.materials.get(key);
  if (existing instanceof MeshStandardMaterial) {
    const shaderStateChanged = existing.transparent !== transparent;
    existing.color.set(color);
    existing.roughness = roughness;
    existing.metalness = metalness;
    existing.transparent = transparent;
    existing.opacity = opacity;
    existing.emissive.set(options.emissive ?? "#000000");
    existing.emissiveIntensity = options.emissiveIntensity ?? 0;
    if (shaderStateChanged) existing.needsUpdate = true;
    return existing;
  }
  const nextMaterial = new MeshStandardMaterial({
    color,
    roughness,
    metalness,
    transparent,
    opacity,
    emissive: options.emissive ?? "#000000",
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
  resources.materials.set(key, nextMaterial);
  return nextMaterial;
}

function mesh(
  geometry: BufferGeometry,
  meshMaterial: Material,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
) {
  const result = new Mesh(geometry, meshMaterial);
  result.position.set(...position);
  result.scale.set(...scale);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

type EllipticalRing = {
  y: number;
  xRadius: number;
  zRadius: number;
  xOffset?: number;
  zOffset?: number;
  frontScale?: number;
};

function ellipticalRingGeometry(
  rings: EllipticalRing[],
  segments: number,
  caps = true,
) {
  const geometry = new BufferGeometry();
  if (rings.length < 2 || segments < 3) {
    geometry.setAttribute("position", new Float32BufferAttribute([], 3));
    return geometry;
  }
  const positions: number[] = [];
  const indices: number[] = [];

  for (const ring of rings) {
    for (let index = 0; index < segments; index += 1) {
      const angle = index / segments * Math.PI * 2;
      const sin = Math.sin(angle);
      const depth = ring.zRadius * (sin > 0 ? ring.frontScale ?? 1 : 1);
      positions.push(
        Math.cos(angle) * ring.xRadius + (ring.xOffset ?? 0),
        ring.y,
        sin * depth + (ring.zOffset ?? 0),
      );
    }
  }

  for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
    const nextRing = ringIndex + 1;
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments;
      const lower = ringIndex * segments + index;
      const lowerNext = ringIndex * segments + next;
      const upper = nextRing * segments + index;
      const upperNext = nextRing * segments + next;
      indices.push(lower, upper, lowerNext, lowerNext, upper, upperNext);
    }
  }

  if (caps) {
    const bottomCenter = positions.length / 3;
    const bottom = rings[0];
    positions.push(bottom.xOffset ?? 0, bottom.y, bottom.zOffset ?? 0);
    const topCenter = positions.length / 3;
    const top = rings.at(-1)!;
    positions.push(top.xOffset ?? 0, top.y, top.zOffset ?? 0);
    const topOffset = (rings.length - 1) * segments;
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments;
      indices.push(bottomCenter, next, index);
      indices.push(topCenter, topOffset + index, topOffset + next);
    }
  }

  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function shiftedRings(
  rings: EllipticalRing[],
  offset: number,
  scaleAtY: (y: number) => number = () => 1,
) {
  return rings.map((ring) => {
    const scale = scaleAtY(ring.y);
    const xClearance = Math.max(0.018, offset * 0.32);
    const zClearance = Math.max(0.014, offset * 0.24);
    return {
      ...ring,
      xRadius: Math.max(
        ring.xRadius + xClearance,
        ring.xRadius * scale + offset,
      ),
      zRadius: Math.max(
        ring.zRadius + zClearance,
        ring.zRadius * scale + offset * 0.78,
      ),
      zOffset: (ring.zOffset ?? 0) + offset * 0.08,
    };
  });
}

function garmentLooksLike(garment: AvatarGarment | undefined, pattern: RegExp) {
  return pattern.test(`${garment?.name ?? ""} ${garment?.style ?? ""}`);
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
  return MathUtils.clamp(garmentValue / (bodyValue + expectedEase), min, max);
}

function lengthScale(
  garmentLength: number | undefined,
  referenceLength: number,
  min: number,
  max: number,
) {
  if (!garmentLength) return 1;
  return MathUtils.clamp(garmentLength / referenceLength, min, max);
}

type SceneRuntime = {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  avatar: Group;
  metrics: BodyMetrics;
  outfit: AvatarOutfit;
  reducedDetail: boolean;
  resources: AvatarResources;
  fitDistance: number;
  fitView: (view: CameraView, preserveZoom?: boolean) => void;
  cancelAutoRotate: () => void;
  renderFrame: (timestamp?: number) => boolean;
  resize: () => void;
  failRendering: () => void;
  disposed: boolean;
};

function disposeObject3D(object: Object3D, retained?: AvatarResources) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    geometries.add(child.geometry);
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    childMaterials.forEach((item) => materials.add(item));
  });
  disposeUniqueResources(
    geometries,
    retained?.geometries.values() ?? [],
    (geometry: BufferGeometry) => geometry.dispose(),
  );
  disposeUniqueResources(
    materials,
    retained?.materials.values() ?? [],
    (item: Material) => item.dispose(),
  );
}

function disposeAvatarResources(resources: AvatarResources) {
  disposeUniqueResources(
    resources.geometries.values(),
    [],
    (geometry: BufferGeometry) => geometry.dispose(),
  );
  disposeUniqueResources(
    resources.materials.values(),
    [],
    (item: Material) => item.dispose(),
  );
  resources.geometries.clear();
  resources.materials.clear();
}

function buildAvatar(
  metrics: BodyMetrics,
  outfit: AvatarOutfit,
  reducedDetail: boolean,
  resources: AvatarResources,
) {
  const detail = avatarGeometryDetail(reducedDetail);
  const avatar = new Group();
  const profile = avatarBodyProfile(metrics);
  const { joints, widths } = profile;
  const heightScale = profile.heightScale;

  try {
    const skin = material(resources, "skin", metrics.skinTone, 0.58, { metalness: 0 });
    const hair = material(resources, "hair", "#2d2529", 0.5, { metalness: 0.01 });
    const eyeWhite = material(resources, "eye-white", "#f7f2ea", 0.26, {
      emissive: "#5b463b",
      emissiveIntensity: 0.025,
    });
    const iris = material(resources, "iris", "#5a392d", 0.2);
    const pupil = material(resources, "pupil", "#171318", 0.24);
    const lipColor = new Color(metrics.skinTone)
      .lerp(new Color("#8f4055"), 0.46)
      .getStyle();
    const lips = material(resources, "lips", lipColor, 0.5);
    const baseFabric = material(resources, "base-layer", "#b8959c", 0.76);
    const shoeMaterial = material(resources, "shoe", "#4b454b", 0.68);
    const jointGeometry = retainedGeometry(
      resources,
      "human-joint",
      () => new SphereGeometry(1, detail.body[0], detail.body[1]),
    );

    const addSegment = (
      top: [number, number, number],
      bottom: [number, number, number],
      radiusTop: number,
      radiusBottom: number,
      segmentMaterial: Material,
      depthScale = 0.9,
    ) => {
      const direction = new Vector3(
        top[0] - bottom[0],
        top[1] - bottom[1],
        top[2] - bottom[2],
      );
      const length = Math.max(0.01, direction.length());
      const segment = mesh(
        new CylinderGeometry(
          radiusTop,
          radiusBottom,
          length,
          detail.cylinder,
          2,
        ),
        segmentMaterial,
        [
          (top[0] + bottom[0]) / 2,
          (top[1] + bottom[1]) / 2,
          (top[2] + bottom[2]) / 2,
        ],
        [1, 1, depthScale],
      );
      segment.quaternion.setFromUnitVectors(
        new Vector3(0, 1, 0),
        direction.normalize(),
      );
      avatar.add(segment);
      return segment;
    };
    const addJoint = (
      position: [number, number, number],
      radius: number,
      jointMaterial: Material = skin,
      scale: [number, number, number] = [1, 0.94, 0.9],
    ) => {
      const joint = mesh(jointGeometry, jointMaterial, position, [
        radius * scale[0],
        radius * scale[1],
        radius * scale[2],
      ]);
      avatar.add(joint);
      return joint;
    };
    const addTube = (
      rings: EllipticalRing[],
      tubeMaterial: Material,
      caps = false,
    ) => {
      const tube = mesh(
        ellipticalRingGeometry(rings, detail.cylinder, caps),
        tubeMaterial,
        [0, 0, 0],
      );
      avatar.add(tube);
      return tube;
    };

    const torsoGeometry = ellipticalRingGeometry(
      profile.torsoRings,
      detail.cylinder,
    );
    avatar.add(mesh(torsoGeometry, skin, [0, 0, 0]));

    const neckBottom = joints.neckBase - 0.1 * heightScale;
    const neckTop = joints.headCenter - 0.37 * heightScale;
    addSegment(
      [0, neckTop, -0.015],
      [0, neckBottom, 0],
      widths.limb * 1.15,
      widths.limb * 1.28,
      skin,
      0.92,
    );

    const headScale = MathUtils.clamp(heightScale, 0.92, 1.08);
    const headGroup = new Group();
    headGroup.scale.setScalar(headScale);
    headGroup.position.y = joints.headCenter * (1 - headScale);
    avatar.add(headGroup);
    const headGeometry = retainedGeometry(resources, "human-head", () =>
      ellipticalRingGeometry(
        [
          { y: -0.43, xRadius: 0.1, zRadius: 0.15, zOffset: 0.02 },
          { y: -0.36, xRadius: 0.31, zRadius: 0.34, zOffset: 0.015 },
          { y: -0.2, xRadius: 0.42, zRadius: 0.39, zOffset: 0.015, frontScale: 1.04 },
          { y: 0.05, xRadius: 0.46, zRadius: 0.42, zOffset: 0, frontScale: 1.035 },
          { y: 0.27, xRadius: 0.43, zRadius: 0.4, zOffset: -0.005 },
          { y: 0.41, xRadius: 0.29, zRadius: 0.3, zOffset: -0.012 },
          { y: 0.45, xRadius: 0.08, zRadius: 0.09, zOffset: -0.015 },
        ],
        detail.head[0],
      ),
    );
    headGroup.add(
      mesh(
        headGeometry,
        skin,
        [0, joints.headCenter, 0],
      ),
    );

    const faceY = joints.headCenter;
    const faceZ = 0.398;
    const earGeometry = retainedGeometry(
      resources,
      "ear",
      () => new SphereGeometry(0.1, ...detail.eye),
    );
    headGroup.add(
      mesh(earGeometry, skin, [-0.455, faceY + 0.01, -0.005], [0.55, 1.15, 0.58]),
      mesh(earGeometry, skin, [0.455, faceY + 0.01, -0.005], [0.55, 1.15, 0.58]),
    );

    const eyeGeometry = retainedGeometry(
      resources,
      "eye-white",
      () => new SphereGeometry(0.075, ...detail.eye),
    );
    const irisGeometry = retainedGeometry(
      resources,
      "iris",
      () => new SphereGeometry(0.036, ...detail.eye),
    );
    const pupilGeometry = retainedGeometry(
      resources,
      "pupil",
      () => new SphereGeometry(0.019, ...detail.eye),
    );
    const highlightGeometry = retainedGeometry(
      resources,
      "eye-highlight",
      () => new SphereGeometry(0.008, ...detail.eye),
    );
    for (const side of [-1, 1]) {
      const eyeX = side * 0.165;
      const eyeY = faceY + 0.08;
      headGroup.add(
        mesh(eyeGeometry, eyeWhite, [eyeX, eyeY, faceZ], [1.25, 0.68, 0.28]),
        mesh(irisGeometry, iris, [eyeX, eyeY, faceZ + 0.018], [1, 1, 0.22]),
        mesh(pupilGeometry, pupil, [eyeX, eyeY, faceZ + 0.026], [1, 1, 0.18]),
        mesh(
          highlightGeometry,
          eyeWhite,
          [eyeX - 0.009, eyeY + 0.011, faceZ + 0.032],
          [1, 1, 0.16],
        ),
      );
      const eyebrow = mesh(
        retainedGeometry(
          resources,
          "eyebrow",
          () => new CapsuleGeometry(0.018, 0.115, ...detail.capsule),
        ),
        hair,
        [eyeX, eyeY + 0.115, faceZ + 0.02],
        [1, 1, 0.5],
      );
      eyebrow.rotation.z = Math.PI / 2 + side * 0.08;
      headGroup.add(eyebrow);
    }

    const noseBridge = mesh(
      retainedGeometry(
        resources,
        "nose-bridge",
        () => new CapsuleGeometry(0.035, 0.13, ...detail.capsule),
      ),
      skin,
      [0, faceY - 0.02, faceZ + 0.028],
      [0.72, 1, 0.68],
    );
    const noseTip = mesh(
      retainedGeometry(
        resources,
        "nose-tip",
        () => new SphereGeometry(0.055, ...detail.eye),
      ),
      skin,
      [0, faceY - 0.105, faceZ + 0.075],
      [0.92, 0.72, 0.88],
    );
    const mouth = mesh(
      retainedGeometry(
        resources,
        "mouth",
        () => new CapsuleGeometry(0.017, 0.115, ...detail.capsule),
      ),
      lips,
      [0, faceY - 0.245, faceZ + 0.028],
      [1, 1, 0.42],
    );
    mouth.rotation.z = Math.PI / 2;
    headGroup.add(noseBridge, noseTip, mouth);

    const hairCapGeometry = retainedGeometry(
      resources,
      "hair-cap",
      () => new SphereGeometry(
        0.485,
        detail.hair[0],
        detail.hair[1],
        0,
        Math.PI * 2,
        0,
        Math.PI * 0.58,
      ),
    );
    headGroup.add(
      mesh(
        hairCapGeometry,
        hair,
        [0, faceY + 0.035, -0.16],
        [1.015, 1.06, 0.84],
      ),
    );
    const hairSideGeometry = retainedGeometry(
      resources,
      "hair-side",
      () => new CapsuleGeometry(0.085, 0.58, ...detail.capsule),
    );
    headGroup.add(
      mesh(hairSideGeometry, hair, [-0.41, faceY - 0.18, -0.14], [1, 1, 0.72]),
      mesh(hairSideGeometry, hair, [0.41, faceY - 0.18, -0.14], [1, 1, 0.72]),
      mesh(
        retainedGeometry(
          resources,
          "hair-back",
          () => new SphereGeometry(0.42, ...detail.hair),
        ),
        hair,
        [0, faceY - 0.18, -0.24],
        [1, 1.42, 0.58],
      ),
    );
    const fringeGeometry = retainedGeometry(
      resources,
      "hair-fringe",
      () => new SphereGeometry(0.065, ...detail.eye),
    );
    headGroup.add(
      mesh(fringeGeometry, hair, [-0.25, faceY + 0.32, 0.39], [1.55, 0.58, 0.35]),
      mesh(fringeGeometry, hair, [-0.085, faceY + 0.35, 0.4], [1.42, 0.54, 0.34]),
      mesh(fringeGeometry, hair, [0.085, faceY + 0.35, 0.4], [1.42, 0.54, 0.34]),
      mesh(fringeGeometry, hair, [0.25, faceY + 0.32, 0.39], [1.55, 0.58, 0.35]),
    );

    const shoulderX = widths.shoulder - widths.limb * 0.04;
    const wristX = Math.max(widths.hips * 0.82, widths.waist + widths.limb * 0.9);
    for (const side of [-1, 1]) {
      const shoulder: [number, number, number] = [
        side * shoulderX,
        joints.shoulder - 0.075 * heightScale,
        -0.005,
      ];
      const elbow: [number, number, number] = [
        side * (shoulderX - widths.limb * 0.34),
        joints.elbow,
        0.005,
      ];
      const wrist: [number, number, number] = [
        side * wristX,
        joints.wrist,
        0.035,
      ];
      addTube(
        [
          { y: wrist[1], xOffset: wrist[0], xRadius: widths.limb * 0.62, zRadius: widths.limb * 0.54, zOffset: wrist[2] },
          { y: MathUtils.lerp(wrist[1], elbow[1], 0.48), xOffset: MathUtils.lerp(wrist[0], elbow[0], 0.48), xRadius: widths.limb * 0.76, zRadius: widths.limb * 0.67, zOffset: 0.025 },
          { y: elbow[1], xOffset: elbow[0], xRadius: widths.limb * 0.84, zRadius: widths.limb * 0.74, zOffset: elbow[2] },
          { y: MathUtils.lerp(elbow[1], shoulder[1], 0.52), xOffset: MathUtils.lerp(elbow[0], shoulder[0], 0.52), xRadius: widths.limb * 0.98, zRadius: widths.limb * 0.86, zOffset: 0 },
          { y: shoulder[1], xOffset: shoulder[0], xRadius: widths.limb * 1.04, zRadius: widths.limb * 0.92, zOffset: shoulder[2] },
          { y: joints.shoulder + 0.04 * heightScale, xOffset: side * (shoulderX - widths.limb * 0.14), xRadius: widths.limb * 0.7, zRadius: widths.limb * 0.64, zOffset: -0.008 },
        ],
        skin,
      );
      addJoint(
        [side * wristX, joints.wrist - 0.22 * heightScale, 0.065],
        widths.limb * 0.92,
        skin,
        [0.7, 1.28, 0.5],
      );
    }

    const legX = widths.hips * 0.42;
    const thighRadius = Math.max(widths.limb * 1.42, widths.hips * 0.205);
    const calfRadius = Math.max(widths.limb * 1.05, widths.hips * 0.145);
    for (const side of [-1, 1]) {
      const hip: [number, number, number] = [side * legX, joints.crotch + 0.05 * heightScale, -0.015];
      const knee: [number, number, number] = [side * legX, joints.knee, 0.015];
      const ankle: [number, number, number] = [side * legX, joints.ankle, 0.015];
      addTube(
        [
          { y: ankle[1], xOffset: ankle[0], xRadius: calfRadius * 0.54, zRadius: calfRadius * 0.48, zOffset: ankle[2] },
          { y: MathUtils.lerp(ankle[1], knee[1], 0.42), xOffset: side * legX, xRadius: calfRadius * 0.92, zRadius: calfRadius * 0.82, zOffset: 0.02 },
          { y: MathUtils.lerp(ankle[1], knee[1], 0.72), xOffset: side * legX, xRadius: calfRadius, zRadius: calfRadius * 0.9, zOffset: 0.018 },
          { y: knee[1], xOffset: knee[0], xRadius: thighRadius * 0.68, zRadius: thighRadius * 0.62, zOffset: knee[2] },
          { y: MathUtils.lerp(knee[1], hip[1], 0.48), xOffset: side * legX, xRadius: thighRadius * 0.88, zRadius: thighRadius * 0.82, zOffset: 0 },
          { y: hip[1], xOffset: hip[0], xRadius: thighRadius, zRadius: thighRadius * 0.92, zOffset: hip[2] },
        ],
        skin,
      );
      addJoint(
        [side * legX, Math.max(0.12, joints.ankle * 0.5), 0.18],
        calfRadius * 1.08,
        shoeMaterial,
        [1.12, 0.62, 2.05],
      );
    }

    const baseTopRings = profile.torsoRings.filter(
      (ring) => ring.y >= joints.waist - 0.08 && ring.y <= joints.shoulder - 0.16,
    );
    avatar.add(
      mesh(
        ellipticalRingGeometry(shiftedRings(baseTopRings, 0.025), detail.cylinder, false),
        baseFabric,
        [0, 0, 0],
      ),
    );
    if (!outfit.top && !outfit.dress && !outfit.outerwear) {
      const strapGeometry = retainedGeometry(
        resources,
        "base-strap",
        () => new CapsuleGeometry(0.035, 0.44, ...detail.capsule),
      );
      for (const side of [-1, 1]) {
        const strap = mesh(
          strapGeometry,
          baseFabric,
          [side * widths.chest * 0.53, joints.chest + 0.42 * heightScale, widths.chest * 0.6],
          [1, heightScale, 0.55],
        );
        strap.rotation.z = side * -0.08;
        avatar.add(strap);
      }
    }
    const baseBottomTop = joints.hip + (joints.waist - joints.hip) * 0.58;
    const baseBottomRings = profile.torsoRings.filter((ring) => ring.y <= baseBottomTop);
    avatar.add(
      mesh(
        ellipticalRingGeometry(shiftedRings(baseBottomRings, 0.03), detail.cylinder, false),
        baseFabric,
        [0, 0, 0],
      ),
    );
    for (const side of [-1, 1]) {
      addSegment(
        [side * legX, joints.crotch + 0.02, 0],
        [side * legX, joints.crotch - 0.42 * heightScale, 0],
        thighRadius * 1.08,
        thighRadius * 1.02,
        baseFabric,
        0.96,
      );
    }

    const addSleeves = (
      garment: AvatarGarment,
      sleeveMaterial: Material,
      radiusOffset: number,
      defaultLength: "short" | "long",
    ) => {
      if (garmentLooksLike(garment, /无袖|背心|tank|sleeveless/i)) return;
      const longSleeve = defaultLength === "long" || garmentLooksLike(
        garment,
        /长袖|衬衫|毛衣|卫衣|外套|夹克|大衣|shirt|sweater|hoodie|coat|jacket/i,
      );
      for (const side of [-1, 1]) {
        const shoulder: [number, number, number] = [side * shoulderX, joints.shoulder - 0.07, 0];
        const elbow: [number, number, number] = [side * (shoulderX - widths.limb * 0.34), joints.elbow, 0.01];
        const wrist: [number, number, number] = [side * wristX, joints.wrist + 0.04, 0.045];
        if (longSleeve) {
          addTube(
            [
              { y: wrist[1], xOffset: wrist[0], xRadius: widths.limb * 0.74 + radiusOffset, zRadius: widths.limb * 0.67 + radiusOffset * 0.8, zOffset: wrist[2] },
              { y: elbow[1], xOffset: elbow[0], xRadius: widths.limb * 0.98 + radiusOffset, zRadius: widths.limb * 0.88 + radiusOffset * 0.8, zOffset: elbow[2] },
              { y: shoulder[1], xOffset: shoulder[0], xRadius: widths.limb * 1.12 + radiusOffset, zRadius: widths.limb + radiusOffset * 0.8, zOffset: shoulder[2] },
            ],
            sleeveMaterial,
          );
        } else {
          const sleeveEnd: [number, number, number] = [
            (shoulder[0] + elbow[0]) / 2,
            (shoulder[1] + elbow[1]) / 2,
            0.005,
          ];
          addTube(
            [
              { y: sleeveEnd[1], xOffset: sleeveEnd[0], xRadius: widths.limb + radiusOffset, zRadius: widths.limb * 0.9 + radiusOffset * 0.8, zOffset: sleeveEnd[2] },
              { y: shoulder[1], xOffset: shoulder[0], xRadius: widths.limb * 1.12 + radiusOffset, zRadius: widths.limb + radiusOffset * 0.8, zOffset: shoulder[2] },
            ],
            sleeveMaterial,
          );
        }
      }
    };

    const shellScale = (
      y: number,
      waistScale: number,
      chestScale: number,
      hipScale: number,
    ) => {
      if (y <= joints.hip) return hipScale;
      if (y < joints.waist) {
        return MathUtils.lerp(
          hipScale,
          waistScale,
          MathUtils.inverseLerp(joints.hip, joints.waist, y),
        );
      }
      if (y >= joints.chest) return chestScale;
      return MathUtils.lerp(waistScale, chestScale, MathUtils.inverseLerp(joints.waist, joints.chest, y));
    };

    if (outfit.dress) {
      const dress = outfit.dress;
      const chestScale = measurementScale(dress.chest, metrics.chest, 6, 0.9, 1.2);
      const waistScale = measurementScale(dress.waist, metrics.waist, 5, 0.9, 1.22);
      const hipScale = measurementScale(dress.hips, metrics.hips, 8, 0.9, 1.24);
      const dressLength = lengthScale(dress.length, 110, 0.72, 1.16);
      const dressMaterial = material(resources, "dress", dress.color, 0.78);
      const bodiceRings = profile.torsoRings.filter((ring) => ring.y >= joints.waist && ring.y <= joints.shoulder - 0.08);
      avatar.add(
        mesh(
          ellipticalRingGeometry(
            shiftedRings(
              bodiceRings,
              0.075,
              (y) => shellScale(y, waistScale, chestScale, hipScale),
            ),
            detail.cylinder,
            false,
          ),
          dressMaterial,
          [0, 0, 0],
        ),
      );
      const hemY = Math.max(joints.knee - 0.25, joints.waist - (joints.waist - joints.ankle) * dressLength * 0.78);
      avatar.add(
        mesh(
          ellipticalRingGeometry(
            [
              { y: hemY, xRadius: widths.hips * 1.28 * hipScale + 0.08, zRadius: widths.hips * 0.78 * hipScale + 0.06 },
              { y: (hemY + joints.hip) / 2, xRadius: widths.hips * 1.13 * hipScale + 0.07, zRadius: widths.hips * 0.74 * hipScale + 0.055 },
              { y: joints.hip, xRadius: widths.hips * hipScale + 0.07, zRadius: widths.hips * 0.72 * hipScale + 0.05 },
              { y: joints.waist, xRadius: widths.waist * waistScale + 0.07, zRadius: widths.waist * 0.72 * waistScale + 0.05 },
            ],
            detail.cylinder,
            false,
          ),
          dressMaterial,
          [0, 0, 0],
        ),
      );
      addSleeves(dress, dressMaterial, 0.04, "short");
    } else {
      if (outfit.top) {
        const top = outfit.top;
        const chestScale = measurementScale(top.chest, metrics.chest, 8, 0.9, 1.22);
        const waistScale = measurementScale(top.waist, metrics.waist, 8, 0.9, 1.24);
        const topLength = lengthScale(top.length, 65, 0.7, 1.22);
        const topMaterial = material(resources, "top", top.color, 0.76);
        const cropped = garmentLooksLike(top, /短款|露腰|crop/i);
        const lowestY = cropped
          ? joints.waist + (joints.chest - joints.waist) * 0.32
          : joints.waist - Math.max(0, topLength - 1) * 0.5 * heightScale;
        const topRings = profile.torsoRings.filter(
          (ring) => ring.y >= lowestY && ring.y <= joints.shoulder - 0.08,
        );
        avatar.add(
          mesh(
            ellipticalRingGeometry(
              shiftedRings(
                topRings,
                0.065,
                (y) => shellScale(y, waistScale, chestScale, 1),
              ),
              detail.cylinder,
              false,
            ),
            topMaterial,
            [0, 0, 0],
          ),
        );
        addSleeves(top, topMaterial, 0.025, "short");
      }

      if (outfit.bottom) {
        const bottom = outfit.bottom;
        const waistScale = measurementScale(bottom.waist, metrics.waist, 4, 0.9, 1.24);
        const hipScale = measurementScale(bottom.hips, metrics.hips, 6, 0.9, 1.24);
        const bottomLength = lengthScale(bottom.length, 100, 0.55, 1.14);
        const bottomMaterial = material(resources, "bottom", bottom.color, 0.8);
        const waistRings = profile.torsoRings.filter((ring) => ring.y <= joints.waist + 0.01);
        avatar.add(
          mesh(
            ellipticalRingGeometry(
              shiftedRings(
                waistRings,
                0.07,
                (y) => shellScale(y, waistScale, 1, hipScale),
              ),
              detail.cylinder,
              false,
            ),
            bottomMaterial,
            [0, 0, 0],
          ),
        );
        const hemY = joints.crotch - (joints.crotch - joints.ankle) * bottomLength;
        if (garmentLooksLike(bottom, /裙|skirt/i)) {
          avatar.add(
            mesh(
              ellipticalRingGeometry(
                [
                  { y: Math.max(joints.ankle, hemY), xRadius: widths.hips * 1.16 * hipScale + 0.08, zRadius: widths.hips * 0.78 * hipScale + 0.06 },
                  { y: joints.hip, xRadius: widths.hips * hipScale + 0.07, zRadius: widths.hips * 0.72 * hipScale + 0.05 },
                  { y: joints.waist, xRadius: widths.waist * waistScale + 0.07, zRadius: widths.waist * 0.72 * waistScale + 0.05 },
                ],
                detail.cylinder,
                false,
              ),
              bottomMaterial,
              [0, 0, 0],
            ),
          );
        } else {
          for (const side of [-1, 1]) {
            const upper: [number, number, number] = [side * legX, joints.crotch + 0.02, 0];
            const knee: [number, number, number] = [side * legX, joints.knee, 0.02];
            const hem: [number, number, number] = [side * legX, Math.max(joints.ankle, hemY), 0.025];
            const trouserRadius = thighRadius * 1.13 * hipScale + 0.025;
            if (hem[1] < knee[1]) {
              addTube(
                [
                  { y: hem[1], xOffset: hem[0], xRadius: calfRadius * 0.82 + 0.02, zRadius: calfRadius * 0.78 + 0.02, zOffset: hem[2] },
                  { y: knee[1], xOffset: knee[0], xRadius: calfRadius * 1.18 + 0.025, zRadius: calfRadius * 1.04 + 0.02, zOffset: knee[2] },
                  { y: upper[1], xOffset: upper[0], xRadius: trouserRadius, zRadius: trouserRadius * 0.9, zOffset: upper[2] },
                ],
                bottomMaterial,
              );
            } else {
              addTube(
                [
                  { y: hem[1], xOffset: hem[0], xRadius: calfRadius * 1.1 + 0.025, zRadius: calfRadius + 0.02, zOffset: hem[2] },
                  { y: upper[1], xOffset: upper[0], xRadius: trouserRadius, zRadius: trouserRadius * 0.9, zOffset: upper[2] },
                ],
                bottomMaterial,
              );
            }
          }
        }
      }
    }

    if (outfit.outerwear) {
      const coat = outfit.outerwear;
      const chestScale = measurementScale(coat.chest, metrics.chest, 12, 0.9, 1.24);
      const hipScale = measurementScale(coat.hips, metrics.hips, 12, 0.9, 1.26);
      const coatLength = lengthScale(coat.length, 82, 0.68, 1.26);
      const coatMaterial = material(resources, "outerwear", coat.color, 0.72);
      const coatRings = profile.torsoRings.filter(
        (ring) => ring.y >= joints.waist - 0.03 && ring.y <= joints.neckBase - 0.02,
      );
      avatar.add(
        mesh(
          ellipticalRingGeometry(
            shiftedRings(
              coatRings,
              0.075,
              (y) => shellScale(y, hipScale, chestScale, hipScale),
            ),
            detail.cylinder,
            false,
          ),
          coatMaterial,
          [0, 0, 0],
        ),
      );
      const coatHemY = Math.max(
        joints.knee - 0.16 * heightScale,
        joints.hip - 1.7 * coatLength * heightScale,
      );
      avatar.add(
        mesh(
          ellipticalRingGeometry(
            [
              {
                y: coatHemY,
                xRadius: widths.hips * 1.08 * hipScale + 0.085,
                zRadius: widths.hips * 0.74 * hipScale + 0.06,
              },
              {
                y: joints.crotch,
                xRadius: widths.hips * 1.03 * hipScale + 0.08,
                zRadius: widths.hips * 0.72 * hipScale + 0.055,
              },
              {
                y: joints.hip,
                xRadius: widths.hips * hipScale + 0.075,
                zRadius: widths.hips * 0.7 * hipScale + 0.05,
              },
              {
                y: joints.waist,
                xRadius: widths.waist * hipScale + 0.075,
                zRadius: widths.waist * 0.72 * hipScale + 0.05,
              },
            ],
            detail.cylinder,
            false,
          ),
          coatMaterial,
          [0, 0, 0],
        ),
      );
      addSleeves(coat, coatMaterial, 0.075, "long");
      const trimColor = new Color(coat.color).offsetHSL(0, 0, -0.08).getStyle();
      const coatTrim = material(resources, "outerwear-trim", trimColor, 0.68);
      const trimGeometry = retainedGeometry(
        resources,
        "coat-trim",
        () => new CapsuleGeometry(0.018, 0.72, ...detail.capsule),
      );
      avatar.add(
        mesh(trimGeometry, coatTrim, [-0.085, joints.chest - 0.22, widths.chest * 0.72 + 0.13], [1, heightScale, 0.72]),
        mesh(trimGeometry, coatTrim, [0.085, joints.chest - 0.22, widths.chest * 0.72 + 0.13], [1, heightScale, 0.72]),
      );
    }

    return avatar;
  } catch (error) {
    disposeObject3D(avatar, resources);
    throw error;
  }
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
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const viewSwitcherRef = useRef<HTMLDivElement>(null);
  const focusAfterRetryRef = useRef(false);
  const focusOnReadyRef = useRef(focusOnReady);
  const [cameraView, setCameraView] = useState<CameraView>("angle");
  const [zoomLevel, setZoomLevel] = useState(100);
  const [zoomLimits, setZoomLimits] = useState({ minimum: 61, maximum: 147 });
  const zoomLevelRef = useRef(100);
  const [announcedZoomLevel, setAnnouncedZoomLevel] = useState(100);
  const [renderStatus, setRenderStatus] = useState<"initializing" | "ready" | "failed">(
    "initializing",
  );
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
    const timer = window.setTimeout(
      () => setAnnouncedZoomLevel(zoomLevel),
      AVATAR_ZOOM_ANNOUNCE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [zoomLevel]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const initialize = () => {
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
    const scene = new Scene();
    const camera = new PerspectiveCamera(31, width / height, 0.1, 100);
    camera.position.set(0, 3.2, 12);
    cameraRef.current = camera;

    const renderer = new WebGLRenderer({
      antialias: !lowPowerDevice,
      alpha: true,
      powerPreference: lowPowerDevice ? "low-power" : "high-performance",
    });
    cleanups.push(() => {
      renderer.dispose();
      renderer.forceContextLoss();
    });
    const resources: AvatarResources = {
      geometries: new Map(),
      materials: new Map(),
    };
    cleanups.push(() => {
      disposeObject3D(scene, resources);
      disposeAvatarResources(resources);
      scene.clear();
    });
    let renderedPixelRatio = avatarPixelRatio(
      width,
      height,
      window.devicePixelRatio,
      isSmallScreen || lowPowerDevice,
    );
    let renderedWidth = width;
    let renderedHeight = height;
    renderer.setPixelRatio(renderedPixelRatio);
    renderer.setSize(width, height);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !lowPowerDevice;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.domElement.setAttribute(
      "aria-label",
      avatarAriaDescription(sceneInputRef.current.metrics, sceneInputRef.current.outfit),
    );
    renderer.domElement.setAttribute("role", "img");
    mount.replaceChildren(renderer.domElement);

    scene.add(new HemisphereLight(0xfff7ed, 0x5a6070, 1.35));
    const keyLight = new DirectionalLight(0xfff8f2, 2.4);
    keyLight.position.set(4.5, 8, 6);
    keyLight.castShadow = !lowPowerDevice;
    keyLight.shadow.mapSize.set(isSmallScreen || lowPowerDevice ? 512 : 1024, isSmallScreen || lowPowerDevice ? 512 : 1024);
    scene.add(keyLight);
    const fillLight = new DirectionalLight(0xffe7dc, 1.05);
    fillLight.position.set(-4, 4, 5);
    scene.add(fillLight);
    const rimLight = new DirectionalLight(0xd7d9ff, 1.25);
    rimLight.position.set(-5, 5, -4);
    scene.add(rimLight);

    const reducedDetail = lowPowerDevice || isSmallScreen;
    const initialInput = sceneInputRef.current;
    const avatar = buildAvatar(initialInput.metrics, initialInput.outfit, reducedDetail, resources);
    scene.add(avatar);

    const floor = new Mesh(
      new CircleGeometry(2.5, avatarGeometryDetail(reducedDetail).floor),
      new MeshStandardMaterial({ color: 0xebe6df, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);

    const controls = new OrbitControls(camera, renderer.domElement);
    cleanups.push(() => controls.dispose());
    renderer.domElement.style.touchAction = "pan-y";
    controls.enablePan = false;
    controls.enableDamping = !reduceMotion && !lowPowerDevice;
    controls.dampingFactor = 0.06;
    controls.autoRotate = !reduceMotion && !lowPowerDevice;
    controls.autoRotateSpeed = 1;
    controlsRef.current = controls;

    let fittedDistance = 1;
    const fitView = (view: CameraView, preserveZoom = false) => {
      const fittedAvatar = runtime?.avatar ?? avatar;
      fittedAvatar.updateWorldMatrix(true, true);
      const bounds = new Box3().setFromObject(fittedAvatar);
      const center = bounds.getCenter(new Vector3());
      const previousZoomRatio = fittedDistance > 1
        ? MathUtils.clamp(controls.getDistance() / fittedDistance, 0.68, 1.65)
        : 1;
      const fit = avatarCameraFit({
        bounds: {
          min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
          max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
        },
        verticalFovDegrees: camera.fov,
        aspect: camera.aspect,
        safeFrame: { ...CAMERA_SAFE_FRAME, padding: 1.06 },
      });
      fittedDistance = fit.fitDistance;
      if (runtime) runtime.fitDistance = fittedDistance;
      controls.minDistance = fit.minDistance;
      controls.maxDistance = fit.maxDistance;
      const target = center.setY(center.y + fit.targetYOffset);
      const direction = new Vector3(...CAMERA_DIRECTIONS[view]).normalize();
      const distance = fittedDistance * (preserveZoom ? previousZoomRatio : 1);
      controls.target.copy(target);
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.near = Math.max(0.05, distance * 0.025);
      camera.far = Math.max(50, fit.maxDistance * 4);
      camera.updateProjectionMatrix();
      controls.update();
      const nextLimits = {
        minimum: avatarZoomPercent(fittedDistance, fit.maxDistance),
        maximum: avatarZoomPercent(fittedDistance, fit.minDistance),
      };
      setZoomLimits((current) =>
        current.minimum === nextLimits.minimum && current.maximum === nextLimits.maximum
          ? current
          : nextLimits,
      );
    };
    fitView(cameraViewRef.current);

    let animationFrame = 0;
    let animationTimer = 0;
    let autoRotateTimer = 0;
    let autoRotateSuppressed = false;
    const autoRotateBudget = createVisibleTimeBudget(AVATAR_AUTO_ROTATE_MS);
    let lastRenderTime = performance.now();
    let inViewport = true;
    let pageVisible = !document.hidden;
    let rendererFailed = false;
    let rendering = false;
    const failRendering = () => {
      if (rendererFailed || !isActiveAvatarRuntime(runtimeRef.current, runtime, tornDown)) return;
      rendererFailed = true;
      setRenderStatus("failed");
      teardown();
    };
    const renderFrame = (timestamp = performance.now()) => {
      if (
        rendererFailed ||
        !isActiveAvatarRuntime(runtimeRef.current, runtime, tornDown)
      ) return false;
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
      const nextZoomLevel = avatarZoomPercent(
        fittedDistance,
        controls.getDistance(),
      );
      if (zoomLevelRef.current !== nextZoomLevel) {
        zoomLevelRef.current = nextZoomLevel;
        setZoomLevel(nextZoomLevel);
      }
      if (
        isActiveAvatarRuntime(runtimeRef.current, runtime, tornDown) &&
        !rendering &&
        !controls.autoRotate &&
        !animationFrame &&
        !animationTimer
      ) renderFrame();
    };
    controls.addEventListener("change", handleControlsChange);
    cleanups.push(() => controls.removeEventListener("change", handleControlsChange));
    handleControlsChange();
    const scheduleAnimation = () => {
      if (
        rendererFailed ||
        !isActiveAvatarRuntime(runtimeRef.current, runtime, tornDown) ||
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
      if (
        !isActiveAvatarRuntime(runtimeRef.current, runtime, tornDown) ||
        !inViewport ||
        !pageVisible ||
        rendererFailed
      ) return;
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
    const clearAutoRotateTimer = () => {
      if (autoRotateTimer) window.clearTimeout(autoRotateTimer);
      autoRotateTimer = 0;
    };
    cleanups.push(clearAutoRotateTimer);
    const stopAutoRotate = (remember: boolean, renderFinalFrame = true) => {
      if (remember) {
        autoRotateSuppressed = true;
        cancelVisibleTimeBudget(autoRotateBudget);
      } else {
        pauseVisibleTimeBudget(autoRotateBudget, performance.now());
      }
      controls.autoRotate = false;
      controls.enableDamping = false;
      clearAutoRotateTimer();
      stopAnimation();
      if (renderFinalFrame && inViewport && pageVisible) renderFrame();
    };
    const scheduleAutoRotateStop = () => {
      if (
        !isActiveAvatarRuntime(runtimeRef.current, runtime, tornDown) ||
        !controls.autoRotate ||
        autoRotateTimer ||
        autoRotateSuppressed ||
        !inViewport ||
        !pageVisible
      ) return;
      const remainingMs = resumeVisibleTimeBudget(autoRotateBudget, performance.now());
      if (remainingMs <= 0) {
        stopAutoRotate(true);
        return;
      }
      autoRotateTimer = window.setTimeout(() => {
        autoRotateTimer = 0;
        pauseVisibleTimeBudget(autoRotateBudget, performance.now());
        stopAutoRotate(true);
      }, remainingMs);
    };
    const handleControlsStart = () => stopAutoRotate(true, false);
    controls.addEventListener("start", handleControlsStart);
    cleanups.push(() => controls.removeEventListener("start", handleControlsStart));
    const handleVisibility = () => {
      pageVisible = !document.hidden;
      if (pageVisible) {
        startAnimation();
        scheduleAutoRotateStop();
      } else {
        stopAnimation();
        pauseVisibleTimeBudget(autoRotateBudget, performance.now());
        clearAutoRotateTimer();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    cleanups.push(() => document.removeEventListener("visibilitychange", handleVisibility));

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      if (!isActiveAvatarRuntime(runtimeRef.current, runtime, tornDown)) return;
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
      controls.enableDamping = !reduceMotion && !lowPowerDevice && !autoRotateSuppressed;
      controls.autoRotate = !reduceMotion && !lowPowerDevice && !autoRotateSuppressed;
      if (controls.autoRotate) {
        startAnimation();
        scheduleAutoRotateStop();
      }
      else {
        pauseVisibleTimeBudget(autoRotateBudget, performance.now());
        clearAutoRotateTimer();
        stopAnimation();
        renderFrame();
      }
    };
    const handleScreenChange = () => {
      isSmallScreen = smallScreenQuery.matches;
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
          if (inViewport) {
            startAnimation();
            scheduleAutoRotateStop();
          } else {
            stopAnimation();
            pauseVisibleTimeBudget(autoRotateBudget, performance.now());
            clearAutoRotateTimer();
          }
        }, { rootMargin: "120px" });
    if (intersectionObserver) {
      intersectionObserver.observe(mount);
      cleanups.push(() => intersectionObserver.disconnect());
    }
    const handleResize = () => {
      if (
        !isActiveAvatarRuntime(runtimeRef.current, runtime, tornDown) ||
        rendererFailed ||
        !mount.clientWidth ||
        !mount.clientHeight
      ) return;
      try {
        const nextWidth = mount.clientWidth;
        const nextHeight = mount.clientHeight;
        camera.aspect = nextWidth / nextHeight;
        camera.updateProjectionMatrix();
        const nextPixelRatio = avatarPixelRatio(
          nextWidth,
          nextHeight,
          window.devicePixelRatio,
          isSmallScreen || lowPowerDevice,
        );
        if (Math.abs(nextPixelRatio - renderedPixelRatio) > 0.01) {
          renderedPixelRatio = nextPixelRatio;
          renderer.setPixelRatio(renderedPixelRatio);
        }
        if (nextWidth !== renderedWidth || nextHeight !== renderedHeight) {
          renderedWidth = nextWidth;
          renderedHeight = nextHeight;
          renderer.setSize(nextWidth, nextHeight);
        }
        fitView(cameraViewRef.current, true);
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
      reducedDetail,
      resources,
      fitDistance: fittedDistance,
      fitView,
      cancelAutoRotate: () => stopAutoRotate(true, false),
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
    }
    window.addEventListener("resize", handleResize);
    cleanups.push(() => window.removeEventListener("resize", handleResize));

    if (renderFrame()) {
      renderer.shadowMap.autoUpdate = false;
      const successTimer = window.setTimeout(() => {
        if (!isActiveAvatarRuntime(runtimeRef.current, runtime, tornDown)) return;
        if (renderer.getContext().isContextLost()) {
          failRendering();
          return;
        }
        setRenderStatus("ready");
      }, 0);
      cleanups.push(() => window.clearTimeout(successTimer));
      startAnimation();
      scheduleAutoRotateStop();
    }

    return teardown;
    } catch {
      teardown();
      const failureTimer = window.setTimeout(() => setRenderStatus("failed"), 0);
      return () => {
        window.clearTimeout(failureTimer);
        teardown();
      };
    }
    };

    let runtimeCleanup: (() => void) | undefined;
    const initializationFrame = window.requestAnimationFrame(() => {
      runtimeCleanup = initialize();
    });
    return () => {
      window.cancelAnimationFrame(initializationFrame);
      runtimeCleanup?.();
    };
  }, [retryVersion]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (
      !runtime ||
      !isActiveAvatarRuntime(runtimeRef.current, runtime) ||
      (runtime.metrics === sceneInput.metrics && runtime.outfit === sceneInput.outfit)
    ) return;

    let nextAvatar: Group | null = null;
    try {
      nextAvatar = buildAvatar(
        sceneInput.metrics,
        sceneInput.outfit,
        runtime.reducedDetail,
        runtime.resources,
      );
      replaceRuntimeAvatar(
        runtime,
        nextAvatar,
        (object: Object3D) => disposeObject3D(object, runtime.resources),
      );
      runtime.metrics = sceneInput.metrics;
      runtime.outfit = sceneInput.outfit;
      runtime.renderer.domElement.setAttribute(
        "aria-label",
        avatarAriaDescription(sceneInput.metrics, sceneInput.outfit),
      );
      runtime.renderer.shadowMap.needsUpdate = true;
      runtime.fitView(cameraViewRef.current, true);
      runtime.renderFrame();
    } catch {
      if (nextAvatar && nextAvatar !== runtime.avatar) {
        disposeObject3D(nextAvatar, runtime.resources);
      }
      runtime.failRendering();
    }
  }, [sceneInput, retryVersion]);

  useEffect(() => {
    runtimeRef.current?.resize();
  }, [compact]);

  useEffect(() => {
    cameraViewRef.current = cameraView;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.fitView(cameraView);
    runtime.renderFrame();
  }, [cameraView]);

  function changeZoom(direction: "in" | "out") {
    const runtime = runtimeRef.current;
    const controls = controlsRef.current;
    if (!runtime || !controls) return;
    runtime.cancelAutoRotate();
    if (direction === "in") controls.dollyIn(AVATAR_ZOOM_SCALE);
    else controls.dollyOut(AVATAR_ZOOM_SCALE);
  }

  const minimumZoomLevel = zoomLimits.minimum;
  const maximumZoomLevel = zoomLimits.maximum;

  useEffect(() => {
    if (
      renderStatus !== "ready" ||
      (!focusAfterRetryRef.current && !focusOnReadyRef.current)
    ) return;
    focusAfterRetryRef.current = false;
    focusOnReadyRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      if (document.activeElement === document.body) {
        viewSwitcherRef.current
          ?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
          ?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [renderStatus]);

  const renderReady = renderStatus === "ready";
  const renderFailed = renderStatus === "failed";

  return (
    <div className={`avatar-stage ${compact ? "avatar-stage--compact" : ""}`}>
      <div ref={mountRef} className={`avatar-canvas ${renderReady ? "" : "avatar-canvas--hidden"}`} />
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
              setRenderStatus("initializing");
              setRetryVersion((current) => current + 1);
            }}
          >
            重试 3D
          </button>
        </div>
      ) : !renderReady ? (
        <div className="avatar-loading" role="status">
          <span aria-hidden="true" />
          <p>正在启动三维预览…</p>
        </div>
      ) : <><div ref={viewSwitcherRef} className="view-switcher" role="group" aria-label="三维分身已加载，可切换视角和缩放" tabIndex={-1}>
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
              runtimeRef.current?.cancelAutoRotate();
              cameraViewRef.current = value;
              setCameraView(value);
            }}
            aria-pressed={cameraView === value}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="view-control--zoom view-control--zoom-start"
          aria-label="缩小三维分身"
          disabled={zoomLevel <= minimumZoomLevel}
          onClick={() => changeZoom("out")}
        >
          −
        </button>
        <button
          type="button"
          className="view-control--zoom"
          aria-label="放大三维分身"
          disabled={zoomLevel >= maximumZoomLevel}
          onClick={() => changeZoom("in")}
        >
          ＋
        </button>
      </div>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">三维分身已加载，当前缩放 {announcedZoomLevel}%</span>
      <p className="avatar-hint">拖动旋转 · 滚轮缩放 · 按钮支持键盘切换与缩放</p></>}
    </div>
  );
}
