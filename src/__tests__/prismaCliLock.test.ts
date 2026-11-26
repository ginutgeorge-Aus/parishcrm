/** @jest-environment node */
import { readFileSync } from "node:fs"
import { join } from "node:path"

// The image bundles its own Prisma migration CLI from docker/prisma-cli. It must
// run the exact versions the app was tested against and carry the same security
// `overrides`, or the bundled CLI silently drifts from the root lockfile.
const read = (p: string) => JSON.parse(readFileSync(join(process.cwd(), p), "utf8"))

describe("docker/prisma-cli lockfile", () => {
  const rootLock = read("package-lock.json")
  const rootPkg = read("package.json")
  const cliPkg = read("docker/prisma-cli/package.json")
  const cliLock = read("docker/prisma-cli/package-lock.json")

  it.each(["prisma", "dotenv"])("%s version equals the root lockfile", (name) => {
    const rootVersion = rootLock.packages[`node_modules/${name}`].version
    expect(cliPkg.dependencies[name]).toBe(rootVersion)
    expect(cliLock.packages[`node_modules/${name}`].version).toBe(rootVersion)
  })

  it("carries the same overrides as the root package.json", () => {
    expect(cliPkg.overrides).toEqual(rootPkg.overrides)
  })

  it("lockfile root requests the same dependencies as package.json", () => {
    expect(cliLock.packages[""].dependencies).toEqual(cliPkg.dependencies)
  })
})
