import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
dotenv.config({ path: resolve(projectRoot, ".env") });

// Import after loading the root env file: auth validates its secret at startup.
const { createApiServer } = await import("./app.js");

const app = await createApiServer();
const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error, "Unable to start Nagar API");
  await app.close();
  process.exitCode = 1;
}
