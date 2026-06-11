import {
  MARKET_COVER_HEIGHT,
  MARKET_COVER_WIDTH,
} from "@/lib/market-cover";

export type CropAreaPixels = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Failed to load image for cropping")));
    image.crossOrigin = "anonymous";
    image.src = src;
  });
}

/** Crop source image and export at the canonical market cover size. */
export async function getCroppedCoverFile(
  imageSrc: string,
  pixelCrop: CropAreaPixels,
  fileName = "market-cover.webp",
): Promise<File> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = MARKET_COVER_WIDTH;
  canvas.height = MARKET_COVER_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    MARKET_COVER_WIDTH,
    MARKET_COVER_HEIGHT,
  );

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (!result) reject(new Error("Failed to export cropped image"));
        else resolve(result);
      },
      "image/webp",
      0.92,
    );
  });

  return new File([blob], fileName.replace(/\.\w+$/, ".webp"), { type: "image/webp" });
}
