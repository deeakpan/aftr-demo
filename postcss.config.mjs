import path from "node:path";
import { fileURLToPath } from "node:url";

/** Project root — fixes Tailwind resolving from a parent dir (e.g. C:\\Users\\USER) on Windows. */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const config = {
  plugins: {
    "@tailwindcss/postcss": {
      base: projectRoot,
    },
  },
};

export default config;
