import { copyFile } from "node:fs/promises";
for (const pkg of ["core", "cli", "mcp"]) {
  for (const name of ["LICENSE", "NOTICE.md"])
    await copyFile(
      new URL(`../${name}`, import.meta.url),
      new URL(`../packages/${pkg}/${name}`, import.meta.url),
    );
}
