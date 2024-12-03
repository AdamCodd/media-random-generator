# Media random generator
This is a simple JS script that can efficiently retrieve a random image from Imgur (up to 500) or random Streamable videos (up to 5), using IndexedDB to avoid displaying duplicates. Later I added a ViT classifier model to test a NSFW filter in browser.\
You can test it here: [https://adamcodd.github.io/media-random-generator](https://adamcodd.github.io/media-random-generator/)

## WebGPU Support
I added a new experimental webGPU support (fallback to WASM if it's not supported). It's way faster than WASM, but might take a little while to load depending on your network.

As of December 2024, global WebGPU support is around 72% (according to [caniuse.com](https://caniuse.com/webgpu)), meaning some users may not be able to use the WebGPU API. You may need to enable it using a feature flag:
* Firefox: with the dom.webgpu.enabled flag ([see here](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Experimental_features#:~:text=tested%20by%20Firefox.-,WebGPU%20API,-The%20WebGPU%20API)).
* Safari: with the WebGPU feature flag ([see here](https://webkit.org/blog/14879/webgpu-now-available-for-testing-in-safari-technology-preview/)).
* Older Chromium browsers (on Windows, macOS, Linux): with the enable-unsafe-webgpu flag ([see here](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips)).

## Imgur generator
Click on the image to view the full size version.\
<b>Warning</b>: Some images might be NSFW. All content displayed here belongs to its respective authors.
### Image classification
Thanks to [Transformer.js](https://github.com/xenova/transformers.js), using only vanilla JavaScript, I'm able to run my quantized ONNX [image classification model](https://huggingface.co/AdamCodd/vit-base-nsfw-detector) directly in the browser. Although it's a bit slow, and there are some false positives/negatives due to the quantization, it works effectively. 

You can select SFW/NSFW to display only those types of images from random Imgur selections. However, don't try more than 10 images at once or it'll take forever.

Because of the ES6 modules, if you want to run the script locally you'll need a server environment (npm/python HTTP server). The easiest way if you have python 3.x installed:
```
cd media-random-generator
python -m http.server 8000 --bind 127.0.0.1
```
Then open `http://127.0.0.1:8000` in your browser.

## Streamable generator
Once you click on "reload," wait for a moment until you receive a functional URL; it will open a streamable stream in an iframe.
