/**
 * MVP proof storage in ReturnItem.imageUrl (single string column).
 * Stores JSON with filename + data URL when an image is uploaded.
 */

export function serializeProofImage(fileName, dataUrl) {
  const name = fileName?.trim() || "";
  const src = dataUrl?.trim() || "";

  if (src.startsWith("data:") || src.startsWith("http")) {
    return JSON.stringify({
      fileName: name || "proof.jpg",
      src,
    });
  }

  if (name) return name;
  return null;
}

export function parseProofImage(imageUrl) {
  if (!imageUrl) {
    return { fileName: "", src: "" };
  }

  if (imageUrl.startsWith("{")) {
    try {
      const parsed = JSON.parse(imageUrl);
      return {
        fileName: parsed.fileName || "Proof image",
        src: parsed.src || "",
      };
    } catch {
      // fall through
    }
  }

  if (imageUrl.startsWith("data:") || imageUrl.startsWith("http")) {
    return { fileName: "Proof image", src: imageUrl };
  }

  return { fileName: imageUrl, src: "" };
}

export function isDisplayableImageSrc(src) {
  return Boolean(src && (src.startsWith("data:") || src.startsWith("http")));
}
