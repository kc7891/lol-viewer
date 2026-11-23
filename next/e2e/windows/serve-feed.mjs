// Static server for the update test: node serve-feed.mjs <dir> <port>. Serves latest.yml, the installer and blockmaps.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, normalize, resolve } from "node:path";

const [dir, port] = [resolve(process.argv[2] ?? "."), Number(process.argv[3] ?? 8123)];
createServer((req, res) => {
  const name = normalize(decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/")).replace(/^([/\\])+/, "");
  const file = join(dir, name);
  const ok = file.startsWith(dir) && existsSync(file) && statSync(file).isFile();
  console.log(`${req.method} ${req.url} -> ${ok ? 200 : 404}`);
  if (!ok) return void res.writeHead(404).end();
  res.writeHead(200, { "content-length": statSync(file).size, "content-type": "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`serving ${dir} on http://127.0.0.1:${port}/`));
