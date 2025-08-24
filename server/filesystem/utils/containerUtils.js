export async function execCapture(container, cmd) {
  const exec = await container.exec({
    Cmd: ["bash", "-lc", cmd],
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  return new Promise((resolve, reject) => {
    exec.start((err, stream) => {
      if (err) return reject(err);
      let out = "";
      stream.on("data", (d) => {
        out += d.toString("utf8");
      });
      stream.on("error", reject);
      stream.on("end", () => resolve(out));
    });
  });
}
