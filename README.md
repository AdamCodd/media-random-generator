# Media random generator
This is a simple JS script that can efficiently retrieve a random image from Imgur (up to 500) or random Streamable videos (up to 5), using IndexedDB to avoid duplicates.\
You can test it here: [https://adamcodd.github.io/media-random-generator](https://adamcodd.github.io/media-random-generator/)
## Imgur generator
Click on the image to view the full size version.\
<b>Warning</b>: Some images might be NSFW. All content displayed here belongs to its respective authors.
### Image classification
Thanks to [Transformer.js](https://github.com/xenova/transformers.js), using only vanilla JavaScript, I'm able to run my quantized ONNX [image classification model](https://huggingface.co/AdamCodd/vit-base-nsfw-detector) directly in the browser. Although it's a bit slow, and there are some false positives/negatives due to the quantization, it works effectively. 

You can select SFW/NSFW to display only those types of images from random Imgur selections. However, don't try more than 10 images at once; your browser might crash or it could take forever.

Because of the ES6 modules, if you want to run the script locally you'll need a server environment (npm/python HTTP server). The easiest way if you have python 3.x installed:
```
cd media-random-generator
python -m http.server 8000 --bind 127.0.0.1
```
Then open `http://127.0.0.1:8000` in your browser.

## Streamable generator
Once you click on "reload," wait for a moment until you receive a functional URL; it will open a streamable stream in an iframe.
