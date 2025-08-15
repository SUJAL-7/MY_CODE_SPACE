export async function fetchConfig() {
  const url = `${import.meta.env.VITE_SERVER_URL || import.meta.env.VITE_BACKEND_URL || ""}/config`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch config");
  return res.json();
}