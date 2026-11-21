export interface ProcessedFileResult {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}

const MAX_FIRESTORE_DATAURL_CHARS = 700_000;

export async function processDossierFile(file: File): Promise<ProcessedFileResult> {
  if (file.type.startsWith('image/')) {
    const compressed = await compressImageToDataUrl(file, 1280, 0.78);
    if (compressed.length > MAX_FIRESTORE_DATAURL_CHARS) {
      const tighter = await compressImageToDataUrl(file, 960, 0.62);
      if (tighter.length > MAX_FIRESTORE_DATAURL_CHARS) {
        throw new Error('La imagen sigue superando el límite permitido (500 KB). Intenta con una foto más ligera.');
      }
      return {
        fileName: file.name,
        mimeType: 'image/jpeg',
        sizeBytes: Math.round((tighter.length * 3) / 4),
        dataUrl: tighter,
      };
    }
    return {
      fileName: file.name,
      mimeType: 'image/jpeg',
      sizeBytes: Math.round((compressed.length * 3) / 4),
      dataUrl: compressed,
    };
  }

  // PDFs and documents up to ~500KB binary (~670KB base64)
  if (file.size > 500 * 1024) {
    throw new Error(
      'El archivo supera los 500 KB permitidos para guardado directo. Puedes comprimir el PDF o adjuntarlo como enlace de Google Drive.'
    );
  }

  const dataUrl = await readFileAsDataUrl(file);
  if (dataUrl.length > MAX_FIRESTORE_DATAURL_CHARS) {
    throw new Error('El archivo codificado supera el límite permitido. Usa un enlace externo o un archivo más ligero.');
  }

  return {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    dataUrl,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
    reader.readAsDataURL(file);
  });
}

function compressImageToDataUrl(file: File, maxDim: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('No se pudo procesar la imagen.'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Archivo de imagen inválido.'));
    };
    img.src = url;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function processLessonPlanFile(file: File): Promise<ProcessedFileResult> {
  if (file.type.startsWith('image/')) {
    return await processDossierFile(file);
  }
  const maxBytes = 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error('La planeación supera los 5 MB permitidos. Intenta con un archivo más ligero.');
  }
  const dataUrl = await readFileAsDataUrl(file);
  return {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    dataUrl,
  };
}

export async function processAvatarImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecciona una imagen válida (PNG, JPG o WebP).');
  }
  const compressed = await compressImageToDataUrl(file, 200, 0.82);
  if (compressed.length > 320_000) {
    return await compressImageToDataUrl(file, 140, 0.7);
  }
  return compressed;
}
