export function exec(container, cmd) {
  return new Promise((resolve, reject) => {
    container.exec(
      {
        Cmd: ["bash", "-lc", cmd],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      },
      (err, execObj) => {
        if (err) return reject(err);
        execObj.start((err2, stream) => {
          if (err2) return reject(err2);
          let out = "";
          stream.on("data", (d) => (out += d.toString("utf8")));
          stream.on("error", reject);
          stream.on("end", () => resolve(out));
        });
      }
    );
  });
}
