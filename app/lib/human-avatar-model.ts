import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from "three";
import {
  DEFAULT_BODY_FEATURE,
  DEFAULT_HAIR_COLOR,
  normalizeBodyFeature,
  normalizeHexColor,
  type BodyFeature,
} from "./avatar-appearance";
import {
  humanBoneScale,
  humanDeformationProfile,
  mapHumanY,
} from "./human-avatar-deformation.mjs";

const HUMAN_MODEL_URL = "avatar/human-female-cc0.gltf";
const HUMAN_HEAD_TEXTURE_URL = "avatar/human-female-head-cc0.webp";

type HumanMetrics = {
  height: number;
  weight: number;
  shoulder: number;
  chest: number;
  waist: number;
  hips: number;
  torso: number;
  legs: number;
  skinTone: string;
  bodyShape: string;
  hairColor?: string;
  bodyFeature?: BodyFeature;
};

type HumanMeshTemplate = {
  name: string;
  geometry: BufferGeometry;
  boneNames: string[];
};

type GltfAccessor = {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  normalized?: boolean;
  sparse?: unknown;
  type: "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT4";
};

type GltfDocument = {
  accessors: GltfAccessor[];
  buffers: Array<{ uri: string; byteLength: number }>;
  bufferViews: Array<{
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }>;
  meshes: Array<{
    primitives: Array<{
      attributes: Record<string, number>;
      indices?: number;
      mode?: number;
    }>;
  }>;
  nodes: Array<{
    name?: string;
    mesh?: number;
    skin?: number;
    matrix?: number[];
    rotation?: number[];
    scale?: number[];
    translation?: number[];
  }>;
  skins: Array<{ joints: number[] }>;
};

export type HumanAvatarTemplate = {
  meshes: HumanMeshTemplate[];
  headTexture: Texture;
};

let templatePromise: Promise<HumanAvatarTemplate> | null = null;

type AccessorArray =
  | Float32Array
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Uint32Array;

const GLTF_ATTRIBUTE_NAMES: Record<string, string> = {
  POSITION: "position",
  NORMAL: "normal",
  TEXCOORD_0: "uv",
  JOINTS_0: "skinIndex",
  WEIGHTS_0: "skinWeight",
};

function accessorItemSize(type: GltfAccessor["type"]) {
  switch (type) {
    case "SCALAR":
      return 1;
    case "VEC2":
      return 2;
    case "VEC3":
      return 3;
    case "VEC4":
      return 4;
    case "MAT4":
      return 16;
  }
}

function componentByteSize(componentType: number) {
  switch (componentType) {
    case 5120:
    case 5121:
      return 1;
    case 5122:
    case 5123:
      return 2;
    case 5125:
    case 5126:
      return 4;
    default:
      throw new Error(`Unsupported glTF component type: ${componentType}`);
  }
}

function createAccessorArray(
  componentType: number,
  buffer: ArrayBuffer,
  byteOffset: number,
  length: number,
): AccessorArray {
  switch (componentType) {
    case 5120:
      return new Int8Array(buffer, byteOffset, length);
    case 5121:
      return new Uint8Array(buffer, byteOffset, length);
    case 5122:
      return new Int16Array(buffer, byteOffset, length);
    case 5123:
      return new Uint16Array(buffer, byteOffset, length);
    case 5125:
      return new Uint32Array(buffer, byteOffset, length);
    case 5126:
      return new Float32Array(buffer, byteOffset, length);
    default:
      throw new Error(`Unsupported glTF component type: ${componentType}`);
  }
}

function createEmptyAccessorArray(componentType: number, length: number) {
  switch (componentType) {
    case 5120:
      return new Int8Array(length);
    case 5121:
      return new Uint8Array(length);
    case 5122:
      return new Int16Array(length);
    case 5123:
      return new Uint16Array(length);
    case 5125:
      return new Uint32Array(length);
    case 5126:
      return new Float32Array(length);
    default:
      throw new Error(`Unsupported glTF component type: ${componentType}`);
  }
}

function readComponent(
  view: DataView,
  byteOffset: number,
  componentType: number,
) {
  switch (componentType) {
    case 5120:
      return view.getInt8(byteOffset);
    case 5121:
      return view.getUint8(byteOffset);
    case 5122:
      return view.getInt16(byteOffset, true);
    case 5123:
      return view.getUint16(byteOffset, true);
    case 5125:
      return view.getUint32(byteOffset, true);
    case 5126:
      return view.getFloat32(byteOffset, true);
    default:
      throw new Error(`Unsupported glTF component type: ${componentType}`);
  }
}

function readAccessor(
  document: GltfDocument,
  buffer: ArrayBuffer,
  accessorIndex: number,
) {
  const accessor = document.accessors[accessorIndex];
  if (!accessor || accessor.sparse) {
    throw new Error("Sparse or missing glTF accessors are not supported");
  }
  const bufferView = document.bufferViews[accessor.bufferView];
  if (!bufferView || bufferView.buffer !== 0) {
    throw new Error("Human avatar must use its single embedded glTF buffer");
  }
  const itemSize = accessorItemSize(accessor.type);
  const componentSize = componentByteSize(accessor.componentType);
  const packedStride = itemSize * componentSize;
  const stride = bufferView.byteStride ?? packedStride;
  const byteOffset =
    (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const length = accessor.count * itemSize;

  if (stride === packedStride) {
    return {
      accessor,
      array: createAccessorArray(
        accessor.componentType,
        buffer,
        byteOffset,
        length,
      ),
      itemSize,
    };
  }
  if (stride < packedStride) {
    throw new Error("Invalid glTF accessor byte stride");
  }

  const array = createEmptyAccessorArray(accessor.componentType, length);
  const view = new DataView(buffer);
  for (let item = 0; item < accessor.count; item += 1) {
    const sourceOffset = byteOffset + item * stride;
    for (let component = 0; component < itemSize; component += 1) {
      array[item * itemSize + component] = readComponent(
        view,
        sourceOffset + component * componentSize,
        accessor.componentType,
      );
    }
  }
  return { accessor, array, itemSize };
}

function decodeEmbeddedBuffer(
  entry: GltfDocument["buffers"][number] | undefined,
) {
  if (!entry?.uri.startsWith("data:") || !entry.uri.includes(";base64,")) {
    throw new Error("Human avatar glTF buffer must be embedded as base64");
  }
  const encoded = entry.uri.slice(entry.uri.indexOf(",") + 1);
  const decoded = atob(encoded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  if (bytes.byteLength !== entry.byteLength) {
    throw new Error("Human avatar glTF buffer length does not match");
  }
  return bytes.buffer;
}

function parseHumanMeshes(document: GltfDocument) {
  if (document.buffers.length !== 1) {
    throw new Error("Human avatar must contain one embedded glTF buffer");
  }
  const buffer = decodeEmbeddedBuffer(document.buffers[0]);
  const meshes: HumanMeshTemplate[] = [];

  for (const node of document.nodes) {
    if (node.mesh === undefined) continue;
    if (
      node.matrix ||
      node.rotation ||
      node.scale ||
      node.translation
    ) {
      throw new Error("Human avatar mesh nodes must use identity transforms");
    }
    const mesh = document.meshes[node.mesh];
    if (!mesh || mesh.primitives.length !== 1) {
      throw new Error("Human avatar meshes must contain one primitive");
    }
    const primitive = mesh.primitives[0];
    if (primitive.mode !== undefined && primitive.mode !== 4) {
      throw new Error("Human avatar mesh primitive must use triangles");
    }
    const geometry = new BufferGeometry();
    for (const [semantic, attributeIndex] of Object.entries(
      primitive.attributes,
    )) {
      const attributeName = GLTF_ATTRIBUTE_NAMES[semantic];
      if (!attributeName) continue;
      const { accessor, array, itemSize } = readAccessor(
        document,
        buffer,
        attributeIndex,
      );
      geometry.setAttribute(
        attributeName,
        new BufferAttribute(array, itemSize, accessor.normalized ?? false),
      );
    }
    if (primitive.indices === undefined) {
      throw new Error("Human avatar mesh primitive is missing indices");
    }
    const index = readAccessor(document, buffer, primitive.indices);
    geometry.setIndex(
      new BufferAttribute(
        index.array,
        index.itemSize,
        index.accessor.normalized ?? false,
      ),
    );
    if (
      !geometry.getAttribute("position") ||
      !geometry.getAttribute("skinIndex") ||
      !geometry.getAttribute("skinWeight")
    ) {
      throw new Error("Human avatar mesh is missing deformation attributes");
    }
    const skin = document.skins[node.skin ?? 0];
    const boneNames = skin?.joints.map(
      (jointIndex) => document.nodes[jointIndex]?.name ?? "",
    ) ?? [];
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    meshes.push({
      name: node.name ?? `mesh_${node.mesh}`,
      geometry,
      boneNames,
    });
  }
  return meshes;
}

export function loadHumanAvatarTemplate() {
  if (templatePromise) return templatePromise;
  const textureLoader = new TextureLoader();
  templatePromise = Promise.all([
    fetch(HUMAN_MODEL_URL).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Human avatar model failed to load: ${response.status}`);
      }
      return response.json() as Promise<GltfDocument>;
    }),
    textureLoader.loadAsync(HUMAN_HEAD_TEXTURE_URL),
  ]).then(([document, headTexture]) => {
    const meshes = parseHumanMeshes(document);
    if (
      !meshes.some((entry) => entry.name === "mesh_Body") ||
      !meshes.some((entry) => entry.name === "mesh_Head")
    ) {
      throw new Error("Human avatar asset is missing its body or head mesh");
    }
    headTexture.colorSpace = SRGBColorSpace;
    headTexture.flipY = false;
    headTexture.needsUpdate = true;
    return { meshes, headTexture };
  }).catch((error) => {
    templatePromise = null;
    throw error;
  });
  return templatePromise;
}

function componentValues(attribute: BufferAttribute, index: number) {
  return [
    attribute.getX(index),
    attribute.getY(index),
    attribute.getZ(index),
    attribute.itemSize > 3 ? attribute.getW(index) : 0,
  ];
}

function deformGeometry(
  source: BufferGeometry,
  meshName: string,
  boneNames: string[],
  metrics: HumanMetrics,
) {
  const geometry = source.clone();
  const position = geometry.getAttribute("position");
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  const deformation = humanDeformationProfile(metrics);

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const sourceX = position.getX(vertex);
    const sourceY = position.getY(vertex);
    const sourceZ = position.getZ(vertex);
    let xScale = 0;
    let zScale = 0;
    let zOffset = 0;
    let totalWeight = 0;

    if (skinIndex && skinWeight && boneNames.length) {
      const indices = componentValues(skinIndex as BufferAttribute, vertex);
      const weights = componentValues(skinWeight as BufferAttribute, vertex);
      for (let component = 0; component < 4; component += 1) {
        const weight = Math.max(0, weights[component]);
        if (!weight) continue;
        const scale = humanBoneScale(
          deformation,
          boneNames[Math.round(indices[component])] ?? "",
          sourceY,
          meshName,
        );
        xScale += scale.x * weight;
        zScale += scale.z * weight;
        zOffset += scale.zOffset * weight;
        totalWeight += weight;
      }
    }

    if (totalWeight < 0.01) {
      const scale = humanBoneScale(
        deformation,
        "",
        sourceY,
        meshName,
      );
      xScale = scale.x;
      zScale = scale.z;
      zOffset = scale.zOffset;
    } else if (Math.abs(totalWeight - 1) > 0.001) {
      xScale /= totalWeight;
      zScale /= totalWeight;
      zOffset /= totalWeight;
    }

    position.setXYZ(
      vertex,
      sourceX * xScale,
      mapHumanY(sourceY, deformation.body),
      sourceZ * zScale + zOffset,
    );
  }

  geometry.deleteAttribute("skinIndex");
  geometry.deleteAttribute("skinWeight");
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function humanHeadMaterial(
  headTexture: Texture,
  skinTone: string,
  hairColor: string,
) {
  const material = new MeshStandardMaterial({
    color: "#ffffff",
    map: headTexture,
    metalness: 0,
    roughness: 0.52,
  });
  const shaderColors = {
    hair: new Color(hairColor),
    skin: new Color(skinTone),
  };
  material.customProgramCacheKey = () => "songsong-human-head-recolor-v1";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.avatarHairColor = { value: shaderColors.hair };
    shader.uniforms.avatarSkinColor = { value: shaderColors.skin };
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D(map, vMapUv);
          float avatarMaxChannel = max(
            sampledDiffuseColor.r,
            max(sampledDiffuseColor.g, sampledDiffuseColor.b)
          );
          float avatarMinChannel = min(
            sampledDiffuseColor.r,
            min(sampledDiffuseColor.g, sampledDiffuseColor.b)
          );
          float avatarChroma = avatarMaxChannel - avatarMinChannel;
          float avatarLuma = dot(
            sampledDiffuseColor.rgb,
            vec3(0.2126, 0.7152, 0.0722)
          );
          float avatarHairMask =
            (1.0 - smoothstep(0.12, 0.4, avatarLuma)) *
            (1.0 - smoothstep(0.12, 0.32, avatarChroma));
          float avatarSkinMask =
            smoothstep(0.16, 0.42, avatarLuma) *
            smoothstep(-0.03, 0.14, sampledDiffuseColor.r - sampledDiffuseColor.b) *
            (1.0 - avatarHairMask);
          vec3 avatarHairShade = avatarHairColor *
            mix(0.34, 1.18, smoothstep(0.025, 0.34, avatarLuma));
          vec3 avatarSkinShade = avatarSkinColor *
            mix(0.62, 1.32, smoothstep(0.14, 0.78, avatarLuma));
          sampledDiffuseColor.rgb = mix(
            sampledDiffuseColor.rgb,
            avatarSkinShade,
            avatarSkinMask * 0.48
          );
          sampledDiffuseColor.rgb = mix(
            sampledDiffuseColor.rgb,
            avatarHairShade,
            avatarHairMask * 0.92
          );
          diffuseColor *= sampledDiffuseColor;
        #endif
      `,
    );
  };
  return material;
}

function addFaceDetails(
  group: Group,
  deformation: ReturnType<typeof humanDeformationProfile>,
) {
  const irisMaterial = new MeshPhysicalMaterial({
    color: "#5b3a2d",
    metalness: 0,
    roughness: 0.16,
    clearcoat: 0.65,
    clearcoatRoughness: 0.16,
  });
  const pupilMaterial = new MeshStandardMaterial({
    color: "#171318",
    metalness: 0,
    roughness: 0.24,
  });
  const irisGeometry = new SphereGeometry(1, 14, 10);
  const pupilGeometry = new SphereGeometry(1, 12, 8);
  const eyeY = mapHumanY(1.596, deformation.body);
  for (const side of [-1, 1]) {
    const iris = new Mesh(irisGeometry, irisMaterial);
    iris.position.set(side * 0.145 * deformation.face, eyeY, 0.318);
    iris.scale.set(0.043, 0.039, 0.012);
    const pupil = new Mesh(pupilGeometry, pupilMaterial);
    pupil.position.set(side * 0.145 * deformation.face, eyeY, 0.329);
    pupil.scale.set(0.019, 0.019, 0.008);
    group.add(iris, pupil);
  }
}

function spot(
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
  position: [number, number, number],
  scale: [number, number, number],
) {
  const result = new Mesh(geometry, material);
  result.position.set(...position);
  result.scale.set(...scale);
  result.castShadow = false;
  return result;
}

function addBodyFeature(
  group: Group,
  feature: BodyFeature,
  skinTone: string,
  deformation: ReturnType<typeof humanDeformationProfile>,
) {
  if (feature === "none") return;
  const markColor = new Color(skinTone).lerp(new Color("#63352f"), 0.68);
  const markMaterial = new MeshStandardMaterial({
    color: markColor,
    metalness: 0,
    roughness: 0.82,
  });
  const dotGeometry = new SphereGeometry(1, 10, 7);
  const faceY = deformation.body.joints.headCenter;
  if (feature === "freckles") {
    const freckles: Array<[number, number, number]> = [
      [-0.18, 0.055, 0],
      [-0.125, 0.035, 0.007],
      [-0.075, 0.06, 0.004],
      [0.075, 0.06, 0.004],
      [0.125, 0.035, 0.007],
      [0.18, 0.055, 0],
    ];
    for (const [x, y, z] of freckles) {
      group.add(
        spot(
          dotGeometry,
          markMaterial,
          [x * deformation.face, faceY + y, 0.404 + z],
          [0.012, 0.008, 0.004],
        ),
      );
    }
    return;
  }
  if (feature === "beauty-mark") {
    group.add(
      spot(
        dotGeometry,
        markMaterial,
        [0.165 * deformation.face, faceY - 0.12, 0.407],
        [0.018, 0.014, 0.005],
      ),
    );
    return;
  }

  const tattooMaterial = new MeshStandardMaterial({
    color: "#554454",
    metalness: 0,
    roughness: 0.72,
  });
  const petalGeometry = new CircleGeometry(1, 14);
  const tattooY = deformation.body.joints.shoulder - 0.23;
  const tattooX = Math.min(
    deformation.body.widths.shoulder * 0.55,
    deformation.body.widths.chest * 0.68,
  );
  group.add(
    spot(petalGeometry, tattooMaterial, [tattooX, tattooY, 0.49], [0.07, 0.026, 1]),
    spot(petalGeometry, tattooMaterial, [tattooX + 0.05, tattooY - 0.035, 0.492], [0.045, 0.02, 1]),
    spot(petalGeometry, tattooMaterial, [tattooX - 0.045, tattooY - 0.04, 0.491], [0.038, 0.017, 1]),
  );
}

export function buildHumanAvatar(
  template: HumanAvatarTemplate,
  metrics: HumanMetrics,
) {
  const group = new Group();
  group.name = "licensed-human-avatar";
  group.userData.sourceLicense = "CC0-1.0";
  const deformation = humanDeformationProfile(metrics);
  const skinTone = normalizeHexColor(metrics.skinTone, "#d7a883");
  const hairColor = normalizeHexColor(metrics.hairColor, DEFAULT_HAIR_COLOR);
  const feature = normalizeBodyFeature(
    metrics.bodyFeature,
    DEFAULT_BODY_FEATURE,
  );
  const skinMaterial = new MeshPhysicalMaterial({
    color: skinTone,
    metalness: 0,
    roughness: 0.5,
    clearcoat: 0.06,
    clearcoatRoughness: 0.72,
  });
  const headMaterial = humanHeadMaterial(
    template.headTexture,
    skinTone,
    hairColor,
  );
  const eyeMaterial = new MeshPhysicalMaterial({
    color: "#f5f0e8",
    metalness: 0,
    roughness: 0.2,
    clearcoat: 0.8,
    clearcoatRoughness: 0.12,
  });

  for (const entry of template.meshes) {
    const geometry = deformGeometry(
      entry.geometry,
      entry.name,
      entry.boneNames,
      metrics,
    );
    const material = entry.name === "mesh_Head"
      ? headMaterial
      : entry.name === "mesh_Eyes"
        ? eyeMaterial
        : skinMaterial;
    const humanMesh = new Mesh(geometry, material);
    humanMesh.name = entry.name;
    humanMesh.castShadow = true;
    humanMesh.receiveShadow = true;
    group.add(humanMesh);
  }
  addFaceDetails(group, deformation);
  addBodyFeature(group, feature, skinTone, deformation);
  return group;
}
