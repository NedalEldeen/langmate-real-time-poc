import * as dotenv from "dotenv";
import * as path from "path";

const serverDir = __dirname.includes("/dist")
  ? path.join(__dirname, "../")
  : __dirname;

dotenv.config({ path: path.join(serverDir, ".env") });
