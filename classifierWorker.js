// Assuming the library supports ESM, which needs confirmation or you might need a build step to convert it.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1';

env.allowLocalModels = false;

let classifier;

async function loadModel() {
    classifier = await pipeline('image-classification', 'AdamCodd/vit-base-nsfw-detector');
}

loadModel();

onmessage = async function(e) {
    const { links, classificationType } = e.data;
    try {
        const results = await Promise.all(links.map(async ({ img, link }) => {
            return await classifier(img); // Ensure correct usage based on actual API calls
        }));
        postMessage({ results, batchLinks: links });
    } catch (error) {
        postMessage({ error: 'Failed to classify images', details: error });
    }
};
