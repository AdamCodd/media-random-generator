// Configuration
const MAX = 500;
const STREAMABLE_LIMIT = 5;

// State variables
const links = new Set();  
let blockedUrls = new Set();  // To store previously used URLs
let successfulLoads = 0;
let streamableCount = 0; 

// DOM elements
const container = document.getElementById("media-container");
const reload = document.getElementById("reload");
const setnumber = document.getElementById("setnumber");
const serviceSelector = document.getElementById("serviceSelector");

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


function loadMedia() {
    const desiredNum = Number(document.getElementById("setnumber").value); // Get the desired number of images from the input

    if (successfulLoads >= desiredNum) { // Use the desired number here
        return;
    }

    const link = getLink();
    if (!links.has(link) && !blockedUrls.has(link)) {
        if (serviceSelector.value === "imgur") {
            fetch(link)
            .then(res => res.ok ? res.blob() : Promise.reject(res))
            .then(blob => {
                const newImg = new Image();
                newImg.src = URL.createObjectURL(blob);
                newImg.className = "imgur-image";
                newImg.setAttribute("data-link", link);
                newImg.onload = () => {
                    if (newImg.naturalWidth === 161 && newImg.naturalHeight === 81) {
                        loadMedia(); // Try again if the image is a placeholder
                        return;
                    }
                    container.appendChild(newImg);
                    blockedUrls.add(link); // Add the successful imgur URL to blockedUrls
        	    saveBlockedUrls(); 
                    successfulLoads++; // Increment successful load counter 
                }
                newImg.onclick = () => window.open(link, '_blank').focus();
            })
            .catch(error => {
                console.log('Something went wrong.', error);
                blockedUrls.add(link); // Add the failed URL to blockedUrls
    		saveBlockedUrls(); // Save the failed URL to IndexedDB
                loadMedia(); // Try again if the fetch fails
            });
        }
        links.add(link);
    } else {
        loadMedia(); // Try again if the URL is a duplicate
    }
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

// Save used URLs to IndexedDB
function saveBlockedUrls() {
  if (!db) return;  // Skip if IndexedDB is not initialized
  const transaction = db.transaction("blockedUrls", "readwrite");
  const objectStore = transaction.objectStore("blockedUrls");

  // Optimized to use a single transaction
  blockedUrls.forEach(url => {
    objectStore.put({ url });
  });
  
  // Handle a transaction error
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
