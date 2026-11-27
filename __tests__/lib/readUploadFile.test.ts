/** @jest-environment node */
import { readUploadFile } from "@/lib/readUploadFile"

describe("readUploadFile", () => {
  it("returns the file from a multipart body", async () => {
    const fd = new FormData()
    fd.set("file", new File(["a,b"], "x.csv", { type: "text/csv" }))
    const res = await readUploadFile(new Request("http://localhost/x", { method: "POST", body: fd }))
    expect("file" in res && res.file.name).toBe("x.csv")
  })

  it("rejects a body that is not valid multipart as a client error, not a throw", async () => {
    const res = await readUploadFile(
      new Request("http://localhost/x", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=zzz" }, body: "garbage" }),
    )
    expect(res).toEqual({ error: "Invalid request body" })
  })

  it("rejects a text value in the file field", async () => {
    const fd = new FormData()
    fd.set("file", "not-a-file")
    const res = await readUploadFile(new Request("http://localhost/x", { method: "POST", body: fd }))
    expect(res).toEqual({ error: "No file provided" })
  })

  it("rejects a missing file field", async () => {
    const res = await readUploadFile(new Request("http://localhost/x", { method: "POST", body: new FormData() }))
    expect(res).toEqual({ error: "No file provided" })
  })
})
