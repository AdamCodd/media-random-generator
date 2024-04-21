// Configuration
const MAX = 500;
const STREAMABLE_LIMIT = 5;
const MAX_BLOCKED_URLS = 3000; // Maximum number of blocked URLs to store

// State variables
const links = new Set();  
let blockedUrls = new Set();  // To store previously used URLs
let successfulLoads = 0;
let streamableCount = 0; 
let modelLoaded = false; // To track if the WASM model is loaded
let loadingBatch = false; // To prevent fetching another batch for the classifier while processing

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

function start() {
    while (container.firstChild) {
        container.removeChild(container.firstChild); // Clear previous content
    }
    links.clear(); // Clear the links for the new load
	if (indexedDBSupported) {
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
	saveBlockedUrls();
}

async function loadStreamables(numItems) {
    let loadedCount = 0;
    while (loadedCount < numItems && loadedCount < STREAMABLE_LIMIT) {
        await loadStreamable(); // Wait for each streamable to load before continuing
        loadedCount++;
    }
}

async function loadStreamable() {
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
        await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 100))); // Exponential backoff or other retry logic could be added here
        return loadStreamable(); // Recursive call to retry loading
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

classifierWorker.onmessage = function(e) {
    if (e.data.error) {
        console.error('Classification error:', e.data.details);
        return;
    }

    if (e.data.modelLoaded) {
        modelLoaded = true;
        console.log("Model is now loaded and ready for classification.");
        reload.disabled = false; // Enable the load button if the model is loaded
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
        }
		if (index === batchLinks.length - 1) {
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
            classifierWorker.postMessage({ links: batchLinks, classificationType: classificationSelector.value });
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
                .then(blob => {
                    const imgUrl = URL.createObjectURL(blob);
                    const img = new Image();
                    img.src = imgUrl;
                    img.onload = () => {
                        if (img.naturalWidth === 161 && img.naturalHeight === 81) {
                            URL.revokeObjectURL(imgUrl); // Ignore placeholder images
                            resolve('Ignored placeholder image.');
                        } else {
                            if (classificationSelector.value === 'All' && successfulLoads < Number(setnumber.value)) {
                                displayImage(imgUrl, link); // Directly display if 'All' is selected
                                resolve('Displayed image without classification.');
                            } else {
                                batchLinks.push({ img: imgUrl, link: link }); // Add to batch for classification
                                resolve('Image loaded and added to batch.');
                            }
                        }
                    };
                    img.onerror = () => {
                        URL.revokeObjectURL(imgUrl);
                        reject('Image load error, retrying...');
                    };
                })
                .catch(error => {
                    console.log(error);
                    resolve('Fetch error, retrying...');
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

    // Append the image to the DOM and update the application state
    container.appendChild(img); 
    successfulLoads++;
	
	// Extract the unique code from the Imgur URL to store in blockedUrls
    const urlParts = link.match(/imgur\.com\/(.+)\.jpg/);
    if (urlParts && urlParts[1]) {
        blockedUrls.add(urlParts[1]); // Add the code only, not the full URL
    }

    // Free up the blob URL memory
    URL.revokeObjectURL(imgUrl);
}


// Load previously used URLs from IndexedDB
async function loadBlockedUrls() {
  if (!db || blockedUrls.size == 0) return; // Skip if IndexedDB is not initialized or blockedUrls is empty
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
    if ((classificationSelector.value.toLowerCase() !== "All") && !modelLoaded) {
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
