export function inferEditorLanguage(filePath) {
  if (!filePath) return "plaintext";
  const ext = filePath.split(".").pop().toLowerCase();
  switch (ext) {
    case "js": return "javascript";
    case "mjs": return "javascript";
    case "cjs": return "javascript";
    case "ts": return "typescript";
    case "tsx": return "typescript";
    case "py": return "python";
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
    case "hh":
    case "h":
      return "cpp";
    case "json": return "json";
    case "md": return "markdown";
    case "css": return "css";
    case "html": return "html";
    case "sh":
    case "bash":
      return "shell";
    default:
      return "plaintext";
  }
}

/**
 * Human friendly label for UI (optional)
 */
export function labelFromEditorLang(lang) {
  switch (lang) {
    case "javascript": return "JavaScript";
    case "typescript": return "TypeScript";
    case "python": return "Python";
    case "cpp": return "C++";
    case "json": return "JSON";
    case "markdown": return "Markdown";
    case "css": return "CSS";
    case "html": return "HTML";
    case "shell": return "Shell";
    default: return "Plain Text";
  }
}