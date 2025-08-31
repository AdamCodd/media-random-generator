// script.js

// Configuration
const MAX = 500;
const STREAMABLE_LIMIT = 5;
const MAX_BLOCKED_URLS = 3000; // Maximum number of blocked URLs to store
const MAX_STREAMABLE_RETRIES = 3; // avoid infinite recursion

// State variables
const links = new Set();  
let blockedUrls = new Set();  // To store previously used URLs
let successfulLoads = 0;
let streamableCount = 0; 
let modelLoaded = false; // To track if the WASM/WebGPU model is loaded
let loadingBatch = false; // To prevent fetching another batch for the classifier while processing
let confidenceCutoff = 0.75; 

// DOM elements
const container = document.getElementById("media-container");
const reload = document.getElementById("load");
const setnumber = document.getElementById("setnumber");
const serviceSelector = document.getElementById("serviceSelector");
const classificationSelector = document.getElementById("classificationSelector");
const confidenceNumber = document.getElementById('confidenceCutoffNumber');

const characters = "abcdefgihjklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";

// Initialize IndexedDB
let db = null;
let indexedDBSupported = 'indexedDB' in window;

if (indexedDBSupported) {
  const indexedDBOpenRequest = indexedDB.open("myDatabase", 2);
  indexedDBOpenRequest.onupgradeneeded = function(event) {
    db = event.target.result;
    if (!db.objectStoreNames.contains("blockedUrls")) {
      db.createObjectStore("blockedUrls", { keyPath: "url" });
    }
  };
  indexedDBOpenRequest.onerror = function() {
    console.error("IndexedDB not opened:", this.error);
  };
  indexedDBOpenRequest.onsuccess = function(event) {
    db = event.target.result;
  };
} else {
  console.warn("IndexedDB is not supported in this browser. Using in-memory storage.");
}

if (confidenceNumber) {
    // read initial value from DOM and clamp between 0 and 1
    const initial = Number(confidenceNumber.value);
    if (!Number.isNaN(initial)) {
        confidenceCutoff = Math.max(0, Math.min(1, initial));
        confidenceNumber.value = confidenceCutoff;
    }

    confidenceNumber.addEventListener('input', (ev) => {
        let parsed = Number(ev.target.value);
        if (Number.isNaN(parsed)) parsed = 0.9;
        parsed = Math.max(0, Math.min(1, parsed));
        confidenceCutoff = parsed;
        confidenceNumber.value = parsed;
    });
}

function getImgurLink() {
    let code = '';
    do {
        code = '';
        for (let i = 0; i < 5; i++) {
            code += characters[Math.floor(Math.random() * characters.length)];
        }
    } while (blockedUrls.has(code));
    return `https://i.imgur.com/${code}.jpg`;
}

function getStreamableLink() {
    let alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `https://streamable.com/${code}`;
}

function getLink() {
    const service = serviceSelector.value;
    if (service === "imgur") {
        return getImgurLink();
    } else if (service === "streamable") {
        return getStreamableLink();
    }
}

function start() {
    while (container.firstChild) {
        container.removeChild(container.firstChild); // Clear previous content
    }
    links.clear(); // Clear the links for the new load
    if (indexedDBSupported) {
        // It's async — we don't block on it, just let it hydrate in the background
        loadBlockedUrls(); // Load blocked URLs at the start of the method
    }
    const numItems = Math.min(MAX, Number(document.getElementById("setnumber").value)); // Retrieve the desired number of images from the input
    
    if (serviceSelector.value === "streamable") {
        streamableCount = 0; // Reset the counter for streamable
        classificationSelector.disabled = true; // Disable classification selector
        loadStreamables(numItems);
    } else {
        successfulLoads = 0; // Reset the counter for successful loads
        classificationSelector.disabled = false; // Enable classification selector
        loadMedia(numItems);
    }
}

async function loadStreamables(numItems) {
    let loadedCount = 0;
    while (loadedCount < numItems && loadedCount < STREAMABLE_LIMIT) {
        await loadStreamable(); // Wait for each streamable to load before continuing
        loadedCount++;
    }
}

async function loadStreamable(retries = 0) {
    let randomCode = getStreamableLink().split("com/")[1];
    let randomUrl = `https://api.streamable.com/oembed.json?url=https://streamable.com/${randomCode}`;

    try {
        const data = await $.getJSON(randomUrl); // Using jQuery's getJSON method which returns a promise
        let iframe = document.createElement("iframe");
        iframe.src = `https://streamable.com/${randomCode}`;
        iframe.className = "streamable-video";
        iframe.style.width = "100vw";
        iframe.style.height = "50vh";
        container.appendChild(iframe);
        blockedUrls.add(randomUrl);
    } catch (error) {
        if (retries >= MAX_STREAMABLE_RETRIES) {
            console.warn('Max retries reached for streamable:', randomUrl);
            return;
        }
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 100) + 50));
        return loadStreamable(retries + 1); // Retry with a cap
    }
}

serviceSelector.addEventListener('change', function() {
    // Disable classification selector if 'streamable' is selected
    if (serviceSelector.value === "streamable") {
        classificationSelector.disabled = true;
    } else {
        classificationSelector.disabled = false;
    }
});

reload.addEventListener('click', start); // Optimized to directly use the 'start' function

// Initialize web worker for classification
const classifierWorker = new Worker('classifierWorker.js', { type: 'module' });

// Holds the *exact* batch we just sent to the worker so we can map results back to blobUrls/links
let inflightBatchLinks = [];

classifierWorker.onmessage = function(e) {
    if (e.data.error) {
        console.error('Classification error:', e.data.details);
        loadingBatch = false;
        if (successfulLoads < Number(setnumber.value)) {
            loadMedia(Number(setnumber.value));
        }
        return;
    }

    if (e.data.modelLoaded) {
        modelLoaded = true;
        console.log("Model is now loaded and ready for classification.");
        reload.disabled = false; // Enable the load button if the model is loaded
        return;
    }

    const { results } = e.data;
    const currentBatch = inflightBatchLinks; // use our snapshot (DON'T rely on a returned batchLinks)

    // results is an array with one result-array per input image (pipeline output).
    // currentBatch is the same-length array of { link, blobUrl } captured before posting.

    results.forEach((resultArray, index) => {
        if (successfulLoads >= Number(setnumber.value)) return; // Check load limit

        const batchItem = currentBatch?.[index];

        // If the pipeline returned nothing usable for this image, drop it.
        if (!resultArray || !resultArray.length || !resultArray[0].label) {
            if (batchItem?.blobUrl) {
                URL.revokeObjectURL(batchItem.blobUrl);
            }
            if (index === currentBatch.length - 1) {
                loadingBatch = false;
                if (successfulLoads < Number(setnumber.value)) {
                    loadMedia(Number(setnumber.value));
                }
            }
            return;
        }

        const topResult = resultArray[0];
        const classification = String(topResult.label).toLowerCase();
        const score = Number(topResult.score ?? 0);

        // FIRST: check the label filter (must match before we even consider the score)
        const selectedFilter = classificationSelector.value.toLowerCase();

        if (selectedFilter !== "all" && selectedFilter !== classification) {
            if (batchItem?.blobUrl) URL.revokeObjectURL(batchItem.blobUrl);
            console.log(`Skipped label ${classification} with confidence ${score.toFixed(2)}: ${batchItem?.link}`);
            if (index === currentBatch.length - 1) {
                loadingBatch = false;
                if (successfulLoads < Number(setnumber.value)) {
                    loadMedia(Number(setnumber.value));
                }
            }
            return;
        }

        // SECOND: since label matched (or user selected "All"), apply confidence cutoff
        if (score < confidenceCutoff) {
            if (batchItem?.blobUrl) URL.revokeObjectURL(batchItem.blobUrl);
            console.log(`Skipped due to low confidence (${score.toFixed(2)} < ${confidenceCutoff.toFixed(2)}):`, batchItem?.link);
            if (index === currentBatch.length - 1) {
                loadingBatch = false;
                if (successfulLoads < Number(setnumber.value)) {
                    loadMedia(Number(setnumber.value));
                }
            }
            return;
        }

        // Both checks passed -> display
        if (batchItem?.blobUrl && batchItem?.link) {
            displayImage(batchItem.blobUrl, batchItem.link);
            console.log(`Displayed (label=${classification}, score=${score.toFixed(2)}): ${batchItem.link}`);
        } else {
            console.warn('No blobUrl to display for item:', batchItem);
        }

        if (index === currentBatch.length - 1) {
            loadingBatch = false; // Reset loading flag after last batch item is processed
            if (successfulLoads < Number(setnumber.value)) {
                loadMedia(Number(setnumber.value)); // Continue loading if not reached desired count
            }
        }
    });
};

let batchLinks = []; // Holds the current batch of links to process

function loadMedia(desiredNum) {
    if (successfulLoads >= desiredNum) {
        console.log("Desired number of media loaded.");
        return;
    }

    // Dynamically adjust the batch size based on remaining items to load
    let remainingLoads = desiredNum - successfulLoads;
    let batchSize;
    if (classificationSelector.value === "All") {
        batchSize = Math.min(20, remainingLoads); // Increased batch size for 'All'
    } else {
        batchSize = Math.min(8, remainingLoads); // Default batch size for other classifications
    }    

    const processBatch = () => {
        if (batchLinks.length === batchSize) {
            loadingBatch = true; // Set loading flag

            // Snapshot the batch so we can map results back to blobUrls/links later
            inflightBatchLinks = batchLinks.slice();

            // transfer buffers to avoid copying
            const transferList = inflightBatchLinks.map(l => l.buffer).filter(Boolean);

            // Send the batch to the worker.
            classifierWorker.postMessage({ 
                links: inflightBatchLinks, 
                classificationType: classificationSelector.value,
                confidenceCutoff: confidenceCutoff 
            }, transferList);

            // NOTE: transferred arrayBuffers are now neutered in main thread; but we still keep blobUrl for display AND link for mapping
            batchLinks = []; // Clear the batch links after sending them to the classifier
        }

        // Load more media if not yet reached the desired number
        if (successfulLoads < desiredNum && !loadingBatch) {
            loadMoreMedia(desiredNum); // Continue loading media
        }
    };

    // Function to initiate more loads if necessary
    const loadMoreMedia = (desiredNum) => {
        if (successfulLoads < desiredNum && !loadingBatch) {
            let promises = [];
            for (let i = 0; i < Math.min(remainingLoads, batchSize - batchLinks.length); i++) {
                promises.push(processImage(getLink()));
            }
            Promise.all(promises).then(processBatch); // Process the batch once all current promises resolve
        }
    };
    // Immediately initiate loading if not currently processing a batch
    if (!loadingBatch) {
        loadMoreMedia(desiredNum);
    }
}

function processImage(link) {
    return new Promise((resolve, reject) => {
        if (!links.has(link)) {
            links.add(link);
            fetch(link)
                .then(res => res.ok ? res.blob() : Promise.reject('Failed to load image'))
                .then(async blob => {
                    const imgUrl = URL.createObjectURL(blob);
                    const img = new Image();
                    img.src = imgUrl;
                    img.onload = async () => {
                        try {
                            // Use naturalWidth/naturalHeight to detect placeholders (same as original logic)
                            if (img.naturalWidth === 161 && img.naturalHeight === 81) {
                                URL.revokeObjectURL(imgUrl); // Ignore placeholder images
                                resolve('Ignored placeholder image.');
                            } else {
                                if (classificationSelector.value === 'All' && successfulLoads < Number(setnumber.value)) {
                                    displayImage(imgUrl, link); // Directly display if 'All' is selected
                                    resolve('Displayed image without classification.');
                                } else {
                                    // Add to batch for classification.
                                    // include the binary (ArrayBuffer) so the worker doesn't re-download.
                                    try {
                                        const buffer = await blob.arrayBuffer(); // MDN: Blob.arrayBuffer() returns ArrayBuffer
                                        batchLinks.push({ img: link, link: link, blobUrl: imgUrl, buffer });
                                        resolve('Image loaded and added to batch (with buffer).');
                                    } catch (err) {
                                        // If arrayBuffer fails for any reason, fallback to pushing without buffer (worker will re-download)
                                        console.warn('Failed to get arrayBuffer from blob, falling back to URL', err);
                                        batchLinks.push({ img: link, link: link, blobUrl: imgUrl });
                                        resolve('Image loaded and added to batch (without buffer).');
                                    }
                                }
                            }
                        } catch (error) {
                            console.warn('Error processing image:', error);
                            URL.revokeObjectURL(imgUrl);
                            resolve('Error processing image, skipping...');
                        }
                    };
                    img.onerror = () => {
                        URL.revokeObjectURL(imgUrl);
                        resolve('Image load error, skipping...');
                    };
                })
                .catch(error => {
                    console.warn('Fetch error:', error);
                    resolve('Fetch error, skipping...');
                });
        } else {
            resolve('Duplicate link, skipping...');
        }
    });
}

function displayImage(imgUrl, link) {
    const img = new Image();
    img.src = imgUrl;

    // Set additional attributes and event listeners
    img.className = "imgur-image"; 
    img.setAttribute("data-link", link);
    img.onclick = () => window.open(link, '_blank').focus();

    // Revoke blob URL only after the DOM image actually finishes loading to avoid blanks.
    img.onload = () => {
        try {
            // Extract the unique code from the Imgur URL to store in blockedUrls
            const urlParts = link.match(/imgur\.com\/(.+)\.jpg/);
            if (urlParts && urlParts[1]) {
                blockedUrls.add(urlParts[1]); // Add the code only, not the full URL
            }
            // Free up the blob URL memory once the image has fully rendered
            URL.revokeObjectURL(imgUrl);
        } catch (e) {
+            console.warn('Failed to revoke object URL after image load:', e);
        }
    };

    // Append the image to the DOM and update the application state
    container.appendChild(img); 
    successfulLoads++;
}


// Load previously used URLs from IndexedDB
async function loadBlockedUrls() {
  if (!db) return; // allow load when blockedUrls is empty
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("blockedUrls", "readonly");
    const objectStore = transaction.objectStore("blockedUrls");
    const getRequest = objectStore.openCursor();

    getRequest.onsuccess = function(event) {
      const cursor = event.target.result;
      if (cursor) {
        blockedUrls.add(cursor.value.url);
        cursor.continue();
      } else {
        resolve();
      }
    };
    getRequest.onerror = function() {
      reject("Error getting data");
    };
  });
}

// Save used URLs to IndexedDB, ensuring the count doesn't exceed the set limit
function saveBlockedUrls() {
  if (!db || blockedUrls.size <= MAX_BLOCKED_URLS) return; // Only proceed if necessary

  const transaction = db.transaction("blockedUrls", "readwrite");
  const objectStore = transaction.objectStore("blockedUrls");

  // Clean up old entries if necessary
  while (blockedUrls.size > MAX_BLOCKED_URLS) {
    const firstItem = blockedUrls.values().next().value;
    blockedUrls.delete(firstItem); // Remove the oldest item
    objectStore.delete(firstItem); // Reflect this in IndexedDB
  }

  // Store new URLs
  blockedUrls.forEach(url => {
    objectStore.put({ url });
  });

  transaction.oncomplete = function() {
    console.log("Blocked URLs updated in IndexedDB.");
  };

  transaction.onerror = function(event) {
    console.error("Transaction error in saving blocked URLs:", transaction.error);
  };
}

// Event listener to update button status based on classification selector changes
function updateLoadButtonStatus() {
    if ((classificationSelector.value.toLowerCase() !== "all") && !modelLoaded) {
        reload.disabled = true;
        console.log("Waiting for model to load before enabling 'Load' button for SFW/NSFW classification.");
    } else {
        reload.disabled = false;
    }
}
classificationSelector.addEventListener('change', updateLoadButtonStatus);

// Return to top
document.addEventListener('DOMContentLoaded', function() {
    const backToTopButton = document.getElementById('back-to-top');

    window.addEventListener('scroll', function() {
        if (window.scrollY > 300) {
            backToTopButton.style.display = 'block';
        } else {
            backToTopButton.style.display = 'none';
        }
    });

    backToTopButton.addEventListener('click', function() {
        window.scrollTo(0, 0);
    });
});
