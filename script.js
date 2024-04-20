// Configuration
const MAX = 500;
const STREAMABLE_LIMIT = 5;
const MAX_BLOCKED_URLS = 10000; // Maximum number of blocked URLs to store

// State variables
const links = new Set();  
let blockedUrls = new Set();  // To store previously used URLs
let successfulLoads = 0;
let streamableCount = 0; 

// DOM elements
const container = document.getElementById("media-container");
const reload = document.getElementById("load");
const setnumber = document.getElementById("setnumber");
const serviceSelector = document.getElementById("serviceSelector");
const classificationSelector = document.getElementById("classificationSelector");

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
    loadBlockedUrls();
  };
} else {
  console.warn("IndexedDB is not supported in this browser. Using in-memory storage.");
}

function getImgurLink() {
    let code = '';
    do {
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

function loadStreamable() {
    if (streamableCount >= STREAMABLE_LIMIT) {  
        return;
    }
  
    let randomCode = getStreamableLink().split("com/")[1];
    let randomUrl = `https://api.streamable.com/oembed.json?url=https://streamable.com/${randomCode}`;
    
    $.getJSON(randomUrl)
    .done(function(data) {
        let iframe = document.createElement("iframe");
        iframe.src = `https://streamable.com/${randomCode}`;
        iframe.className = "streamable-video";
        iframe.style.width = "100vw";
        iframe.style.height = "50vh";
        container.appendChild(iframe);
        streamableCount++;  
    })
    .fail(function(data) {
        setTimeout(() => {
            loadStreamable();
        }, Math.floor(Math.random() * 100));
    });
}

function start() {
    container.textContent = ''; // Clear the container
    streamableCount = 0; // Reset the counter for streamable
    successfulLoads = 0; // Reset the counter for successful loads
    const numItems = Math.min(MAX, Number(document.getElementById("setnumber").value)); // Retrieve the desired number of images from the input
    for (let i = 0; i < numItems; i++) {
        if (serviceSelector.value === "streamable") {
            loadStreamable();
        } else {
            loadMedia();
        }
    }
}

reload.addEventListener('click', start); // Optimized to directly use the 'start' function

// Initialize web worker for classification
const classifierWorker = new Worker('classifierWorker.js', { type: 'module' });

classifierWorker.onmessage = function(e) {
    if (e.data.error) {
        console.error('Classification error:', e.data.details);
        return;
    }
    const { results, batchLinks } = e.data;
    results.forEach((resultArray, index) => {
        if (successfulLoads >= Number(setnumber.value)) return; // Check load limit

        // Ensure the resultArray is not empty and has a label
        if (!resultArray.length || !resultArray[0].label) {
            console.error("No valid label in result:", resultArray);
            return;
        }

        const result = resultArray[0]; // Assuming the first item is the relevant classification
        const classification = result.label.toLowerCase();
        const score = result.score; // Assuming the score is also provided
        const url = batchLinks[index].link; // The URL associated with this classification

        // Log the classification, score, and URL to the console
        console.log(`Classification: ${classification}, Score: ${score.toFixed(2)}, URL: ${url}`);

        const selectedFilter = classificationSelector.value.toLowerCase();
        if (selectedFilter === classification) {
            displayImage(batchLinks[index].img, url);
        } else {
            console.log("Image does not match filter, not displaying...");
            loadMedia(); // Fetch and process more images
        }
    });
    if (successfulLoads < Number(setnumber.value)) {
        loadMedia(); // Continue loading media if not reached the desired number
    }
};


function loadMedia() {
    const desiredNum = Number(document.getElementById("setnumber").value);
    if (successfulLoads >= desiredNum) {
        return; // All desired images are already processed
    }

    let counterBatch = 0;
    let batchSize = 4;
    let batchLinks = [];
    let imagePromises = [];

    const processBatch = () => {
        if (batchLinks.length > 0 && successfulLoads < desiredNum) {
            classifierWorker.postMessage({ links: batchLinks, classificationType: classificationSelector.value });
            batchLinks = [];
            counterBatch = 0;
        }
    };

    const processImage = (link) => {
        return new Promise((resolve, reject) => {
            if (!links.has(link) && !blockedUrls.has(link)) {
                links.add(link);
                fetch(link)
                    .then(res => res.ok ? res.blob() : Promise.reject('Failed to load image'))
                    .then(blob => {
                        const imgUrl = URL.createObjectURL(blob);
                        const img = new Image();
                        img.src = imgUrl;
                        img.onload = () => {
                            if (img.naturalWidth === 161 && img.naturalHeight === 81 || successfulLoads >= desiredNum) {
                                URL.revokeObjectURL(imgUrl); // Handle placeholder or max load
                                resolve('Not processing, retrying or stopping...');
                                if (successfulLoads < desiredNum) loadMedia();
                            } else if (classificationSelector.value === 'All') {
                                displayImage(imgUrl, link); // Direct display without classification
                                resolve('Image displayed without classification.');
                            } else {
                                batchLinks.push({ img: imgUrl, link: link });
                                counterBatch++;
                                if (counterBatch >= batchSize) processBatch();
                                resolve('Image loaded and batched for classification.');
                            }
                        };
                        img.onerror = () => {
                            URL.revokeObjectURL(imgUrl);
                            console.error('Image failed to load.');
                            resolve('Image load error, retrying...');
                            loadMedia();
                        };
                    })
                    .catch(error => {
                        console.error(error);
                        blockedUrls.add(link);
                        saveBlockedUrls();
                        resolve('Fetch error, retrying...');
                        loadMedia();
                    });
            } else {
                resolve('Duplicate link, skipping...');
            }
        });
    };

    for (let i = 0; i < Math.min(desiredNum - successfulLoads, batchSize); i++) {
        imagePromises.push(processImage(getLink()));
    }

    Promise.all(imagePromises).then(() => {
        if (successfulLoads < desiredNum) processBatch();
    });
}

function displayImage(imgUrl, link) {
    const img = new Image();
    img.src = imgUrl;

    // Set additional attributes and event listeners
    img.className = "imgur-image"; 
    img.setAttribute("data-link", link);
    img.onclick = () => window.open(link, '_blank').focus();

    // Append the image to the DOM and update the application state
    container.appendChild(img); 
    blockedUrls.add(link); 
    saveBlockedUrls(); 

    successfulLoads++;

    URL.revokeObjectURL(imgUrl);
}


// Load previously used URLs from IndexedDB
async function loadBlockedUrls() {
  if (!db) return; // Skip if IndexedDB is not initialized
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
  if (!db || blockedUrls.size <= MAX_BLOCKED_URLS) return;  // Skip if IndexedDB is not initialized or no new URLs
  const transaction = db.transaction("blockedUrls", "readwrite");
  const objectStore = transaction.objectStore("blockedUrls");

  // Only store the latest MAX_BLOCKED_URLS entries
  const urlsToStore = Array.from(blockedUrls).slice(-MAX_BLOCKED_URLS);
  urlsToStore.forEach(url => {
    objectStore.put({ url });
  });

  transaction.onerror = function(event) {
    console.error("Transaction error in saving blocked URLs:", transaction.error);
  };
}

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
