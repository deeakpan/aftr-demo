import { readFile } from "fs/promises";
import { join } from "path";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default async function Icon() {
  const filePath = join(process.cwd(), "public", "light.png");
  const buffer = await readFile(filePath);
  const src = `data:image/png;base64,${buffer.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: size.width,
          height: size.height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
          overflow: "hidden",
        }}
      >
        <img
          src={src}
          alt=""
          width={620}
          height={620}
          style={{
            objectFit: "cover",
            objectPosition: "center",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
