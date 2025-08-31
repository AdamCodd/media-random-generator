// classifierWorker.js
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@latest';

// Skip local check
env.allowLocalModels = false;

let classifier;
let classifierBatchSize = 1;

async function checkWebGPUSupport() {
    try {
        const gpu = self.navigator?.gpu;
        if (!gpu) {
            console.log('WebGPU is not supported in this browser - falling back to WASM');
            return false;
        }
        
        const adapter = await gpu.requestAdapter();
        if (!adapter) {
            console.log('Failed to get WebGPU adapter - falling back to WASM');
            return false;
        }
        
        const device = await adapter.requestDevice();
        if (device) {
            console.log('WebGPU is supported and initialized successfully!');
            return true;
        } else {
            console.log('Failed to initialize WebGPU device - falling back to WASM');
            return false;
        }
    } catch (e) {
        console.log('Error while checking WebGPU support - falling back to WASM:', e);
        return false;
    }
}

async function loadModel() {
    try {
        const webGPUSupported = await checkWebGPUSupport();
        // Try using fp16 on WebGPU for speed; fall back to fp32 on error.
        if (webGPUSupported) {
            try {
                classifier = await pipeline('image-classification', 'AdamCodd/vit-base-nsfw-detector', {
                    device: 'webgpu',
                    dtype: 'fp16' // faster on GPUs that support it
                });
                classifierBatchSize = 8; // batch multiple images for better GPU utilization
                console.log('Loaded model on WebGPU with fp16.');
            } catch (errFp16) {
                console.warn('fp16 load failed, retrying with fp32:', errFp16);
                classifier = await pipeline('image-classification', 'AdamCodd/vit-base-nsfw-detector', {
                    device: 'webgpu',
                    dtype: 'fp32'
                });
                classifierBatchSize = 4;
                console.log('Loaded model on WebGPU with fp32.');
            }
        } else {
            // WASM: use quantized dtype for smaller memory and speed
            classifier = await pipeline('image-classification', 'AdamCodd/vit-base-nsfw-detector', {
                device: 'wasm',
                dtype: 'q8'
            });
            classifierBatchSize = 1; // keep small for WASM (adjust if you test and find a better value)
            console.log('Loaded model on WASM with q8.');
        }
        
        postMessage({ 
            modelLoaded: true,
            usingWebGPU: webGPUSupported 
        });
    } catch (error) {
        postMessage({ 
            modelLoaded: false, 
            error: 'Failed to load model',
            details: String(error) 
        });
    }
}

loadModel();

// helper: split array into chunks
function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size));
    }
    return out;
}

onmessage = async function(e) {
    // Expect links: [{ img: <URL string>, link: <original link>, blobUrl: <blobUrl for later display>, buffer: <ArrayBuffer?> }, ...]
    const { links, classificationType, confidenceCutoff } = e.data;
    try {
        if (!classifier) {
            throw new Error('Classifier not initialized yet');
        }

        // Build inputs for the classifier. If caller provided binary buffers, use them (create a temporary objectURL from buffer),
        // otherwise fall back to the supplied remote URL.
        const tempObjectUrls = []; // collect for later revocation
        const inputs = links.map(l => {
            // If caller passed an ArrayBuffer, create a Blob and an objectURL so pipeline doesn't need to re-download.
            if (l && l.buffer) {
                try {
                    // assume image/jpeg by default; if content type is unknown this still works in many cases.
                    const blob = new Blob([l.buffer], { type: 'image/jpeg' });
                    const objUrl = URL.createObjectURL(blob);
                    tempObjectUrls.push(objUrl);
                    return objUrl;
                } catch (err) {
                    // fallback to URL
                    console.warn('Failed to create objectURL from buffer, falling back to URL:', err);
                    return (typeof l.img === 'string') ? l.img : l.link;
                }
            } else {
                return (typeof l.img === 'string') ? l.img : l.link;
            }
        });

        // Run inference in batches (classifierBatchSize set during model load)
        let results = [];
        const urlBatches = chunkArray(inputs, classifierBatchSize);
        for (const batchInput of urlBatches) {
            // classifier accepts an array of image URLs / sources and returns array of outputs.
            const batchResults = await classifier(batchInput, { batch_size: classifierBatchSize });
            results.push(...batchResults);
            // yield to the event loop briefly
            await Promise.resolve();
        }

        // Revoke temporary object URLs created from transferred buffers
        for (const u of tempObjectUrls) {
            try { URL.revokeObjectURL(u); } catch (e) {}
        }

        // Return raw results to the main thread (main thread applies filtering/score logic).
        postMessage({ results: results });

    } catch (error) {
        postMessage({ error: 'Failed to classify images', details: String(error) });
    }
};
