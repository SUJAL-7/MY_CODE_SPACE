import { docker } from "./docker.js";
import { imageAllowed } from "./utils.js";

export async function pullImageIfNeeded(image) {
  try {
    await docker.getImage(image).inspect();
  } catch {
    if (!imageAllowed(image)) throw new Error("Image not allowed");
    await new Promise((resolve, reject) => {
      docker.pull(image, (err, stream) => {
        if (err) return reject(err);
        docker.modem.followProgress(
          stream,
          (err2) => (err2 ? reject(err2) : resolve()),
          () => {}
        );
      });
    });
  }
}
