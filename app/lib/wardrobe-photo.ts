export type PreparedWardrobePhoto = {
  deviceImage: string;
  upload: File;
};

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Photo encoding failed"));
    reader.onerror = () => reject(reader.error ?? new Error("Photo encoding failed"));
    reader.readAsDataURL(blob);
  });
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.76),
  );
}

export async function prepareWardrobePhoto(
  file: File,
): Promise<PreparedWardrobePhoto | undefined> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const maxEdge = 900;
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return undefined;
      context.fillStyle = "#f8f5ef";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await canvasBlob(canvas);
      if (!blob) return undefined;
      const normalizedName = `${file.name.replace(/\.[^.]*$/, "").slice(0, 80) || "wardrobe-photo"}.jpg`;
      const normalizedFile = new File([blob], normalizedName, {
        type: blob.type,
        lastModified: file.lastModified,
      });
      return {
        deviceImage: await blobDataUrl(blob),
        upload: scale < 1 || blob.size < file.size ? normalizedFile : file,
      };
    } finally {
      bitmap.close();
    }
  } catch {
    return undefined;
  }
}
