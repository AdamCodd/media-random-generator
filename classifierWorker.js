import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@latest';

// Skip local check
env.allowLocalModels = false;

let classifier;

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

let isUsingWebGPU = false;

async function loadModel() {
    try {
        const webGPUSupported = await checkWebGPUSupport();
        isUsingWebGPU = webGPUSupported;
        
        classifier = await pipeline('image-classification', 'AdamCodd/vit-base-nsfw-detector', {
            device: webGPUSupported ? 'webgpu' : 'wasm',
            dtype: webGPUSupported ? 'fp32' : 'q8'
        });
        
        postMessage({ 
            modelLoaded: true,
            usingWebGPU: webGPUSupported 
        });
    } catch (error) {
        postMessage({ 
            modelLoaded: false, 
            error: 'Failed to load model',
            details: error 
        });
    }
}

loadModel();


onmessage = async function(e) {
    const { links, classificationType } = e.data;
    try {
        let results;
        
        if (isUsingWebGPU) {
            // Sequential processing for WebGPU
            results = [];
            for (const { img, link } of links) {
                const result = await classifier(img);
                results.push(result);
            }
        } else {
            // Parallel processing for WASM
            results = await Promise.all(links.map(async ({ img, link }) => {
                return await classifier(img);
            }));
        }
        
        postMessage({ results, batchLinks: links });
    } catch (error) {
        postMessage({ error: 'Failed to classify images', details: error });
    }
};
