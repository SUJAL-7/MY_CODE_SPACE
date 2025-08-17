export function registerSimpleTree(socket, { onSnapshot }) {
  if (onSnapshot) socket.on("fs:treeSimple", onSnapshot);
}
export function unregisterSimpleTree(socket, { onSnapshot }) {
  if (onSnapshot) socket.off("fs:treeSimple", onSnapshot);
}