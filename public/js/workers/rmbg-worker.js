import { AutoModel, AutoProcessor, RawImage, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.1.2";

env.allowLocalModels = false;

let modelPromise = null;
let processorPromise = null;

async function loadEngine() {
  if (!modelPromise) {
    modelPromise = AutoModel.from_pretrained("briaai/RMBG-1.4", {
      config: { model_type: "custom" },
      progress_callback: (info) => {
        if (info?.status === "progress" && typeof info.progress === "number") {
          self.postMessage({
            type: "progress",
            progress: Math.min(95, Math.round(info.progress)),
          });
        }
      },
    }).catch((err) => {
      modelPromise = null;
      throw err;
    });
  }
  if (!processorPromise) {
    processorPromise = AutoProcessor.from_pretrained("briaai/RMBG-1.4", {
      config: {
        do_normalize: true,
        do_pad: false,
        do_rescale: true,
        do_resize: true,
        image_mean: [0.5, 0.5, 0.5],
        feature_extractor_type: "ImageFeatureExtractor",
        image_std: [1, 1, 1],
        resample: 2,
        rescale_factor: 0.00392156862745098,
        size: { width: 768, height: 768 },
      },
    }).catch((err) => {
      processorPromise = null;
      throw err;
    });
  }
  const [model, processor] = await Promise.all([modelPromise, processorPromise]);
  return { model, processor };
}

self.onmessage = async (e) => {
  const { id, imageDataUrl } = e.data || {};
  if (!imageDataUrl) return;

  try {
    self.postMessage({ type: "status", text: "Mohon tunggu sebentar ya..." });
    const { model, processor } = await loadEngine();

    self.postMessage({ type: "status", text: "Mohon tunggu sebentar ya..." });
    const img = await RawImage.fromURL(imageDataUrl);
    const { pixel_values } = await processor(img);
    const { output } = await model({ input: pixel_values });

    // Normalisasi Min-Max logit agar objek utama tetap utuh & bersih
    const tensor = output[0][0];
    const h = tensor.dims[0];
    const w = tensor.dims[1];
    const raw = tensor.data;

    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] < minVal) minVal = raw[i];
      if (raw[i] > maxVal) maxVal = raw[i];
    }
    const range = maxVal - minVal || 1;
    const maskBytes = new Uint8ClampedArray(w * h);
    for (let i = 0; i < raw.length; i++) {
      maskBytes[i] = Math.round(((raw[i] - minVal) / range) * 255);
    }

    self.postMessage(
      {
        type: "done",
        id,
        width: w,
        height: h,
        maskBuffer: maskBytes.buffer,
      },
      [maskBytes.buffer]
    );
  } catch (err) {
    self.postMessage({
      type: "error",
      id,
      error: err?.message || "Gagal memproses AI Remove BG",
    });
  }
};
